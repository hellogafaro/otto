import { type AuthSessionState, type DesktopBridge } from "@otto/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import { HttpClientError, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { installEnvironmentHttpTest } from "../test/environmentHttpTest";
import { __setPrimaryHttpRunnerForTests, type PrimaryHttpEffectRunner } from "./lib/runtime";

type TestWindow = {
  location: URL;
  history: {
    replaceState: (_data: null, _unused: string, url: string) => void;
  };
  desktopBridge?: Partial<DesktopBridge>;
};

const LOOPBACK_AUTH = {
  policy: "loopback-browser",
  bootstrapMethods: ["email-password"],
  sessionMethods: ["browser-session-cookie"],
  sessionCookieName: "ottoLegacy_session",
} as const;

const DESKTOP_AUTH = {
  policy: "desktop-managed-local",
  bootstrapMethods: ["email-password"],
  sessionMethods: ["browser-session-cookie"],
  sessionCookieName: "ottoLegacy_session",
} as const;

const SESSION_EXPIRES_AT = DateTime.makeUnsafe("2026-04-05T00:00:00.000Z");

const unauthenticatedSession = (auth: AuthSessionState["auth"]): AuthSessionState => ({
  authenticated: false,
  auth,
});

const authenticatedSession = (auth: AuthSessionState["auth"]): AuthSessionState => ({
  authenticated: true,
  auth,
  sessionMethod: "browser-session-cookie",
  expiresAt: SESSION_EXPIRES_AT,
});

function installTestBrowser(url: string) {
  const testWindow: TestWindow = {
    location: new URL(url),
    history: {
      replaceState: (_data, _unused, nextUrl) => {
        testWindow.location = new URL(nextUrl, testWindow.location.href);
      },
    },
  };

  vi.stubGlobal("window", testWindow);
  vi.stubGlobal("document", { title: "Otto Legacy" });

  return testWindow;
}

function sequence<A>(...values: ReadonlyArray<A>) {
  let index = 0;

  return () => values[Math.min(index++, values.length - 1)]!;
}

let disposeHttpTest: (() => Promise<void>) | undefined;

async function installAuthApi(input: { readonly session?: () => AuthSessionState }) {
  const testApi = await installEnvironmentHttpTest(
    input.session ? { session: () => Effect.succeed(input.session!()) } : {},
  );

  disposeHttpTest = testApi.dispose;

  return testApi;
}

