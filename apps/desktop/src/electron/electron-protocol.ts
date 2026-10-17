import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as NodeTimersPromises from "node:timers/promises";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";

import * as Electron from "electron";

export const DESKTOP_HOST = "app";

export const DESKTOP_PRODUCTION_SCHEME = "otto";

export const DESKTOP_DEVELOPMENT_SCHEME = "otto-dev";

export function getDesktopScheme(isDevelopment: boolean): string {
  return isDevelopment ? DESKTOP_DEVELOPMENT_SCHEME : DESKTOP_PRODUCTION_SCHEME;
}

export function getDesktopOrigin(isDevelopment: boolean): string {
  return `${getDesktopScheme(isDevelopment)}://${DESKTOP_HOST}`;
}

export function getDesktopUrl(isDevelopment: boolean): string {
  return `${getDesktopOrigin(isDevelopment)}/`;
}

export class ElectronProtocolRegistrationError extends Schema.TaggedErrorClass<ElectronProtocolRegistrationError>()(
  "ElectronProtocolRegistrationError",
  {
    scheme: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to register Electron protocol scheme "${this.scheme}".`;
  }
}

export class ElectronProtocolUnregistrationError extends Schema.TaggedErrorClass<ElectronProtocolUnregistrationError>()(
  "ElectronProtocolUnregistrationError",
  {
    scheme: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to unregister Electron protocol scheme "${this.scheme}".`;
  }
}

export interface DesktopProtocolRegistrationInput {
  readonly scheme: string;
  /** The bundled local server, or the Vite dev server in development. */
  readonly localOrigin: URL;
  /** The remote Otto server the desktop is connected to; its web app replaces the local one. */
  readonly serverOrigin: URL | null;
}

export class ElectronProtocol extends Context.Service<
  ElectronProtocol,
  {
    readonly registerDesktopProtocol: (
      input: DesktopProtocolRegistrationInput,
    ) => Effect.Effect<void, ElectronProtocolRegistrationError, Scope.Scope>;
    readonly setServerOrigin: (serverOrigin: URL | null) => Effect.Effect<void>;
  }
>()("@otto/desktop/electron/electron-protocol/ElectronProtocol") {}

export function makeDesktopContentSecurityPolicy(scheme: string): string {
  const scriptSources = ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'"];

  // The renderer connects directly to user-configured environments. Those environment
  // origins are not known when this response policy is created, so restrict
  // connections by the network schemes the client supports instead of by host.
  const connectSources = ["'self'", "http:", "https:", "ws:", "wss:"];

  return [
    "default-src 'self'",
    `script-src ${scriptSources.join(" ")}`,
    `connect-src ${connectSources.join(" ")}`,
    `img-src 'self' ${scheme}: blob: data: http: https:`,
    "style-src 'self' 'unsafe-inline'",
    `font-src 'self' ${scheme}: data:`,
    "worker-src 'self' blob:",
    "frame-src 'self' https://challenges.cloudflare.com",
    "form-action 'self'",
  ].join("; ");
}

