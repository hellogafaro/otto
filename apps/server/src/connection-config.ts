import { DomainError } from "@otto/shared";
import type { McpCredentialBinding, ServerConfig } from "./config";
import type { ConnectionOptions } from "./connections";

export function createConnectionOptions(
  config: ServerConfig,
  env: NodeJS.ProcessEnv,
): ConnectionOptions | undefined {
  if (!config.MCP_ORIGIN) return;
  const references = JSON.parse(
    config.MCP_CREDENTIAL_BINDINGS ?? "[]",
  ) as McpCredentialBinding[];
  const bindings = references.map((binding) => {
    const token = env[binding.tokenEnv];
    if (!token || token.length > 65536 || /[^\x21-\x7e]/.test(token))
      throw new Error("Invalid configuration fields: MCP_CREDENTIAL_BINDINGS");
    return { ...binding, token };
  });
  return {
    allowAnonymousMcp: config.MCP_ALLOW_ANONYMOUS === "true",
    http: {
      allowedOrigins: [config.MCP_ORIGIN],
      allowLoopbackHttp: config.MCP_ALLOW_LOOPBACK_HTTP === "true",
    },
    secrets: {
      async resolve(reference, signal) {
        signal.throwIfAborted();
        const binding = bindings.find(
          (item) =>
            item.workspaceId === reference.workspaceId &&
            item.connectionId === reference.connectionId &&
            item.credentialRef === reference.credentialRef,
        );
        if (!binding)
          throw new DomainError(
            "unavailable",
            "Credential scope is not configured",
          );
        return binding.token;
      },
    },
  };
}