describe("resolveInitialServerAuthGateState", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    installTestBrowser("http://localhost/");
  });

  afterEach(async () => {
    await disposeHttpTest?.();
    disposeHttpTest = undefined;
    const { __resetServerAuthBootstrapForTests } = await import("./environments/primary");
    __resetServerAuthBootstrapForTests();
    __setPrimaryHttpRunnerForTests();
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("reuses an in-flight session read", async () => {
    const testApi = await installAuthApi({
      session: sequence(authenticatedSession(LOOPBACK_AUTH), unauthenticatedSession(LOOPBACK_AUTH)),
    });

    const { resolveInitialServerAuthGateState } = await import("./environments/primary");

    await expect(
      Promise.all([resolveInitialServerAuthGateState(), resolveInitialServerAuthGateState()]),
    ).resolves.toEqual([{ status: "authenticated" }, { status: "authenticated" }]);
    expect(testApi.calls.session).toBe(1);
  });

  it("uses https urls when the primary environment uses wss", async () => {
    await installAuthApi({ session: () => unauthenticatedSession(LOOPBACK_AUTH) });
    vi.stubEnv("VITE_HTTP_URL", "https://remote.example.com");
    vi.stubEnv("VITE_WS_URL", "wss://remote.example.com");

    const { resolveInitialServerAuthGateState, resolvePrimaryEnvironmentHttpUrl } =
      await import("./environments/primary");

    await expect(resolveInitialServerAuthGateState()).resolves.toEqual({
      status: "requires-auth",
      auth: LOOPBACK_AUTH,
    });
    expect(resolvePrimaryEnvironmentHttpUrl("/api/auth/session")).toBe(
      "https://remote.example.com/api/auth/session",
    );
  });

  it("uses the current origin as an auth proxy base for local dev environments", async () => {
    await installAuthApi({ session: () => unauthenticatedSession(LOOPBACK_AUTH) });
    installTestBrowser("http://localhost:5735/");

    const { resolveInitialServerAuthGateState, resolvePrimaryEnvironmentHttpUrl } =
      await import("./environments/primary");

    await expect(resolveInitialServerAuthGateState()).resolves.toEqual({
      status: "requires-auth",
      auth: LOOPBACK_AUTH,
    });
    expect(resolvePrimaryEnvironmentHttpUrl("/api/auth/session")).toBe(
      "http://localhost:5735/api/auth/session",
    );
  });

  it("uses the vite proxy for desktop-managed loopback auth requests during local dev", async () => {
    await installAuthApi({ session: () => unauthenticatedSession(DESKTOP_AUTH) });
    vi.stubEnv("VITE_DEV_SERVER_URL", "http://127.0.0.1:5733");

    const testWindow = installTestBrowser("http://127.0.0.1:5733/");
    testWindow.desktopBridge = {
      getLocalEnvironmentBootstraps: () => [
        {
          id: "primary",
          label: "Windows",
          httpBaseUrl: "http://127.0.0.1:3773",
          wsBaseUrl: "ws://127.0.0.1:3773",
        },
      ],
    };

    const { resolveInitialServerAuthGateState, resolvePrimaryEnvironmentHttpUrl } =
      await import("./environments/primary");

    await expect(resolveInitialServerAuthGateState()).resolves.toEqual({
      status: "requires-auth",
      auth: DESKTOP_AUTH,
    });
    expect(resolvePrimaryEnvironmentHttpUrl("/api/auth/session")).toBe(
      "http://127.0.0.1:5733/api/auth/session",
    );
  });

  it("returns a requires-auth state instead of throwing when nobody is signed in", async () => {
    await installAuthApi({ session: () => unauthenticatedSession(LOOPBACK_AUTH) });
    const { resolveInitialServerAuthGateState } = await import("./environments/primary");

    await expect(resolveInitialServerAuthGateState()).resolves.toEqual({
      status: "requires-auth",
      auth: LOOPBACK_AUTH,
    });
  });

  it("retries transient auth session bootstrap failures after restart", async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const request = HttpClientRequest.get("http://localhost/api/auth/session");

    const response = HttpClientResponse.fromWeb(
      request,
      new Response("Bad Gateway", { status: 502 }),
    );

    const runner: PrimaryHttpEffectRunner = async <A>() => {
      attempts += 1;

      if (attempts < 4) {
        throw new HttpClientError.HttpClientError({
          reason: new HttpClientError.StatusCodeError({ request, response }),
        });
      }

      return unauthenticatedSession(LOOPBACK_AUTH) as A;
    };

    __setPrimaryHttpRunnerForTests(runner);

    const { resolveInitialServerAuthGateState } = await import("./environments/primary");

    const gateStatePromise = resolveInitialServerAuthGateState();
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(gateStatePromise).resolves.toEqual({
      status: "requires-auth",
      auth: LOOPBACK_AUTH,
    });
    expect(attempts).toBe(4);
  });

  it("derives primary request messages from structural request context", async () => {
    const cause = new Error("private transport detail");
    const { PrimaryEnvironmentRequestError } = await import("./environments/primary");

    const error = PrimaryEnvironmentRequestError.fromCause({
      operation: "list-client-sessions",
      cause,
    });

    expect(error.status).toBe(500);
    expect(error.cause).toBe(cause);
    expect(error.message).toBe(
      "Primary environment request failed during list-client-sessions (HTTP 500).",
    );
    expect(error.message).not.toContain(cause.message);
  });

  it("memoizes the authenticated gate state after the first successful read", async () => {
    const testApi = await installAuthApi({
      session: sequence(authenticatedSession(LOOPBACK_AUTH), unauthenticatedSession(LOOPBACK_AUTH)),
    });

    const { resolveInitialServerAuthGateState } = await import("./environments/primary");

    await expect(resolveInitialServerAuthGateState()).resolves.toEqual({
      status: "authenticated",
    });
    await expect(resolveInitialServerAuthGateState()).resolves.toEqual({
      status: "authenticated",
    });
    expect(testApi.calls.session).toBe(1);
  });
});
