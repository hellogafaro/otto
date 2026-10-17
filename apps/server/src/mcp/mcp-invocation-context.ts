import { type EnvironmentId, type ProviderInstanceId, type ThreadId } from "@otto/contracts";
import * as Context from "effect/Context";

export type McpCapability = "memory" | "image";

export interface McpInvocationScope {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly providerSessionId: string;
  readonly providerInstanceId: ProviderInstanceId;
  readonly capabilities: ReadonlySet<McpCapability>;
  readonly issuedAt: number;
}

export class McpInvocationContext extends Context.Service<
  McpInvocationContext,
  McpInvocationScope
>()("@otto/server/mcp/mcp-invocation-context/McpInvocationContext") {}
