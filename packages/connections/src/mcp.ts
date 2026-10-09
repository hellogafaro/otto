import { DomainError, parseInput, withCleanup } from "@otto/shared";

import { z } from "zod";
import {
  type HttpOptions,
  MAX_OUTPUT_BYTES,
  ProviderError,
  readJson,
  requestHttp,
} from "./http";
import {
  type ConnectionConfig,
  type Discovery,
  JSON_VALUE,
  type JsonValue,
} from "./types";

export const MCP_PROTOCOL_VERSION = "2025-11-25";
type McpConfig = Extract<ConnectionConfig, { type: "mcp" }>;
const RPC_RESPONSE = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]),
  result: JSON_VALUE.optional(),
  error: z.unknown().optional(),
});
export function mcpAction(
  config: McpConfig,
  action: string,
  target: string,
  args: Record<string, JsonValue>,
) {
  if (action === "resource.read") {
    if (!config.resources.includes(target)) throw new DomainError("forbidden");
    parseInput(z.object({}).strict(), args);
    return {
      method: "resources/read",
      params: { uri: target },
      isWrite: false,
    };
  }
  const tool = config.tools.find(
    (candidate) => action === `tool.${candidate.name}`,
  );
  if (!tool || args[tool.targetArgument] !== target)
    throw new DomainError(
      "forbidden",
      "Tool target does not match the approved resource",
    );
  return {
    method: "tools/call",
    params: { name: tool.name, arguments: args },
    isWrite: !tool.readOnly,
  };
}
/** Streamable HTTP JSON/SSE response; no shell transport, sampling, elicitation or external resource following. */
export function createMcpClient(options: { http: HttpOptions }) {
  return {
    async connect(config: McpConfig, credential: string) {
      let sessionId: string | undefined;
      let nextId = 0;
      const endpoint = new URL(config.endpoint);
      async function rpc(
        method: string,
        params: unknown,
        notification = false,
      ): Promise<JsonValue> {
        const id = ++nextId;
        const headers: Record<string, string> = {
          Authorization: `Bearer ${credential}`,
          Accept: "application/json, text/event-stream",
          "Content-Type": "application/json",
        };
        if (method !== "initialize")
          headers["MCP-Protocol-Version"] = MCP_PROTOCOL_VERSION;
        if (sessionId) headers["Mcp-Session-Id"] = sessionId;
        return requestHttp(
          endpoint,
          {
            method: "POST",
            headers,
            body: JSON.stringify(
              notification
                ? { jsonrpc: "2.0", method, params }
                : { jsonrpc: "2.0", id, method, params },
            ),
          },
          options.http,
          async (response) => {
            if (notification) {
              await response.body?.cancel();
              if (response.status !== 202) throw new ProviderError();
              return null;
            }
            const receivedSession = response.headers.get("Mcp-Session-Id");
            if (method === "initialize" && receivedSession) {
              if (!/^[\x21-\x7e]{1,256}$/.test(receivedSession))
                throw new ProviderError();
              sessionId = receivedSession;
            }
            const contentType = response.headers.get("Content-Type") ?? "";
            if (contentType.startsWith("application/json"))
              return result(await readJson(response), id);
            if (!contentType.startsWith("text/event-stream"))
              throw new ProviderError();
            const reader = response.body?.getReader();
            if (!reader) throw new ProviderError();
            const decoder = new TextDecoder("utf-8", { fatal: true });
            let size = 0;
            let pending = "";
            let messages = 0;
            return withCleanup(
              async () => {
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) throw new ProviderError();
                  size += value.byteLength;
                  if (size > MAX_OUTPUT_BYTES) throw new ProviderError();
                  pending += decoder.decode(value, { stream: true });
                  pending = pending.replace(/\r\n/g, "\n");
                  let split = pending.indexOf("\n\n");
                  while (split !== -1) {
                    const event = pending.slice(0, split);
                    pending = pending.slice(split + 2);
                    const data = event
                      .split("\n")
                      .filter((line) => line.startsWith("data:"))
                      .map((line) => line.slice(5).replace(/^ /, ""))
                      .join("\n");
                    if (data) {
                      if (++messages > 100) throw new ProviderError();
                      const parsed: unknown = JSON.parse(data);
                      const message = z
                        .object({
                          id: z.unknown().optional(),
                          method: z.string().optional(),
                        })
                        .parse(parsed);
                      if (message.id !== undefined) return result(parsed, id);
                      // Notifications are not tool authorizations or user-visible output.
                      if (!message.method) throw new ProviderError();
                    }
                    split = pending.indexOf("\n\n");
                  }
                }
              },
              async () => {
                try {
                  await reader.cancel();
                } finally {
                  reader.releaseLock();
                }
              },
            );
          },
        );
      }
      async function close() {
        if (!sessionId) return;
        try {
          await requestHttp(
            endpoint,
            {
              method: "DELETE",
              headers: {
                Authorization: `Bearer ${credential}`,
                "Mcp-Session-Id": sessionId,
                "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
              },
            },
            options.http,
            async (response) => {
              await response.body?.cancel();
            },
          );
        } catch (error) {
          // Already-expired sessions and servers without DELETE have no cleanup action.
          if (
            !(error instanceof ProviderError) ||
            ![404, 405].includes(error.status ?? 0)
          )
            throw error;
        }
      }
      try {
        const initialized = z
          .object({
            protocolVersion: z.literal(MCP_PROTOCOL_VERSION),
            capabilities: z.object({
              tools: z.unknown().optional(),
              resources: z.unknown().optional(),
            }),
            serverInfo: z.object({ name: z.string(), version: z.string() }),
          })
          .safeParse(
            await rpc("initialize", {
              protocolVersion: MCP_PROTOCOL_VERSION,
              capabilities: {},
              clientInfo: { name: "otto", version: "0.0.1" },
            }),
          );
        if (!initialized.success)
          throw new DomainError("unavailable", "MCP protocol is unsupported");
        await rpc("notifications/initialized", {}, true);
        const discovery: Discovery = { actions: [], resources: [] };
        if (initialized.data.capabilities.tools !== undefined) {
          const tools = z
            .object({
              tools: z
                .array(
                  z.object({
                    name: z.string(),
                    inputSchema: z
                      .object({ type: z.literal("object") })
                      .passthrough(),
                  }),
                )
                .max(100),
              nextCursor: z.string().optional(),
            })
            .parse(await rpc("tools/list", {}));
          if (tools.nextCursor)
            throw new DomainError("unavailable", "MCP discovery exceeds limit");
          discovery.actions.push(
            ...config.tools
              .filter((tool) =>
                tools.tools.some((found) => found.name === tool.name),
              )
              .map((tool) => `tool.${tool.name}`),
          );
        }
        if (initialized.data.capabilities.resources !== undefined) {
          const resources = z
            .object({
              resources: z.array(z.object({ uri: z.string() })).max(100),
              nextCursor: z.string().optional(),
            })
            .parse(await rpc("resources/list", {}));
          if (resources.nextCursor)
            throw new DomainError("unavailable", "MCP discovery exceeds limit");
          discovery.resources = config.resources.filter((uri) =>
            resources.resources.some((resource) => resource.uri === uri),
          );
          discovery.actions.push("resource.read");
        }
        const readableResources = [...discovery.resources];
        // Configured tool targets are human-approved resource scopes, not resources/list expansion.
        discovery.resources = [
          ...new Set([...discovery.resources, ...config.resources]),
        ];
        return {
          discovery,
          async execute(
            action: string,
            target: string,
            args: Record<string, JsonValue>,
          ) {
            if (
              !discovery.actions.includes(action) ||
              !discovery.resources.includes(target)
            )
              throw new DomainError("forbidden");
            if (
              action === "resource.read" &&
              !readableResources.includes(target)
            )
              throw new DomainError("forbidden");
            const request = mcpAction(config, action, target, args);
            const value = await rpc(request.method, request.params);
            if (action === "resource.read") {
              const parsed = z
                .object({
                  contents: z
                    .array(
                      z.object({
                        uri: z.string(),
                        text: z.string().optional(),
                        blob: z.string().optional(),
                        mimeType: z.string().optional(),
                      }),
                    )
                    .max(50),
                })
                .parse(value);
              if (parsed.contents.some((content) => content.uri !== target))
                throw new DomainError(
                  "forbidden",
                  "MCP returned a different resource",
                );
              return parsed.contents.map((content) => ({
                uri: content.uri,
                text: content.text ?? null,
                blob: content.blob ?? null,
                mimeType: content.mimeType ?? null,
              }));
            }
            const parsed = z
              .object({
                isError: z.boolean().optional(),
                content: z.array(JSON_VALUE).max(100),
                structuredContent: JSON_VALUE.optional(),
              })
              .parse(value);
            if (parsed.isError) throw new ProviderError();
            // Content is untrusted data; embedded URLs/resources are never fetched automatically.
            return {
              content: parsed.content,
              structuredContent: parsed.structuredContent ?? null,
            };
          },
          close,
        };
      } catch (error) {
        try {
          await close();
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            "MCP initialization and cleanup failed",
          );
        }
        throw error;
      }
    },
  };
}
function result(value: unknown, id: number): JsonValue {
  const parsed = RPC_RESPONSE.safeParse(value);
  if (
    !parsed.success ||
    parsed.data.id !== id ||
    parsed.data.error !== undefined ||
    parsed.data.result === undefined
  )
    throw new ProviderError();
  return parsed.data.result;
}
