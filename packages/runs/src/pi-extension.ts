/** Loaded explicitly by managed Pi inside the Computer boundary; no server imports. */
export const PI_TOOL = "otto";
export const PI_BRIDGE_TITLE = "otto.tool.v1";
export const PI_BRIDGE_READY = "otto.bridge.v1";
export const PI_FRAME_BYTES = 262144;

function readToolSchema() {
  const text = process.env.OTTO_TOOL_SCHEMA;
  if (!text || new TextEncoder().encode(text).byteLength > 65536)
    throw new Error("Missing or oversized Otto tool schema");
  const schema: unknown = JSON.parse(text);
  if (!schema || typeof schema !== "object" || Array.isArray(schema))
    throw new Error("Invalid Otto tool schema");
  const branches =
    "anyOf" in schema
      ? schema.anyOf
      : "oneOf" in schema
        ? schema.oneOf
        : [schema];
  if (!Array.isArray(branches) || branches.length < 1 || branches.length > 64)
    throw new Error("Invalid Otto operation schema");
  for (const branch of branches) {
    if (
      !branch ||
      typeof branch !== "object" ||
      branch.type !== "object" ||
      !branch.properties ||
      typeof branch.properties !== "object" ||
      typeof branch.properties.name?.const !== "string" ||
      !branch.properties.name.const ||
      !Array.isArray(branch.required) ||
      !branch.required.includes("name")
    )
      throw new Error("Invalid Otto operation schema");
  }
  return text;
}

interface PiContext {
  mode: string;
  sessionManager: { getSessionId(): string };
  ui: {
    notify(message: string, type: "info"): void;
    input(
      title: string,
      placeholder: string,
      options: { signal?: AbortSignal; timeout: number },
    ): Promise<string | undefined>;
  };
}
/** The structural subset of pinned Pi's ExtensionAPI used by this dependency-free extension. */
interface PiExtensionApi {
  on(
    event: "session_start",
    handler: (event: unknown, context: PiContext) => void,
  ): unknown;
  registerTool(tool: {
    name: string;
    label: string;
    description: string;
    parameters: {
      type: "object";
      properties: { input: { type: "object"; additionalProperties: true } };
      required: string[];
      additionalProperties: false;
    };
    executionMode: "sequential";
    execute(
      toolCallId: string,
      params: { input: Record<string, unknown> },
      signal: AbortSignal | undefined,
      onUpdate: unknown,
      context: PiContext,
    ): Promise<{ content: { type: "text"; text: string }[]; details: null }>;
  }): void;
}

export default function piExtension(pi: PiExtensionApi) {
  const toolSchema = readToolSchema();
  pi.on("session_start", (_event, context) => {
    if (context.mode !== "rpc") throw new Error("Otto requires managed Pi RPC");
    context.ui.notify(
      JSON.stringify({
        bridge: PI_BRIDGE_READY,
        sessionId: context.sessionManager.getSessionId(),
      }),
      "info",
    );
  });
  pi.registerTool({
    name: PI_TOOL,
    label: "Otto",
    description: `Call only the Otto operations described by this server-supplied JSON schema. Pass the operation object as input. Server permission checks apply to every call. Schema: ${toolSchema}`,
    parameters: {
      type: "object",
      properties: { input: { type: "object", additionalProperties: true } },
      required: ["input"],
      additionalProperties: false,
    },
    executionMode: "sequential",
    async execute(toolCallId, params, signal, _onUpdate, context) {
      if (context.mode !== "rpc")
        throw new Error("Otto requires managed Pi RPC");
      signal?.throwIfAborted();
      const placeholder = JSON.stringify({
        sessionId: context.sessionManager.getSessionId(),
        toolCallId,
        input: params.input,
      });
      if (new TextEncoder().encode(placeholder).byteLength > PI_FRAME_BYTES / 2)
        throw new Error("Otto tool input limit");
      // Native RPC input supports AbortSignal. No stdin listener, custom wire or local authority.
      const value = await context.ui.input(PI_BRIDGE_TITLE, placeholder, {
        signal,
        timeout: 300000,
      });
      signal?.throwIfAborted();
      if (value === undefined)
        throw new Error("Otto tool cancelled or timed out");
      if (new TextEncoder().encode(value).byteLength > PI_FRAME_BYTES / 2)
        throw new Error("Otto tool result limit");
      const response: unknown = JSON.parse(value);
      if (!response || typeof response !== "object" || !("success" in response))
        throw new Error("Invalid Otto tool response");
      if (response.success !== true)
        throw new Error("Otto operation denied or unavailable");
      if (!("result" in response)) throw new Error("Missing Otto tool result");
      return {
        content: [{ type: "text", text: JSON.stringify(response.result) }],
        details: null,
      };
    },
  });
}
