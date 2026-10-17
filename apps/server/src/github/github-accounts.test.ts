import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";
import { describe, expect } from "vite-plus/test";

import type { ServerSecretStore } from "../auth/server-secret-store.ts";
import { makeGitHubAccounts } from "./github-accounts.ts";

function makeSecretStore() {
  const values = new Map<string, Uint8Array>();

  const store = {
    get: (name: string) => Effect.sync(() => Option.fromNullishOr(values.get(name))),
    set: (name: string, value: Uint8Array) => Effect.sync(() => void values.set(name, value)),
    create: (name: string, value: Uint8Array) => Effect.sync(() => void values.set(name, value)),
    getOrCreateRandom: (name: string, bytes: number) =>
      Effect.sync(() => values.get(name) ?? new Uint8Array(bytes)),
    remove: (name: string) => Effect.sync(() => void values.delete(name)),
  } satisfies ServerSecretStore["Service"];

  const read = (name: string) => {
    const value = values.get(name);

    return value === undefined ? undefined : JSON.parse(new TextDecoder().decode(value));
  };

  return { store, values, read };
}

interface Call {
  readonly url: string;
  readonly body: Record<string, string>;
  readonly authorization: string | undefined;
}

/** Answers GitHub's endpoints in order from a queue of token responses. */
function fakeGitHub(tokenAnswers: Array<Record<string, unknown>>) {
  const calls: Call[] = [];

  const fetch = async (url: string, init: RequestInit) => {
    const headers = new Headers(init.headers);
    calls.push({
      url,
      body: Object.fromEntries(new URLSearchParams(String(init.body ?? ""))),
      authorization: headers.get("Authorization") ?? undefined,
    });

    const json = (value: unknown) => Response.json(value);

    if (url === "https://github.com/login/device/code")
      return json({
        device_code: "device-1",
        user_code: "ABCD-1234",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 5,
      });

    if (url === "https://github.com/login/oauth/access_token") return json(tokenAnswers.shift());

    return json({ id: 42, login: "ana", name: "Ana Gómez" });
  };

  return { fetch, calls };
}

const issued = {
  access_token: "ghu_first",
  expires_in: 28_800,
  refresh_token: "ghr_first",
  refresh_token_expires_in: 15_897_600,
};

describe("GitHub accounts", () => {
  it.effect("links a person through device flow at GitHub's pace", () =>
    Effect.gen(function* () {
      const { store, read } = makeSecretStore();

      const github = fakeGitHub([
        { error: "authorization_pending" },
        { error: "slow_down", interval: 10 },
        issued,
      ]);

      const accounts = makeGitHubAccounts(store, github.fetch);

      const code = yield* accounts.startLink("person-ana");
      expect(code).toMatchObject({ userCode: "ABCD-1234", intervalSeconds: 5 });

      expect((yield* accounts.pollLink("person-ana")).state).toBe("pending");
      expect(github.calls.filter((call) => call.url.endsWith("access_token"))).toHaveLength(0);

      yield* TestClock.adjust("5 seconds");
      expect((yield* accounts.pollLink("person-ana")).state).toBe("pending");

      yield* TestClock.adjust("5 seconds");
      expect((yield* accounts.pollLink("person-ana")).state).toBe("pending");

      yield* TestClock.adjust("5 seconds");
      expect((yield* accounts.pollLink("person-ana")).state).toBe("pending");
      expect(github.calls.filter((call) => call.url.endsWith("access_token"))).toHaveLength(2);

      yield* TestClock.adjust("5 seconds");
      const linked = yield* accounts.pollLink("person-ana");

      expect(linked).toEqual({
        state: "connected",
        login: "ana",
        installUrl: "https://github.com/apps/otto-by-hello-gafaro/installations/new",
      });
      expect(github.calls.at(-1)).toMatchObject({ authorization: "Bearer ghu_first" });
      expect(read("github-device-person-ana")).toBeUndefined();
      expect(read("github-user-person-ana")).toMatchObject({
        githubId: 42,
        login: "ana",
        name: "Ana Gómez",
        accessToken: "ghu_first",
        refreshToken: "ghr_first",
      });
      expect((yield* accounts.getStatus("person-ana")).login).toBe("ana");
      expect((yield* accounts.getStatus("person-ben")).login).toBeNull();
    }),
  );

  it.effect("stops when the person denies access", () =>
    Effect.gen(function* () {
      const { store, read } = makeSecretStore();
      const accounts = makeGitHubAccounts(store, fakeGitHub([{ error: "access_denied" }]).fetch);

      yield* accounts.startLink("person-ana");
      yield* TestClock.adjust("5 seconds");

      expect((yield* accounts.pollLink("person-ana")).state).toBe("denied");
      expect(read("github-device-person-ana")).toBeUndefined();
      expect(read("github-user-person-ana")).toBeUndefined();
    }),
  );

  it.effect("refreshes a token near its expiry with the client id only", () =>
    Effect.gen(function* () {
      const { store, read } = makeSecretStore();

      const github = fakeGitHub([
        issued,
        { ...issued, access_token: "ghu_second", refresh_token: "ghr_second" },
      ]);

      const accounts = makeGitHubAccounts(store, github.fetch);
      yield* accounts.startLink("person-ana");
      yield* TestClock.adjust("5 seconds");
      yield* accounts.pollLink("person-ana");

      const fresh = yield* accounts.turnLogin("person-ana");
      expect(Option.map(fresh, (login) => login.accessToken)).toEqual(Option.some("ghu_first"));

      yield* TestClock.adjust("450 minutes");
      const refreshed = yield* accounts.turnLogin("person-ana");

      expect(Option.map(refreshed, (login) => login.accessToken)).toEqual(
        Option.some("ghu_second"),
      );
      expect(github.calls.find((call) => call.body.grant_type === "refresh_token")?.body).toEqual({
        client_id: "Iv23liPQaEONwVhkPCQs",
        grant_type: "refresh_token",
        refresh_token: "ghr_first",
      });
      expect(read("github-user-person-ana")).toMatchObject({ refreshToken: "ghr_second" });
    }),
  );

  it.effect("drops a link GitHub no longer refreshes, and disconnects on request", () =>
    Effect.gen(function* () {
      const { store, read } = makeSecretStore();

      const accounts = makeGitHubAccounts(
        store,
        fakeGitHub([issued, { error: "bad_refresh_token" }, issued]).fetch,
      );

      yield* accounts.startLink("person-ana");
      yield* TestClock.adjust("5 seconds");
      yield* accounts.pollLink("person-ana");
      yield* TestClock.adjust("450 minutes");

      expect(Option.isNone(yield* accounts.turnLogin("person-ana"))).toBe(true);
      expect(read("github-user-person-ana")).toBeUndefined();

      yield* accounts.startLink("person-ana");
      yield* TestClock.adjust("5 seconds");
      yield* accounts.pollLink("person-ana");

      expect((yield* accounts.disconnect("person-ana")).login).toBeNull();
      expect(read("github-user-person-ana")).toBeUndefined();
    }),
  );
});