function withContentSecurityPolicy(response: Response, policy: string): Response {
  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", policy);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Must run synchronously during process bootstrap, before Electron emits `ready`.
 */
export function registerDesktopSchemePrivilegesSync(): void {
  Electron.protocol.registerSchemesAsPrivileged([
    {
      scheme: DESKTOP_PRODUCTION_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
    {
      scheme: DESKTOP_DEVELOPMENT_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
  ]);
}

const registerDesktopSchemePrivileges = Effect.sync(registerDesktopSchemePrivilegesSync).pipe(
  Effect.withSpan("desktop.electron.protocol.registerSchemePrivileges"),
);

export const layerSchemePrivileges = Layer.effectDiscard(registerDesktopSchemePrivileges);

// Otto: shown instead of a blank window when the connected server cannot be reached, so the
// person can retry or go back to the bundled server without a web app.
function unreachableServerPage(serverOrigin: URL): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Otto</title>
<style>body{font:14px system-ui;display:grid;place-content:center;gap:12px;height:100vh;margin:0;background:#fafafa;color:#171717}@media (prefers-color-scheme:dark){body{background:#171717;color:#fafafa}}button{font:inherit;padding:6px 12px}</style>
<p>Can't reach the Otto server at ${serverOrigin.host}.</p>
<p><button onclick="location.reload()">Try again</button> <button onclick="desktopBridge.setServerUrl(null)">Use this computer</button></p>`,
    { status: 502, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

async function proxyRequest(
  request: Request,
  targetOrigin: URL,
  isServer: boolean,
  contentSecurityPolicy: string,
): Promise<Response> {
  const requestUrl = new URL(request.url);

  if (requestUrl.host !== DESKTOP_HOST) {
    return new Response(null, { status: 404 });
  }

  const targetUrl = new URL(`${requestUrl.pathname}${requestUrl.search}`, targetOrigin);
  const headers = new Headers(request.headers);
  const headersToRemove: string[] = [];

  for (const name of headers.keys()) {
    if (
      name === "host" ||
      name === "origin" ||
      name === "referer" ||
      name === "connection" ||
      name === "content-length" ||
      name === "accept-encoding" ||
      name === "upgrade-insecure-requests" ||
      name.startsWith("sec-fetch-")
    ) {
      headersToRemove.push(name);
    }
  }

  for (const name of headersToRemove) {
    headers.delete(name);
  }

  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers,
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    init.duplex = "half";
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return withContentSecurityPolicy(
      await Electron.net.fetch(targetUrl.toString(), init),
      contentSecurityPolicy,
    );
  }

  try {
    return withContentSecurityPolicy(
      await fetchWithTransientRetry(targetUrl.toString(), init),
      contentSecurityPolicy,
    );
  } catch (error) {
    if (isServer && request.headers.get("accept")?.includes("text/html")) {
      return withContentSecurityPolicy(unreachableServerPage(targetOrigin), contentSecurityPolicy);
    }

    throw error;
  }
}

const TRANSIENT_FETCH_RETRY_DELAYS_MS = [0, 50, 150] as const;

async function fetchWithTransientRetry(url: string, init: RequestInit): Promise<Response> {
  let lastError: unknown;

  for (const delayMs of TRANSIENT_FETCH_RETRY_DELAYS_MS) {
    if (delayMs > 0) {
      await NodeTimersPromises.setTimeout(delayMs);
    }

    try {
      return await Electron.net.fetch(url, init);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

export const make = Effect.gen(function* () {
  const registered = yield* Ref.make<ReadonlySet<string>>(new Set());
  let serverOrigin: URL | null = null;

  const registerDesktopProtocol = Effect.fn("desktop.electron.protocol.registerDesktopProtocol")(
    function* (input: DesktopProtocolRegistrationInput) {
      const shouldRegister = yield* Ref.modify(registered, (schemes) => {
        if (schemes.has(input.scheme)) return [false, schemes] as const;

        return [true, new Set([...schemes, input.scheme])] as const;
      });

      if (!shouldRegister) return;

      const contentSecurityPolicy = makeDesktopContentSecurityPolicy(input.scheme);
      serverOrigin = input.serverOrigin;

      yield* Effect.acquireRelease(
        Effect.try({
          try: () => {
            Electron.protocol.handle(input.scheme, (request) =>
              proxyRequest(
                request,
                serverOrigin ?? input.localOrigin,
                serverOrigin !== null,
                contentSecurityPolicy,
              ),
            );
          },
          catch: (cause) => new ElectronProtocolRegistrationError({ scheme: input.scheme, cause }),
        }).pipe(
          Effect.tapError(() =>
            Ref.update(registered, (schemes) => {
              const next = new Set(schemes);
              next.delete(input.scheme);

              return next;
            }),
          ),
        ),
        () =>
          Effect.try({
            try: () => Electron.protocol.unhandle(input.scheme),
            catch: (cause) =>
              new ElectronProtocolUnregistrationError({
                scheme: input.scheme,
                cause,
              }),
          }).pipe(
            Effect.andThen(
              Ref.update(registered, (schemes) => {
                const next = new Set(schemes);
                next.delete(input.scheme);

                return next;
              }),
            ),
            Effect.orDie,
          ),
      );
    },
  );

  return ElectronProtocol.of({
    registerDesktopProtocol,
    setServerOrigin: (origin) =>
      Effect.sync(() => {
        serverOrigin = origin;
      }),
  });
});

export const layer = Layer.effect(ElectronProtocol, make);
