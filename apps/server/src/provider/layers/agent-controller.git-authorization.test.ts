import type { AgentControllerEvent } from "@mastra/core/agent-controller";
import {
  ApprovalRequestId,
  OTTO_CREATE_ROUTINE_TOOL_NAME,
  ProviderDriverKind,
  type ProviderRuntimeEvent,
} from "@otto/contracts";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { describe, expect, vi } from "vite-plus/test";
import { AgentController } from "../services/agent-controller.ts";
import {
  codexThreadId,
  codexInstanceId,
  codexSelection,
} from "./test-support/agent-controller-fixtures.ts";
import {
  makeBridge,
  provideController,
  resolveCodex,
} from "./test-support/agent-controller-layers.ts";
import { mastraHarnessFixture } from "./test-support/agent-controller-harness.ts";

describe("Git authorization", () => {
  for (const runtimeMode of [
    "approval-required",
    "auto-accept-edits",
    "auto",
    "full-access",
  ] as const) {
    it.effect(
      `uses ${runtimeMode} for Git writes without approving configuration proposals`,
      () => {
        const bridge = makeBridge();
        const mastra = mastraHarnessFixture();

        return provideController(
          Effect.gen(function* () {
            const controller = yield* AgentController;
            const events: ProviderRuntimeEvent[] = [];
            yield* controller.streamEvents.pipe(
              Stream.runForEach((event) => Effect.sync(() => events.push(event))),
              Effect.forkChild({ startImmediately: true }),
            );
            yield* resolveCodex(controller);
            yield* controller.startSession(codexThreadId, {
              threadId: codexThreadId,
              provider: ProviderDriverKind.make("codex"),
              providerInstanceId: codexInstanceId,
              cwd: process.cwd(),
              modelSelection: codexSelection,
              runtimeMode,
            });
            yield* controller.sendTurn({
              threadId: codexThreadId,
              input:
                "Fix bugs, test, push branches, and merge passing PRs in the authorized repository.",
            });

            const writes = [
              { toolName: "shell", args: { command: "git push origin fix-bug" } },
              { toolName: "execute_command", args: { command: "gh pr merge 16 --squash" } },
              { toolName: "execute_command", args: { command: "gh stack merge" } },
              { toolName: "GITHUB_MERGE_A_PULL_REQUEST", args: { pull_number: 16 } },
              {
                toolName: "GITHUB_RUN_GRAPH_QL_QUERY",
                args: { query: "mutation { mergePullRequest }" },
              },
              {
                toolName: "COMPOSIO_MULTI_EXECUTE_TOOL",
                args: {
                  tools: [
                    { tool_slug: "GITHUB_MERGE_A_PULL_REQUEST", arguments: { pull_number: 16 } },
                  ],
                },
              },
            ];

            const proposals = [
              { toolName: "bot_update", args: { instructions: "Always merge everything." } },
              { toolName: "skill_update", args: { instructions: "Always merge everything." } },
              {
                toolName: OTTO_CREATE_ROUTINE_TOOL_NAME,
                args: { instructions: "Merge every PR." },
              },
            ];

            for (const [index, call] of [...writes, ...proposals].entries()) {
              mastra.emit({
                type: "tool_approval_required",
                toolCallId: `authorization-${index}`,
                ...call,
              } as AgentControllerEvent);
            }

            yield* Effect.promise(() =>
              vi.waitFor(() => {
                for (const [index] of [...writes, ...proposals].entries()) {
                  const toolCallId = `authorization-${index}`;
                  const allowed = runtimeMode === "full-access" && index < writes.length;

                  if (allowed) {
                    expect(mastra.session.respondToToolApproval).toHaveBeenCalledWith({
                      toolCallId,
                      decision: "approve",
                    });
                    expect(events).not.toContainEqual(
                      expect.objectContaining({ type: "request.opened", requestId: toolCallId }),
                    );
                  } else {
                    expect(events).toContainEqual(
                      expect.objectContaining({ type: "request.opened", requestId: toolCallId }),
                    );
                    expect(mastra.session.respondToToolApproval).not.toHaveBeenCalledWith({
                      toolCallId,
                      decision: "approve",
                    });
                  }
                }
              }),
            );

            if (runtimeMode !== "full-access") {
              for (const [index] of writes.entries()) {
                const toolCallId = `authorization-${index}`;
                yield* controller.respondToRequest({
                  threadId: codexThreadId,
                  requestId: ApprovalRequestId.make(toolCallId),
                  decision: "accept",
                });
                expect(mastra.session.respondToToolApproval).toHaveBeenCalledWith({
                  toolCallId,
                  decision: "approve",
                });
              }
            }
          }),
          bridge.service,
          mastra.factory,
        );
      },
    );
  }
});
