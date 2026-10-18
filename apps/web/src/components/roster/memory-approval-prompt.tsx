import { Predicate } from "effect";
import { squashAtomCommandFailure } from "@otto/client-runtime/state/runtime";
import type { MemoryApprovalRequest, ScopedThreadRef } from "@otto/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";

import { useI18n } from "../../i18n";
import { environmentBotsAtom } from "../../state/bots";
import { memoryEnvironment } from "../../state/memory";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { cn } from "../../lib/utils";
import { useApprovalShortcuts } from "../chat/use-approval-shortcuts";
import {
  BOT_COMPOSER_DOCKED_PANEL_CLASS_NAME,
  BOT_COMPOSER_SURFACE_CLASS_NAME,
} from "./bot-conversation-presentation";

// Asks a person to approve a project or workspace memory change a bot proposed. Shown above
// the composer while the chat has undecided proposals.
export function MemoryApprovalPrompt({
  threadRef,
  approvals,
  shortcuts = false,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly approvals: ReadonlyArray<MemoryApprovalRequest>;
  /** Answers the approval shortcuts while no tool approval or question comes first. */
  readonly shortcuts?: boolean;
}) {
  const approval = approvals[0];

  return approval ? (
    <MemoryApprovalCard
      threadRef={threadRef}
      approval={approval}
      count={approvals.length}
      shortcuts={shortcuts}
    />
  ) : null;
}

function MemoryApprovalCard({
  threadRef,
  approval,
  count,
  shortcuts,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly approval: MemoryApprovalRequest;
  readonly count: number;
  readonly shortcuts: boolean;
}) {
  const { t } = useI18n();
  const bots = useAtomValue(environmentBotsAtom(threadRef.environmentId));
  const decide = useAtomCommand(memoryEnvironment.decide, { reportFailure: false });

  const [draft, setDraft] = useState<{ readonly memoryId: string; readonly text: string } | null>(
    null,
  );

  const [responding, setResponding] = useState(false);

  const [failure, setFailure] = useState<{
    readonly memoryId: string;
    readonly message: string;
  } | null>(null);

  const editing = draft?.memoryId === approval.memoryId ? draft : null;
  const error = failure?.memoryId === approval.memoryId ? failure.message : null;
  const authorName = bots.find((bot) => bot.id === approval.authorBotId)?.name;
  const target = approval.scope === "project" ? approval.title : t("the workspace");

  const heading = {
    project: {
      add: t("Save to project memory?"),
      update: t("Update project memory?"),
      delete: t("Delete from project memory?"),
    },
    workspace: {
      add: t("Save to workspace memory?"),
      update: t("Update workspace memory?"),
      delete: t("Delete from workspace memory?"),
    },
  }[approval.scope][approval.action];

  const respond = async (decision: "approve" | "reject", text?: string) => {
    setResponding(true);
    setFailure(null);

    try {
      const result = await decide({
        environmentId: threadRef.environmentId,
        input: {
          id: approval.memoryId,
          decision,
          ...(text !== undefined && text !== approval.text ? { text } : {}),
        },
      });

      if (Predicate.isTagged(result, "Failure")) {
        const cause = squashAtomCommandFailure(result);

        setFailure({
          memoryId: approval.memoryId,
          message: cause instanceof Error ? cause.message : t("Memory request failed."),
        });

        return;
      }

      setDraft(null);
    } finally {
      setResponding(false);
    }
  };

  const editedText = editing?.text.trim() ?? "";

  const hint = useApprovalShortcuts(shortcuts, {
    "approval.approve": () => {
      if (responding) return;

      if (!editing) void respond("approve");
      else if (editedText.length > 0) void respond("approve", editedText);
    },
    ...(editing
      ? {}
      : {
          "approval.deny": () => {
            if (!responding) void respond("reject");
          },
        }),
  });

  return (
    <section
      aria-label={t("Memory approval")}
      className={cn(BOT_COMPOSER_SURFACE_CLASS_NAME, BOT_COMPOSER_DOCKED_PANEL_CLASS_NAME)}
      data-testid="memory-approval-prompt"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden="true"
          className="size-1.5 shrink-0 rounded-full bg-memory-approval-indicator"
        />
        <p className="text-sm font-semibold text-foreground">{heading}</p>
        {count > 1 ? (
          <span className="ml-auto text-11px font-medium text-muted-foreground tabular-nums">
            {t("1 of {count}", { count })}
          </span>
        ) : null}
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {authorName
          ? t("{botName} wants to remember this for {target}", { botName: authorName, target })
          : t("A bot wants to remember this for {target}", { target })}
      </p>
      {editing ? (
        <Textarea
          aria-label={t("Memory to save")}
          className="mt-2"
          size="sm"
          value={editing.text}
          disabled={responding}
          onChange={(event) => setDraft({ memoryId: approval.memoryId, text: event.target.value })}
          onKeyDown={(event) => {
            // Escape cancels the edit like the Cancel button; an IME keeps its own Escape.
            if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
            event.preventDefault();
            event.stopPropagation();
            setDraft(null);
          }}
        />
      ) : (
        <p className="mt-2 text-sm whitespace-pre-wrap text-foreground">
          {approval.action === "delete" ? approval.previousText : approval.text}
        </p>
      )}
      {approval.action === "update" && approval.previousText ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {t("Replaces: {text}", { text: approval.previousText })}
        </p>
      ) : null}
      <div className="mt-2.5 flex flex-wrap items-center justify-end gap-1.5">
        {editing ? (
          <>
            <Button
              size="xs"
              variant="ghost-muted"
              disabled={responding}
              onClick={() => setDraft(null)}
            >
              {t("Cancel")}
            </Button>
            <Button
              size="xs"
              disabled={responding || editedText.length === 0}
              onClick={() => void respond("approve", editedText)}
            >
              {t("Approve edit")}
              {hint("approval.approve")}
            </Button>
          </>
        ) : (
          <>
            <Button
              size="xs"
              variant="ghost-muted"
              disabled={responding}
              onClick={() => void respond("reject")}
            >
              {t("Reject")}
              {hint("approval.deny")}
            </Button>
            {approval.action === "delete" ? null : (
              <Button
                size="xs"
                variant="outline"
                disabled={responding}
                onClick={() => setDraft({ memoryId: approval.memoryId, text: approval.text })}
              >
                {t("Edit")}
              </Button>
            )}
            <Button size="xs" disabled={responding} onClick={() => void respond("approve")}>
              {t("Approve")}
              {hint("approval.approve")}
            </Button>
          </>
        )}
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
