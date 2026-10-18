import type { AgentControllerLiveOptions } from "./options.ts";

import { ProviderInstanceId, ThreadId } from "@otto/contracts";

import * as Effect from "effect/Effect";

import * as Option from "effect/Option";

import * as McpProviderSession from "../../../mcp/mcp-provider-session.ts";
import * as McpInvocationContext from "../../../mcp/mcp-invocation-context.ts";
import * as McpSessionRegistry from "../../../mcp/mcp-session-registry.ts";
import * as ServerSettings from "../../../server-settings.ts";

export function createPreviewMcpSessions(deps: {
  readonly options: AgentControllerLiveOptions | undefined;
  readonly mcpSessionRegistry: Option.Option<McpSessionRegistry.McpSessionRegistryShape>;
  readonly serverSettings: Option.Option<ServerSettings.ServerSettingsService["Service"]>;
}) {
  const mcpSessionRegistry = deps.mcpSessionRegistry;

  const issueMcpCredential =
    deps.options?.issueMcpCredential ??
    (Option.isSome(mcpSessionRegistry)
      ? (request: McpSessionRegistry.McpCredentialRequest) =>
          mcpSessionRegistry.value.revokeThread(request.threadId).pipe(
            Effect.andThen(mcpSessionRegistry.value.issue(request)),
            Effect.map((credential) => ({ config: credential.config })),
          )
      : McpSessionRegistry.issueActiveMcpCredential);

  const revokeMcpCredential =
    deps.options?.revokeMcpCredential ??
    (Option.isSome(mcpSessionRegistry)
      ? mcpSessionRegistry.value.revokeThread
      : McpSessionRegistry.revokeActiveMcpThread);

  const clearPreviewMcpSession = (threadId: ThreadId) =>
    revokeMcpCredential(threadId).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          McpProviderSession.clearMcpProviderSession(threadId);
        }),
      ),
    );

  const preparePreviewMcpSession = (threadId: ThreadId, providerInstanceId: ProviderInstanceId) =>
    Effect.gen(function* () {
      // Matches ProviderService's capabilities: an unreadable settings file withholds image.
      const imageEnabled = Option.isSome(deps.serverSettings)
        ? yield* deps.serverSettings.value.getSettings.pipe(
            Effect.map(
              (settings) =>
                settings.imageGeneration.chatgptEnabled || settings.imageGeneration.grokEnabled,
            ),
            Effect.orElseSucceed(() => false),
          )
        : false;

      const capabilities = new Set<McpInvocationContext.McpCapability>(
        imageEnabled ? ["image"] : [],
      );

      if (capabilities.size === 0) {
        yield* clearPreviewMcpSession(threadId);

        return;
      }

      const credential = yield* issueMcpCredential({
        threadId,
        providerInstanceId,
        capabilities,
      });

      if (credential) {
        yield* Effect.sync(() => McpProviderSession.setMcpProviderSession(credential.config));
      }
    });

  return {
    issueMcpCredential,
    revokeMcpCredential,
    clearPreviewMcpSession,
    preparePreviewMcpSession,
  };
}
