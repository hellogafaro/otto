import * as Predicate from "effect/Predicate";
import {
  AuthAccessTokenType,
  AuthAccessWriteScope,
  AuthEnvironmentScopes,
  type AuthAccessTokenResult,
  type AuthClientMetadata,
  type AuthClientSession,
  type AuthEnvironmentScope,
  AuthSessionId,
  type AuthSessionState,
  type ServerAuthDescriptor,
  type AuthWebSocketTicketResult,
} from "@otto/contracts";
import { encodeOAuthScope } from "@otto/shared/oauthScope";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as ServerEnvironment from "../environment/server-environment.ts";
import * as EnvironmentAuthPolicy from "./environment-auth-policy.ts";
import * as ServerSecretStore from "./server-secret-store.ts";
import * as SessionStore from "./session-store.ts";
import * as OrganizationAccounts from "./organization-accounts.ts";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Schema from "effect/Schema";
import { layerConfig as SqlitePersistenceLayer } from "../persistence/layers/sqlite.ts";
import { type AuthenticatedSession } from "./environment-auth-types.ts";
import {
  ServerAuthSessionCredentialValidationError,
  ServerAuthSessionsListError,
  ServerAuthSessionRevocationError,
  ServerAuthWebSocketTokenIssueError,
  ServerAuthInternalError,
  ServerAuthMissingCredentialError,
  ServerAuthInvalidCredentialError,
  ServerAuthCredentialError,
  isServerAuthCredentialError,
  ServerAuthScopeNotGrantedError,
  ServerAuthInvalidRequestError,
  ServerAuthForbiddenOperationError,
} from "./environment-auth-errors.ts";

export class EnvironmentAuth extends Context.Service<
  EnvironmentAuth,
  {
    readonly getDescriptor: () => Effect.Effect<ServerAuthDescriptor>;
    readonly getSessionState: (
      request: HttpServerRequest.HttpServerRequest,
    ) => Effect.Effect<AuthSessionState, ServerAuthInternalError>;
    readonly exchangeBootstrapCredentialForAccessToken: (
      credential: string,
      requestedScopes: ReadonlyArray<AuthEnvironmentScope> | undefined,
      requestMetadata: AuthClientMetadata,
    ) => Effect.Effect<
      AuthAccessTokenResult,
      ServerAuthInvalidCredentialError | ServerAuthInvalidRequestError | ServerAuthInternalError
    >;
    readonly listSessions: () => Effect.Effect<
      ReadonlyArray<AuthClientSession>,
      ServerAuthInternalError
    >;
    readonly revokeSession: (
      sessionId: AuthSessionId,
    ) => Effect.Effect<boolean, ServerAuthInternalError>;
    readonly revokeOtherSessionsExcept: (
      sessionId: AuthSessionId,
    ) => Effect.Effect<number, ServerAuthInternalError>;
    readonly listClientSessions: (
      currentSessionId: AuthSessionId,
    ) => Effect.Effect<ReadonlyArray<AuthClientSession>, ServerAuthInternalError>;
    readonly revokeClientSession: (
      currentSessionId: AuthSessionId,
      targetSessionId: AuthSessionId,
    ) => Effect.Effect<boolean, ServerAuthForbiddenOperationError | ServerAuthInternalError>;
    readonly revokeOtherClientSessions: (
      currentSessionId: AuthSessionId,
    ) => Effect.Effect<number, ServerAuthInternalError>;
    readonly authenticateHttpRequest: (
      request: Pick<HttpServerRequest.HttpServerRequest, "cookies" | "headers">,
    ) => Effect.Effect<AuthenticatedSession, ServerAuthCredentialError | ServerAuthInternalError>;
    readonly authenticateWebSocketUpgrade: (
      request: HttpServerRequest.HttpServerRequest,
    ) => Effect.Effect<AuthenticatedSession, ServerAuthCredentialError | ServerAuthInternalError>;
    readonly issueWebSocketTicket: (
      session: Pick<AuthenticatedSession, "sessionId">,
    ) => Effect.Effect<AuthWebSocketTicketResult, ServerAuthInternalError>;
  }
>()("@otto/server/auth/environment-auth/EnvironmentAuth") {}

const AUTHORIZATION_PREFIX = "Bearer ";

const WEBSOCKET_TICKET_QUERY_PARAM = "wsTicket";

const encodeScopesJson = Schema.encodeEffect(Schema.fromJsonString(AuthEnvironmentScopes));

