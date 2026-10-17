import * as Schema from "effect/Schema";
import {
  EventId,
  ProviderDriverKind,
  RuntimeRequestId,
  ThreadId,
  type ProviderRuntimeEvent,
} from "@otto/contracts";
import { describe, expect, it } from "vite-plus/test";

import { runtimeEventToActivities } from "./provider-runtime-ingestion.ts";

describe("runtimeEventToActivities approval details", () => {
  it("preserves a routine draft and its server supplied timezone", () => {
    const args = {
      name: "Morning announcement",
      instructions: "Share today's schedule with the team.",
      schedule: { kind: "weekdays", time: "08:00" },
      timezone: "America/New_York",
    };

    const event = {
      type: "request.opened",
      eventId: EventId.make("evt-routine-request"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: "2026-08-30T00:00:00.000Z",
      threadId: ThreadId.make("thread-1"),
      requestId: RuntimeRequestId.make("approval-routine"),
      payload: {
        requestType: "dynamic_tool_call",
        toolName: "routine_create",
        args,
      },
    } satisfies ProviderRuntimeEvent;

    expect(runtimeEventToActivities(event)[0]?.payload).toMatchObject({ args });
    expect(
      runtimeEventToActivities({
        ...event,
        payload: { ...event.payload, args: { ...args, timezone: "invalid/timezone" } },
      })[0]?.payload,
    ).not.toHaveProperty("args");
  });

  it("drops unrelated tool arguments before persistence", () => {
    const event = {
      type: "request.opened",
      eventId: EventId.make("evt-unrelated-request"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: "2026-08-30T00:00:00.000Z",
      threadId: ThreadId.make("thread-1"),
      requestId: RuntimeRequestId.make("approval-unrelated"),
      payload: {
        requestType: "dynamic_tool_call",
        toolName: "run_private_tool",
        args: { token: "secret" },
      },
    } satisfies ProviderRuntimeEvent;

    expect(runtimeEventToActivities(event)[0]?.payload).not.toHaveProperty("args");
  });

  it("preserves complete multiline command details", () => {
    const detail = `bun run release -- ${"long-argument ".repeat(20)}\nsecond line`;

    const event = {
      type: "request.opened",
      eventId: EventId.make("evt-request-opened"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: "2026-07-18T00:00:00.000Z",
      threadId: ThreadId.make("thread-1"),
      requestId: RuntimeRequestId.make("approval-1"),
      payload: {
        requestType: "command_execution_approval",
        detail,
      },
    } satisfies ProviderRuntimeEvent;

    const [activity] = runtimeEventToActivities(event);

    expect(activity?.kind).toBe("approval.requested");
    expect((activity?.payload as Record<string, Schema.Json> | undefined)?.detail).toBe(detail);
  });

  it("keeps app details and approval options available to remote clients", () => {
    const options = [
      { decision: "decline", label: "Decline" },
      { decision: "acceptAlways", label: "Always allow Safari" },
      { decision: "accept", label: "Approve" },
    ] as const;

    const event = {
      type: "request.opened",
      eventId: EventId.make("evt-mcp-elicitation"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: "2026-08-24T00:00:00.000Z",
      threadId: ThreadId.make("thread-1"),
      requestId: RuntimeRequestId.make("approval-safari"),
      payload: {
        requestType: "mcp_elicitation_approval",
        detail: "Allow ChatGPT to use Safari?",
        appName: "Safari",
        options,
      },
    } satisfies ProviderRuntimeEvent;

    const [activity] = runtimeEventToActivities(event);

    expect(activity).toMatchObject({
      kind: "approval.requested",
      summary: "App access approval requested",
      payload: {
        requestId: "approval-safari",
        requestKind: "mcp-elicitation",
        requestType: "mcp_elicitation_approval",
        detail: "Allow ChatGPT to use Safari?",
        appName: "Safari",
        options,
      },
    });
  });
});
