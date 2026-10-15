import type { MessageEntry } from "./openCodeAdapterHarness.ts";
import type { Session } from "@mastra/core/agent-controller";
import type { OpencodeClient } from "@opencode-ai/sdk/v2";
import type { OttoMastraState } from "../../OttoMastraHarness.ts";

type SessionFixture = Partial<
  Omit<Session<OttoMastraState>, "state" | "mode" | "model" | "permissions" | "run">
> & {
  run?: Partial<Session<OttoMastraState>["run"]>;
  state?: Partial<Session<OttoMastraState>["state"]>;
  mode?: Partial<Session<OttoMastraState>["mode"]>;
  model?: Partial<Session<OttoMastraState>["model"]>;
  permissions?: Partial<Session<OttoMastraState>["permissions"]>;
};

/** Supply only the SDK methods that the adapter exercises in this test. */
export function sessionFixture(fixture: SessionFixture): Session<OttoMastraState> {
  // SAFETY: Tests supply checked SDK methods and exercise only that subset.
  return fixture as Session<OttoMastraState>;
}

type EndpointFixture<Method, Output> = Method extends (...args: infer Args) => infer _Result
  ? (...args: Args) => Promise<Output>
  : never;

type SessionEndpoints = OpencodeClient["session"];

type SessionResult = {
  data: { id: string; directory?: string; parentID?: string; revert?: { messageID: string } };
};

type OpenCodeClientFixture = {
  session?: {
    create?: EndpointFixture<SessionEndpoints["create"], SessionResult>;
    get?: EndpointFixture<SessionEndpoints["get"], SessionResult>;
    update?: EndpointFixture<SessionEndpoints["update"], SessionResult>;
    fork?: EndpointFixture<SessionEndpoints["fork"], SessionResult>;
    abort?: EndpointFixture<SessionEndpoints["abort"], void>;
    children?: EndpointFixture<SessionEndpoints["children"], { data: Array<{ id: string }> }>;
    promptAsync?: EndpointFixture<SessionEndpoints["promptAsync"], void>;
    messages?: EndpointFixture<SessionEndpoints["messages"], { data: Array<MessageEntry> }>;
    revert?: EndpointFixture<SessionEndpoints["revert"], void>;
  };
  event?: {
    subscribe?: EndpointFixture<
      OpencodeClient["event"]["subscribe"],
      { stream: AsyncIterable<unknown> }
    >;
  };
  permission?: { reply?: EndpointFixture<OpencodeClient["permission"]["reply"], void> };
  question?: { reply?: EndpointFixture<OpencodeClient["question"]["reply"], void> };
  mcp?: { add?: EndpointFixture<OpencodeClient["mcp"]["add"], { data: boolean }> };
};

/** Check SDK arguments and the response fields consumed by the adapter. */
export function openCodeClientFixture(fixture: OpenCodeClientFixture): OpencodeClient {
  // SAFETY: Tests exercise only the supplied endpoints and consumed result fields.
  // Generated transport metadata and unused endpoints are intentionally absent;
  // raw messages/events allow malformed input to exercise the adapter's decoders.
  return fixture as OpencodeClient & OpenCodeClientFixture;
}