const bySessionPriority = (left: AuthClientSession, right: AuthClientSession) => {
  const leftCanManage = left.scopes.includes(AuthAccessWriteScope);
  const rightCanManage = right.scopes.includes(AuthAccessWriteScope);

  if (leftCanManage !== rightCanManage) {
    return leftCanManage ? -1 : 1;
  }

  if (left.connected !== right.connected) {
    return left.connected ? -1 : 1;
  }

  return right.issuedAt.epochMilliseconds - left.issuedAt.epochMilliseconds;
};

const mapSessionVerificationErrors = <A, R>(
  effect: Effect.Effect<A, SessionStore.SessionCredentialError, R>,
): Effect.Effect<A, ServerAuthInvalidCredentialError | ServerAuthInternalError, R> =>
  effect.pipe(
    Effect.mapError((cause) =>
      SessionStore.isSessionCredentialInvalidError(cause)
        ? new ServerAuthInvalidCredentialError({ cause })
        : new ServerAuthSessionCredentialValidationError({ cause }),
    ),
  );

function parseBearerToken(
  request: Pick<HttpServerRequest.HttpServerRequest, "headers">,
): string | null {
  const header = request.headers["authorization"];

  if (!Predicate.isString(header) || !header.startsWith(AUTHORIZATION_PREFIX)) {
    return null;
  }

  const token = header.slice(AUTHORIZATION_PREFIX.length).trim();

  return token.length > 0 ? token : null;
}

export function selectRequestCredential(
  request: Pick<HttpServerRequest.HttpServerRequest, "cookies" | "headers">,
  cookieName: string,
  legacyCookieName: string | undefined,
) {
  const cookieToken = request.cookies[cookieName];

  if (cookieToken !== undefined) {
    return { token: cookieToken, source: "cookie" } as const;
  }

  const bearerToken = parseBearerToken(request);

  if (bearerToken !== null) {
    return { token: bearerToken, source: "bearer" } as const;
  }

  const legacyToken = legacyCookieName ? request.cookies[legacyCookieName] : undefined;

  if (legacyToken !== undefined) {
    return { token: legacyToken, source: "legacy-cookie" } as const;
  }

  return undefined;
}

