import { type CreateBotBrowserInput, type BotBrowser } from "./browser/bot-browser-types.ts";
import { LightpandaRpc, createBotBrowserTools } from "./browser/lightpanda-rpc.ts";

export function createBotBrowser(input: CreateBotBrowserInput): BotBrowser {
  const rpc = input.makeRpc?.(input) ?? new LightpandaRpc(input);

  return {
    tools: createBotBrowserTools(rpc),
    attachment: () => rpc.attachment(),
    reconnect: () => rpc.reconnect(),
    close: () => rpc.close(),
  };
}

export {
  type BotBrowserAttachment,
  type BotBrowser,
  type BotBrowserRpc,
  type BotBrowserProcessInput,
  type CreateBotBrowserInput,
  type BrowserHttpResponse,
  type BrowserRequest,
} from "./browser/bot-browser-types.ts";

export { lightpandaMcpCommand } from "./browser/lightpanda-install.ts";

export { browserMonitorRetryDelayMs } from "./browser/lightpanda-process.ts";

export { browserRpcErrorMessage, createBotBrowserTools } from "./browser/lightpanda-rpc.ts";
