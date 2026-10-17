import * as Predicate from "effect/Predicate";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { AuthAccessTokenType, WS_METHODS } from "@otto/contracts";
import { assert, it } from "@effect/vitest";
import { assertInclude } from "@effect/vitest/utils";
import * as Effect from "effect/Effect";

import { buildAppUnderTest } from "./server-test-app.ts";
import {
  getHttpServerUrl,
  fetchEffect,
  responseJsonEffect,
  crossOriginClientOrigin,
  assertBrowserApiCorsResponseHeaders,
  signInTestAccount,
  exchangeAccessToken,
  getMemberBearerSessionToken,
  getWsServerUrlForBearer,
  parseSessionCookieFromWsUrl,
  getWsServerUrl,
  NodeHttpServerTestWithWsDeflate,
  getAuthenticatedBearerSessionToken,
  withWsRpcClient,
  appendSessionCookieToWsUrl,
} from "./server-test-clients.ts";
import { defaultTestAccount, testEnvironmentDescriptor } from "./server-test-fixtures.ts";

it.layer(NodeServices.layer)("server router seam", (it) => {
  it.effect("serves the public environment descriptor without requiring auth", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest();

      const url = yield* getHttpServerUrl("/.well-known/ottoLegacy/environment");
      const response = yield* fetchEffect(url);
      const body = yield* responseJsonEffect<typeof testEnvironmentDescriptor>(response);

      assert.equal(response.status, 200);
      assert.deepEqual(body, testEnvironmentDescriptor);
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("compresses large JSON responses through the composed routes", () =>
    Effect.gen(function* () {
      const descriptor = {
        ...testEnvironmentDescriptor,
        label: "Test environment".repeat(100),
      };

      yield* buildAppUnderTest({
        layers: {
          serverEnvironment: {
            getDescriptor: Effect.succeed(descriptor),
          },
        },
      });

      const url = yield* getHttpServerUrl("/.well-known/ottoLegacy/environment");

      const response = yield* fetchEffect(url, {
        headers: {
          "accept-encoding": "gzip",
        },
      });

      const body = yield* responseJsonEffect<typeof descriptor>(response);

      assert.equal(response.status, 200);
      assert.equal(response.headers["content-encoding"], "gzip");
      assert.equal(response.headers.vary, "Accept-Encoding");
      assert.deepEqual(body, descriptor);
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("signs the desktop app in with a bearer session from its own origin", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest();

      const signIn = yield* fetchEffect(yield* getHttpServerUrl("/api/accounts/sign-in/email"), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "otto://app",
          "sec-fetch-site": "cross-site",
          "sec-fetch-mode": "cors",
        },
        body: JSON.stringify({
          email: defaultTestAccount.email,
          password: defaultTestAccount.password,
        }),
      });

      const token = signIn.headers["set-auth-token"];

      assert.equal(signIn.status, 200);
      assertInclude(signIn.headers["access-control-expose-headers"] ?? "", "set-auth-token");
      assert.isString(token);

      const session = yield* fetchEffect(yield* getHttpServerUrl("/api/auth/session"), {
        headers: { authorization: `Bearer ${token}`, origin: "otto://app" },
      });

      const body = yield* responseJsonEffect<{ readonly authenticated: boolean }>(session);

      assert.isTrue(body.authenticated);
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  const signInStatusFrom = (forwardedFor: string) =>
    Effect.gen(function* () {
      const response = yield* fetchEffect(yield* getHttpServerUrl("/api/accounts/sign-in/email"), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "otto://app",
          "x-forwarded-for": forwardedFor,
        },
        body: JSON.stringify({ email: defaultTestAccount.email, password: "not-the-password" }),
      });

      return response.status;
    });

  it.effect("gives each client behind the https proxy its own sign-in rate limit", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest({ config: { publicOrigin: "https://otto.example.test" } });

      for (let attempt = 0; attempt < 3; attempt++) {
        assert.equal(yield* signInStatusFrom("203.0.113.1, 162.158.10.20"), 401);
      }

      assert.equal(yield* signInStatusFrom("203.0.113.2, 162.158.10.20"), 401);
      assert.equal(yield* signInStatusFrom("198.51.100.7, 203.0.113.1, 162.158.10.20"), 429);
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("ignores a client-sent X-Forwarded-For without a proxy", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest();

      for (let attempt = 0; attempt < 3; attempt++) {
        assert.equal(yield* signInStatusFrom("203.0.113.1"), 401);
      }

      assert.equal(yield* signInStatusFrom("203.0.113.2"), 429);
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("includes CORS headers on public environment descriptor responses", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest();

      const url = yield* getHttpServerUrl("/.well-known/ottoLegacy/environment");

      const response = yield* fetchEffect(url, {
        headers: {
          origin: crossOriginClientOrigin,
        },
      });

      const body = yield* responseJsonEffect<typeof testEnvironmentDescriptor>(response);

      assert.equal(response.status, 200);
      assertBrowserApiCorsResponseHeaders(response.headers);
      assert.deepEqual(body, testEnvironmentDescriptor);
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("reports unauthenticated session state without requiring auth", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest();

      const url = yield* getHttpServerUrl("/api/auth/session");
      const response = yield* fetchEffect(url);

      const body = yield* responseJsonEffect<{
        readonly authenticated: boolean;
        readonly auth: {
          readonly policy: string;
          readonly bootstrapMethods: ReadonlyArray<string>;
          readonly sessionMethods: ReadonlyArray<string>;
          readonly sessionCookieName: string;
        };
      }>(response);

      assert.equal(response.status, 200);
      assert.equal(body.authenticated, false);
      assert.equal(body.auth.policy, "desktop-managed-local");
      assert.deepEqual(body.auth.bootstrapMethods, ["email-password"]);
      assert.deepEqual(body.auth.sessionMethods, ["browser-session-cookie", "bearer-access-token"]);
      // Desktop, so port-scoped: instances scan for a free port and share
      // 127.0.0.1, and cookies are not scoped by port.
      assert.isTrue(body.auth.sessionCookieName.startsWith("ottoLegacy_session_"));
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("signs in with email and authenticates the session endpoint via cookie", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest();

      const { cookie } = yield* signInTestAccount();
      const sessionUrl = yield* getHttpServerUrl("/api/auth/session");
      const sessionResponse = yield* fetchEffect(sessionUrl, { headers: { cookie } });

      const sessionBody = yield* responseJsonEffect<{
        readonly authenticated: boolean;
        readonly sessionMethod?: string;
      }>(sessionResponse);

      assert.equal(sessionResponse.status, 200);
      assert.equal(sessionBody.authenticated, true);
      assert.equal(sessionBody.sessionMethod, "browser-session-cookie");
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("migrates a valid legacy remote-web session cookie", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest({ config: { mode: "web", host: "192.168.1.50" } });

      const { cookie: currentCookie } = yield* signInTestAccount();

      const legacyCookie = currentCookie.replace(
        /^ottoLegacy_session_[^=]+=/,
        "ottoLegacy_session=",
      );

      const sessionUrl = yield* getHttpServerUrl("/api/auth/session");

      const response = yield* fetchEffect(sessionUrl, {
        headers: { cookie: legacyCookie },
      });

      const body = yield* responseJsonEffect<{ readonly authenticated: boolean }>(response);

      assert.equal(body.authenticated, true);
      assert.isTrue(response.headers["set-cookie"]?.startsWith(`${currentCookie};`));
      assert.equal(response.headers["cache-control"], "no-store");
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect.each(["cookie", "bearer"])(
    "does not migrate a stale legacy cookie when %s auth succeeds",
    (source) =>
      Effect.gen(function* () {
        yield* buildAppUnderTest({ config: { mode: "web", host: "192.168.1.50" } });

        const { cookie: sessionCookie, token: sessionToken } = yield* signInTestAccount();
        const sessionUrl = yield* getHttpServerUrl("/api/auth/session");

        const response = yield* fetchEffect(sessionUrl, {
          headers:
            source === "cookie"
              ? { cookie: `${sessionCookie}; ottoLegacy_session=stale` }
              : { authorization: `Bearer ${sessionToken}`, cookie: "ottoLegacy_session=stale" },
        });

        const body = yield* responseJsonEffect<{ readonly authenticated: boolean }>(response);

        assert.equal(body.authenticated, true);
        assert.isUndefined(response.headers["set-cookie"]);
      }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("exchanges an account token for a bearer access token", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest();

      const { response: tokenResponse, body: tokenBody } = yield* exchangeAccessToken(
        yield* getAuthenticatedBearerSessionToken(),
      );

      assert.equal(tokenResponse.status, 200);
      assert.equal(tokenBody.issued_token_type, AuthAccessTokenType);
      assert.equal(tokenBody.token_type, "Bearer");
      assert.equal(
        tokenBody.scope,
        "orchestration:read orchestration:operate access:read access:write",
      );
      assert.equal(Predicate.isString(tokenBody.access_token), true);

      const sessionUrl = yield* getHttpServerUrl("/api/auth/session");

      const sessionResponse = yield* fetchEffect(sessionUrl, {
        headers: {
          authorization: `Bearer ${tokenBody.access_token ?? ""}`,
        },
      });

      const sessionBody = yield* responseJsonEffect<{
        readonly authenticated: boolean;
        readonly sessionMethod?: string;
        readonly scopes?: ReadonlyArray<string>;
      }>(sessionResponse);

      assert.equal(sessionResponse.status, 200);
      assert.equal(sessionBody.authenticated, true);
      assert.equal(sessionBody.sessionMethod, "bearer-access-token");
      assert.deepEqual(sessionBody.scopes, [
        "orchestration:read",
        "orchestration:operate",
        "access:read",
        "access:write",
      ]);
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect(
    "accepts the retired review:write and terminal:operate scopes from older clients and drops them",
    () =>
      Effect.gen(function* () {
        yield* buildAppUnderTest({
          config: {
            host: "0.0.0.0",
          },
        });

        const { response, body } = yield* exchangeAccessToken(
          yield* getMemberBearerSessionToken(),
          {
            scope: "orchestration:read orchestration:operate terminal:operate review:write",
          },
        );

        assert.equal(response.status, 200);
        assert.equal(body.scope, "orchestration:read orchestration:operate");
      }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("negotiates permessage-deflate with clients that offer it", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest();

      const { cookie, url } = parseSessionCookieFromWsUrl(yield* getWsServerUrl("/ws"));

      const openSocket = (perMessageDeflate: boolean) =>
        Effect.acquireRelease(
          Effect.callback<NodeSocket.NodeWS.WebSocket, Error>((resume) => {
            const socket = new NodeSocket.NodeWS.WebSocket(url, {
              perMessageDeflate,
              ...(cookie ? { headers: { cookie } } : {}),
            });

            socket.on("open", () => resume(Effect.succeed(socket)));
            socket.on("error", (error) => resume(Effect.fail(error)));
          }),
          (socket) => Effect.sync(() => socket.close()),
        );

      const compressed = yield* openSocket(true);
      // The ws client records the negotiated extension only when the server's
      // 101 response accepted the offer.
      assert.include(compressed.extensions, "permessage-deflate");

      const plain = yield* openSocket(false);
      assert.notInclude(plain.extensions, "permessage-deflate");
    }).pipe(Effect.scoped, Effect.provide(NodeHttpServerTestWithWsDeflate)),
  );

  it.effect("issues short-lived websocket tickets for authenticated bearer sessions", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest();

      const bearerToken = yield* getAuthenticatedBearerSessionToken();
      const wsTicketUrl = yield* getHttpServerUrl("/api/auth/websocket-ticket");

      const wsTicketResponse = yield* fetchEffect(wsTicketUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${bearerToken}`,
        },
      });

      const wsTicketBody = yield* responseJsonEffect<{
        readonly ticket: string;
        readonly expiresAt: string;
      }>(wsTicketResponse);

      assert.equal(wsTicketResponse.status, 200);
      assert.equal(Predicate.isString(wsTicketBody.ticket), true);
      assert.isTrue(wsTicketBody.ticket.length > 0);
      assert.equal(Predicate.isString(wsTicketBody.expiresAt), true);
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("serves the remote doctor only to administrative clients", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest();

      // Otto: A member gets the standard client scopes; only an organization admin gets access:*.
      const standardWsUrl = yield* getWsServerUrlForBearer(yield* getMemberBearerSessionToken());

      const deniedRead = yield* Effect.flip(
        Effect.scoped(
          withWsRpcClient(standardWsUrl, (client) => client[WS_METHODS.serverGetRemoteDoctor]({})),
        ),
      );

      assert.equal(deniedRead._tag, "EnvironmentAuthorizationError");

      if (Predicate.isTagged(deniedRead, "EnvironmentAuthorizationError")) {
        assert.equal(deniedRead.requiredScope, "access:read");
      }

      const deniedRepair = yield* Effect.flip(
        Effect.scoped(
          withWsRpcClient(standardWsUrl, (client) =>
            client[WS_METHODS.serverRepairRemoteDoctor]({ checkIds: ["logs"] }),
          ),
        ),
      );

      assert.equal(deniedRepair._tag, "EnvironmentAuthorizationError");

      // The test server is not a remote install, so an admin sees an honest "not applicable".
      const adminStatus = yield* Effect.scoped(
        withWsRpcClient(yield* getWsServerUrl("/ws"), (client) =>
          client[WS_METHODS.serverGetRemoteDoctor]({}),
        ),
      );

      assert.deepEqual(adminStatus, { applicable: false, report: null });
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("accepts websocket rpc handshake with a signed-in session cookie", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest();

      const { cookie } = yield* signInTestAccount();

      const wsUrl = appendSessionCookieToWsUrl(
        yield* getWsServerUrl("/ws", { authenticated: false }),
        cookie,
      );

      const response = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) => client[WS_METHODS.serverGetConfig]({})),
      );

      assert.equal(response.environment.environmentId, testEnvironmentDescriptor.environmentId);
      assert.equal(response.auth.policy, "desktop-managed-local");
      assert.equal(response.shellResumeCompletionMarker, true);
      assert.isUndefined(response.shellRevealInFileManager);
      assert.isUndefined(response.shellRevealInFileManagerKind);
      assert.equal(response.threadResumeCompletionMarker, true);
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("advertises the usable file manager and its reveal label", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest({
        layers: {
          externalLauncher: {
            resolveAvailableEditors: () => Effect.succeed(["file-manager"]),
            resolveFileManagerRevealKind: () => Effect.succeed("file-explorer"),
          },
        },
      });

      const { cookie } = yield* signInTestAccount();

      const wsUrl = appendSessionCookieToWsUrl(
        yield* getWsServerUrl("/ws", { authenticated: false }),
        cookie,
      );

      const response = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) => client[WS_METHODS.serverGetConfig]({})),
      );

      assert.deepEqual(response.availableEditors, ["file-manager"]);
      assert.equal(response.shellRevealInFileManager, true);
      assert.equal(response.shellRevealInFileManagerKind, "file-explorer");
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect(
    "rejects websocket rpc handshake when a session token is only provided via query string",
    () =>
      Effect.gen(function* () {
        yield* buildAppUnderTest();

        const { token: sessionToken } = yield* signInTestAccount();
        const wsUrl = `${yield* getWsServerUrl("/ws", { authenticated: false })}?token=${encodeURIComponent(sessionToken)}`;

        const error = yield* Effect.flip(
          Effect.scoped(withWsRpcClient(wsUrl, (client) => client[WS_METHODS.serverGetConfig]({}))),
        );

        assert.equal(error._tag, "RpcClientError");
        assertInclude(String(error), "SocketOpenError");
      }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect(
    "accepts websocket rpc handshake with a dedicated websocket ticket in the query string",
    () =>
      Effect.gen(function* () {
        yield* buildAppUnderTest();

        const bearerToken = yield* getAuthenticatedBearerSessionToken();
        const wsTicketUrl = yield* getHttpServerUrl("/api/auth/websocket-ticket");

        const wsTicketResponse = yield* fetchEffect(wsTicketUrl, {
          method: "POST",
          headers: {
            authorization: `Bearer ${bearerToken}`,
          },
        });

        const wsTicketBody = yield* responseJsonEffect<{
          readonly ticket: string;
        }>(wsTicketResponse);

        const wsUrl = `${yield* getWsServerUrl("/ws", { authenticated: false })}?wsTicket=${encodeURIComponent(wsTicketBody.ticket)}`;

        const response = yield* Effect.scoped(
          withWsRpcClient(wsUrl, (client) => client[WS_METHODS.serverGetConfig]({})),
        );

        assert.equal(response.environment.environmentId, testEnvironmentDescriptor.environmentId);
        assert.equal(response.auth.policy, "desktop-managed-local");
      }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );
});