export const make = Effect.gen(function* () {
  const policy = yield* EnvironmentAuthPolicy.EnvironmentAuthPolicy;
  const sessions = yield* SessionStore.SessionStore;
  const accounts = yield* OrganizationAccounts.OrganizationAccounts;
  const sql = yield* SqlClient.SqlClient;
  const descriptor = yield* policy.getDescriptor();

  const authenticateToken = Effect.fn("EnvironmentAuth.authenticateAccount")(function* (
    token: string,
    method: AuthenticatedSession["method"] = "bearer-access-token",
  ) {
    const principal = yield* accounts
      .authenticate(new Headers({ authorization: `Bearer ${token}` }))
      .pipe(Effect.mapError((cause) => new ServerAuthSessionCredentialValidationError({ cause })));

    if (!principal) return yield* new ServerAuthInvalidCredentialError({});

    const scopes = OrganizationAccounts.organizationRoleScopes(principal.role);
    const now = DateTime.formatIso(yield* DateTime.now);
    const expiresAt = DateTime.makeUnsafe(principal.expiresAt);

    const encodedScopes = yield* encodeScopesJson(scopes).pipe(
      Effect.mapError((cause) => new ServerAuthSessionCredentialValidationError({ cause })),
    );

    yield* sql`
      INSERT INTO auth_sessions (
        session_id, subject, scopes, method, client_label, client_device_type, issued_at, expires_at
      ) VALUES (
        ${principal.sessionId}, ${principal.userId}, ${encodedScopes}, ${method},
        ${`${principal.firstName} ${principal.lastName}`}, 'unknown', ${now}, ${DateTime.formatIso(expiresAt)}
      ) ON CONFLICT(session_id) DO UPDATE SET scopes = excluded.scopes, expires_at = excluded.expires_at
    `.pipe(Effect.mapError((cause) => new ServerAuthSessionCredentialValidationError({ cause })));

    return {
      sessionId: AuthSessionId.make(principal.sessionId),
      subject: principal.userId,
      method,
      scopes,
      expiresAt,
    } satisfies AuthenticatedSession;
  });

  const authenticateRequest = (
    request: Pick<HttpServerRequest.HttpServerRequest, "cookies" | "headers">,
  ): Effect.Effect<AuthenticatedSession, ServerAuthCredentialError | ServerAuthInternalError> => {
    const credential = selectRequestCredential(
      request,
      sessions.cookieName,
      sessions.legacyCookieName,
    );

    if (!credential?.token) {
      return Effect.fail(new ServerAuthMissingCredentialError({}));
    }

    return authenticateToken(
      credential.token,
      credential.source === "bearer" ? "bearer-access-token" : "browser-session-cookie",
    );
  };

  const getSessionState: EnvironmentAuth["Service"]["getSessionState"] = (request) =>
    authenticateRequest(request).pipe(
      Effect.map(
        (session) =>
          ({
            authenticated: true,
            auth: descriptor,
            scopes: session.scopes,
            sessionMethod: session.method,
            ...(session.expiresAt ? { expiresAt: DateTime.toUtc(session.expiresAt) } : {}),
          }) satisfies AuthSessionState,
      ),
      Effect.catchIf(isServerAuthCredentialError, () =>
        Effect.succeed({
          authenticated: false,
          auth: descriptor,
        } satisfies AuthSessionState),
      ),
      Effect.withSpan("EnvironmentAuth.getSessionState"),
    );

  const exchangeBootstrapCredentialForAccessToken: EnvironmentAuth["Service"]["exchangeBootstrapCredentialForAccessToken"] =
    (credential, requestedScopes) =>
      Effect.gen(function* () {
        const session = yield* authenticateToken(credential);
        const grantedScopes = requestedScopes ?? session.scopes;

        if (!grantedScopes.every((scope) => session.scopes.includes(scope))) {
          return yield* new ServerAuthScopeNotGrantedError({});
        }

        const now = yield* DateTime.now;

        return {
          access_token: credential,
          issued_token_type: AuthAccessTokenType,
          token_type: "Bearer",
          expires_in: Math.max(
            0,
            Math.floor((DateTime.toEpochMillis(session.expiresAt) - now.epochMilliseconds) / 1000),
          ),
          scope: encodeOAuthScope(grantedScopes),
        } satisfies AuthAccessTokenResult;
      });

  const listSessions: EnvironmentAuth["Service"]["listSessions"] = () =>
    sessions.listActive().pipe(
      Effect.map((activeSessions) =>
        activeSessions
          .filter((session) => accounts.runtime.getPrincipal(session.sessionId) !== null)
          .toSorted(bySessionPriority),
      ),
      Effect.mapError((cause) => new ServerAuthSessionsListError({ cause })),
      Effect.withSpan("EnvironmentAuth.listSessions"),
    );

  const revokeSession: EnvironmentAuth["Service"]["revokeSession"] = (sessionId) =>
    Effect.sync(() => accounts.runtime.revokeSession(sessionId)).pipe(
      Effect.andThen(sessions.revoke(sessionId)),
      Effect.mapError((cause) => new ServerAuthSessionRevocationError({ cause })),
      Effect.withSpan("EnvironmentAuth.revokeSession"),
    );

  const revokeOtherSessionsExcept: EnvironmentAuth["Service"]["revokeOtherSessionsExcept"] = (
    sessionId,
  ) =>
    listSessions().pipe(
      Effect.flatMap((active) =>
        Effect.forEach(
          active.filter((session) => session.sessionId !== sessionId),
          (session) => revokeSession(session.sessionId),
        ),
      ),
      Effect.map((revoked) => revoked.filter(Boolean).length),
    );

  const listClientSessions: EnvironmentAuth["Service"]["listClientSessions"] = (currentSessionId) =>
    listSessions().pipe(
      Effect.map((clientSessions) =>
        clientSessions.map(
          (clientSession): AuthClientSession => ({
            ...clientSession,
            current: clientSession.sessionId === currentSessionId,
          }),
        ),
      ),
      Effect.withSpan("EnvironmentAuth.listClientSessions"),
    );

  const revokeClientSession: EnvironmentAuth["Service"]["revokeClientSession"] = Effect.fn(
    "EnvironmentAuth.revokeClientSession",
  )(function* (currentSessionId, targetSessionId) {
    if (currentSessionId === targetSessionId) {
      return yield* new ServerAuthForbiddenOperationError({});
    }

    return yield* revokeSession(targetSessionId);
  });

  const revokeOtherClientSessions: EnvironmentAuth["Service"]["revokeOtherClientSessions"] = (
    currentSessionId,
  ) =>
    revokeOtherSessionsExcept(currentSessionId).pipe(
      Effect.withSpan("EnvironmentAuth.revokeOtherClientSessions"),
    );

  const issueWebSocketTicket: EnvironmentAuth["Service"]["issueWebSocketTicket"] = (session) =>
    sessions.issueWebSocketToken(session.sessionId).pipe(
      Effect.mapError((cause) => new ServerAuthWebSocketTokenIssueError({ cause })),
      Effect.map(
        (issued) =>
          ({
            ticket: issued.token,
            expiresAt: DateTime.toUtc(issued.expiresAt),
          }) satisfies AuthWebSocketTicketResult,
      ),
      Effect.withSpan("EnvironmentAuth.issueWebSocketTicket"),
    );

  const authenticateHttpRequest: EnvironmentAuth["Service"]["authenticateHttpRequest"] = (
    request,
  ) =>
    authenticateRequest(request).pipe(Effect.withSpan("EnvironmentAuth.authenticateHttpRequest"));

  const authenticateWebSocketUpgrade: EnvironmentAuth["Service"]["authenticateWebSocketUpgrade"] =
    Effect.fn("EnvironmentAuth.authenticateWebSocketUpgrade")(function* (request) {
      const requestUrl = HttpServerRequest.toURL(request);

      if (Option.isSome(requestUrl)) {
        const websocketTicket = requestUrl.value.searchParams.get(WEBSOCKET_TICKET_QUERY_PARAM);

        if (websocketTicket && websocketTicket.trim().length > 0) {
          return yield* sessions.verifyWebSocketToken(websocketTicket).pipe(
            mapSessionVerificationErrors,
            Effect.flatMap((session) =>
              accounts.getPrincipal(session.sessionId).pipe(
                Effect.mapError(
                  (cause) => new ServerAuthSessionCredentialValidationError({ cause }),
                ),
                Effect.flatMap((principal) =>
                  principal
                    ? Effect.succeed({
                        sessionId: session.sessionId,
                        subject: principal.userId,
                        method: session.method,
                        scopes: OrganizationAccounts.organizationRoleScopes(principal.role),
                        expiresAt: DateTime.makeUnsafe(principal.expiresAt),
                      })
                    : Effect.fail(new ServerAuthInvalidCredentialError({})),
                ),
              ),
            ),
          );
        }
      }

      return yield* authenticateRequest(request);
    });

  return EnvironmentAuth.of({
    getDescriptor: () =>
      Effect.succeed(descriptor).pipe(Effect.withSpan("EnvironmentAuth.getDescriptor")),
    getSessionState,
    exchangeBootstrapCredentialForAccessToken,
    listSessions,
    revokeSession,
    revokeOtherSessionsExcept,
    listClientSessions,
    revokeClientSession,
    revokeOtherClientSessions,
    authenticateHttpRequest,
    authenticateWebSocketUpgrade,
    issueWebSocketTicket,
  });
});

