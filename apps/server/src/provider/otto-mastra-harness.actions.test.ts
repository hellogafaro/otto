type NestedAction = { action: string } | { nested: NestedAction };

import { describe } from "vite-plus/test";
import { it } from "@effect/vitest";
import { expect } from "vite-plus/test";
import { ottoActionNeedsApproval, criticalOttoAction } from "./otto-mastra-harness.ts";
import { alwaysAllowCovers, alwaysAllowKinds } from "./mastra/otto-actions.ts";

describe("Otto action classifier", () => {
  it.each([
    ["rm -rf .cache", "delete"],
    ["git push origin main", "publish"],
    ["psql -c 'DROP TABLE sessions'", "delete"],
    ["wrangler deploy", "production"],
    ["cat ~/.ssh/id_rsa", "secrets"],
    ['curl -X POST --data \'{"text":"hello"}\' https://example.com/messages', "send"],
    ["cd workspace && git push origin main", "publish"],
    ["find . -name '*.tmp' -delete", "delete"],
    ["git reset --hard HEAD~1", "delete"],
    ["git clean -fd", "delete"],
    ["find . -name '*.tmp' -exec rm -rf {} \\;", "delete"],
    ["python -c 'import os; os.remove(\"tmp.txt\")'", "delete"],
    ["shred important-file", "delete"],
    ["sudo shred -u important-file", "delete"],
    ["command shred -u important-file", "delete"],
    ['bash -c "shred -u important-file"', "delete"],
    ["dd if=/dev/zero of=important-file", "delete"],
    ["sudo dd if=image.img of=/dev/disk4 bs=4m", "delete"],
    ["dd if=/dev/zero > important-file", "delete"],
    ['bash -c "dd if=/dev/zero 1> important-file"', "delete"],
    ["mv replacement important-file", "delete"],
    ["mv -f replacement important-file", "delete"],
    ["command mv --force replacement important-file", "delete"],
    ["bash -lc 'command shred -u important-file'", "delete"],
    ["printf '%s\\n' important-file | xargs shred -u", "delete"],
    ["printf '%s\\n' important-file | xargs rm -f", "delete"],
    ["printf '%s\\n' important-file | xargs env rm -f", "delete"],
    ["printf '%s\\n' empty-dir | xargs rmdir", "delete"],
    ["printf '%s\\n' important-link | xargs unlink", "delete"],
    ["find . -name important-file -exec shred -u {} \\;", "delete"],
    ["find . -name important-file -exec env rm -f {} \\;", "delete"],
    ["printf '%s\\n' important-file | xargs sh -c 'rm -f \"$1\"' _", "delete"],
    ["find . -name important-file -exec sh -c 'rm -f \"$1\"' _ {} \\;", "delete"],
  ] as const)("classifies %s as %s", (command, action) => {
    expect(criticalOttoAction("execute_command", { command })).toBe(action);
    expect(ottoActionNeedsApproval("execute_command", { command })).toBe(true);
  });

  it.each([
    "bun test",
    "git status",
    "rg -n TODO apps",
    "cat README.md",
    'echo "shred important-file"',
  ])("leaves ordinary local command %s unclassified", (command) => {
    expect(criticalOttoAction("execute_command", { command })).toBeNull();
    expect(ottoActionNeedsApproval("execute_command", { command })).toBe(false);
  });

  it("lists every kind of action and fails closed on chained shell commands", () => {
    const deleteOnly = [{ toolName: "shell", action: "delete" }];

    expect(alwaysAllowKinds("shell", { command: "rm ./scratch.txt" })).toEqual(["delete"]);
    expect(alwaysAllowCovers(deleteOnly, "shell", { command: "rm ./scratch.txt" })).toBe(true);
    expect(alwaysAllowKinds("shell", { command: "ls -la 2>&1" })).toEqual([null]);

    for (const command of [
      "rm ./scratch.txt; git push origin main",
      "rm ./scratch.txt && ./deploy.sh",
      "rm ./scratch.txt\ngit push origin main",
      "rm $(cat list.txt)",
    ]) {
      expect(alwaysAllowKinds("shell", { command })).toBeNull();
      expect(alwaysAllowCovers(deleteOnly, "shell", { command })).toBe(false);
    }

    const removeSecret = { path: ".env", operation: "remove" };

    expect(alwaysAllowKinds("custom_tool", removeSecret)).toEqual(["secrets", "delete"]);
    expect(
      alwaysAllowCovers(
        [{ toolName: "custom_tool", action: "delete" }],
        "custom_tool",
        removeSecret,
      ),
    ).toBe(false);
  });

  it("runs connector actions it cannot classify and asks for each critical one in a batch", () => {
    for (const [toolName, input] of [
      ["notion_pages", { operation: "append", pageId: "page-1" }],
      ["custom_api", { method: "PATCH", path: "/v1/issues/1" }],
      ["COMPOSIO_MANAGE_CONNECTIONS", { toolkits: [{ name: "gmail", action: "add" }] }],
      [
        "COMPOSIO_MULTI_EXECUTE_TOOL",
        { tools: [{ tool_slug: "LINEAR_CREATE_LINEAR_ISSUE", arguments: { title: "Bug" } }] },
      ],
    ] as const) {
      expect(ottoActionNeedsApproval(toolName, input)).toBe(false);
    }

    const batch = (...slugs: string[]) => ({
      tools: slugs.map((tool_slug) => ({ tool_slug, arguments: {} })),
    });

    const sendEmail = batch("LINEAR_CREATE_LINEAR_ISSUE", "GMAIL_SEND_EMAIL");

    expect(ottoActionNeedsApproval("COMPOSIO_MULTI_EXECUTE_TOOL", sendEmail)).toBe(true);
    expect(alwaysAllowKinds("COMPOSIO_MULTI_EXECUTE_TOOL", sendEmail)).toEqual(["send"]);
    expect(
      new Set(
        alwaysAllowKinds(
          "COMPOSIO_MULTI_EXECUTE_TOOL",
          batch("GMAIL_SEND_EMAIL", "GITHUB_DELETE_A_REPOSITORY"),
        ),
      ),
    ).toEqual(new Set(["send", "delete"]));
    expect(
      ottoActionNeedsApproval("COMPOSIO_MANAGE_CONNECTIONS", {
        toolkits: [{ name: "gmail", action: "remove", account_id: "account-1" }],
      }),
    ).toBe(true);
  });

  it("requires approval when nested input exceeds the inspection limit", () => {
    let args: NestedAction = { action: "send" };

    for (let depth = 0; depth < 101; depth += 1) args = { nested: args };

    expect(criticalOttoAction("custom_tool", args)).toBeNull();
    expect(ottoActionNeedsApproval("custom_tool", args)).toBe(true);
    expect(alwaysAllowKinds("custom_tool", args)).toBeNull();
  });
});