export const layer = Layer.effect(EnvironmentAuth, make).pipe(
  Layer.provideMerge(OrganizationAccounts.layer),
  Layer.provideMerge(SessionStore.layer),
  Layer.provideMerge(EnvironmentAuthPolicy.layer),
);

export const storageLayer = ServerSecretStore.layer.pipe(
  Layer.provideMerge(SqlitePersistenceLayer),
);

export const runtimeLayer = layer.pipe(
  Layer.provideMerge(storageLayer),
  Layer.provideMerge(ServerEnvironment.identityLayer),
);

export { isEnvironmentHostSessionSubject } from "./environment-auth-types.ts";

export type { AuthenticatedSession } from "./environment-auth-types.ts";

export { ServerAuthBootstrapCredentialValidationError } from "./environment-auth-errors.ts";

export { ServerAuthSessionCredentialValidationError } from "./environment-auth-errors.ts";

export { ServerAuthAuthenticatedSessionIssueError } from "./environment-auth-errors.ts";

export { ServerAuthAuthenticatedAccessTokenIssueError } from "./environment-auth-errors.ts";

export { ServerAuthSessionsListError } from "./environment-auth-errors.ts";

export { ServerAuthSessionRevocationError } from "./environment-auth-errors.ts";

export { ServerAuthOtherSessionsRevocationError } from "./environment-auth-errors.ts";

export { ServerAuthWebSocketTokenIssueError } from "./environment-auth-errors.ts";

export { ServerAuthInternalError } from "./environment-auth-errors.ts";

export { isServerAuthInternalError } from "./environment-auth-errors.ts";

export { ServerAuthMissingCredentialError } from "./environment-auth-errors.ts";

export { ServerAuthInvalidCredentialError } from "./environment-auth-errors.ts";

export { ServerAuthCredentialError } from "./environment-auth-errors.ts";

export { isServerAuthCredentialError } from "./environment-auth-errors.ts";

export { serverAuthCredentialReason } from "./environment-auth-errors.ts";

export { ServerAuthInvalidScopeError } from "./environment-auth-errors.ts";

export { ServerAuthScopeNotGrantedError } from "./environment-auth-errors.ts";

export { ServerAuthInvalidRequestError } from "./environment-auth-errors.ts";

export { isServerAuthInvalidRequestError } from "./environment-auth-errors.ts";

export { serverAuthInvalidRequestReason } from "./environment-auth-errors.ts";

export { ServerAuthForbiddenOperationError } from "./environment-auth-errors.ts";
