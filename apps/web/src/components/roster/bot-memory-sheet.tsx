import { RiAddLine, RiBrainLine, RiMore2Line } from "@remixicon/react";
import { useAtomValue } from "@effect/atom-react";
import { Predicate } from "effect";
import { squashAtomCommandFailure } from "@otto/client-runtime/state/runtime";
import {
  type BotId,
  type EnvironmentId,
  type Memory,
  type MemorySection,
  MEMORY_TEXT_MAX_CHARS,
} from "@otto/contracts";
import { useState } from "react";
import { toast } from "sonner";

import { BotSideSheet, BotSideSheetEmpty, BotSideSheetSection } from "./bot-side-sheet";

import { usePrimarySettings } from "~/hooks/use-settings";
import { useI18n } from "../../i18n";
import { environmentBotsAtom, environmentPeopleAtom } from "../../state/bots";
import { memoryEnvironment } from "../../state/memory";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Skeleton, SkeletonRegion } from "../ui/skeleton";
import { Textarea } from "../ui/textarea";

/** The server's own error text, shown as received, or null when it sent none. */
export function memoryErrorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : null;
}

/** A scope at 90% of its cap is close enough to full to say so. */
export const isAlmostFull = (section: Pick<MemorySection, "used" | "cap">) =>
  section.used >= section.cap * 0.9;

/** "Juno · Launch plan · Oct 16": who wrote an entry, in which chat, and when. */
export function memoryEntryMeta(
  memory: Pick<Memory, "botId" | "personId" | "threadTitle" | "updatedAt">,
  names: {
    readonly currentPersonId: string | null;
    readonly bots: ReadonlyMap<string, string>;
    readonly people: ReadonlyMap<string, string>;
  },
  i18n: Pick<ReturnType<typeof useI18n>, "t" | "formatDate">,
) {
  const writer = memory.botId
    ? names.bots.get(memory.botId)
    : memory.personId === names.currentPersonId
      ? i18n.t("You")
      : memory.personId
        ? names.people.get(memory.personId)
        : undefined;

  return [
    writer,
    memory.threadTitle,
    i18n.formatDate(new Date(memory.updatedAt), { month: "short", day: "numeric" }),
  ]
    .filter(Boolean)
    .join(" · ");
}

function MemoryDraft({
  initial,
  label,
  busy,
  onCancel,
  onSave,
}: {
  readonly initial: string;
  readonly label: string;
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onSave: (text: string) => void;
}) {
  const { t } = useI18n();
  const [text, setText] = useState(initial);
  const trimmed = text.trim();

  return (
    <div className="space-y-2">
      <Textarea
        aria-label={label}
        autoFocus
        size="sm"
        maxLength={MEMORY_TEXT_MAX_CHARS}
        value={text}
        disabled={busy}
        onChange={(event) => setText(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }}
      />
      <div className="flex justify-end gap-1.5">
        <Button size="xs" variant="ghost" disabled={busy} onClick={onCancel}>
          {t("Cancel")}
        </Button>
        <Button
          size="xs"
          disabled={busy || trimmed.length === 0 || trimmed === initial.trim()}
          onClick={() => onSave(trimmed)}
        >
          {t("Save")}
        </Button>
      </div>
    </div>
  );
}

export function BotMemorySheet({
  open,
  onOpenChange,
  environmentId,
  botId,
  botName,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly environmentId: EnvironmentId;
  readonly botId: BotId;
  readonly botName: string;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const writable = usePrimarySettings((settings) => settings.memory.enabled);
  const bots = useAtomValue(environmentBotsAtom(environmentId));
  const people = useAtomValue(environmentPeopleAtom(environmentId));

  const query = useEnvironmentQuery(
    open ? memoryEnvironment.list({ environmentId, input: { botId } }) : null,
  );

  const create = useAtomCommand(memoryEnvironment.create, { reportFailure: false });
  const update = useAtomCommand(memoryEnvironment.update, { reportFailure: false });
  const remove = useAtomCommand(memoryEnvironment.remove, { reportFailure: false });
  const decide = useAtomCommand(memoryEnvironment.decide, { reportFailure: false });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const names = {
    currentPersonId: people.current?.id ?? null,
    bots: new Map(bots.map((bot) => [String(bot.id), bot.name])),
    people: new Map(people.directory.map((person) => [person.personId, person.displayName])),
  };

  /** Runs one change; a failure keeps the draft open and shows the server's reason. */
  const run = async (
    change: () => Promise<Parameters<typeof squashAtomCommandFailure>[0] | { _tag: "Success" }>,
    failureToast: string,
  ) => {
    setBusy(true);
    setError(null);
    const result = await change();
    setBusy(false);

    if (Predicate.isTagged(result, "Failure")) {
      setError(memoryErrorMessage(squashAtomCommandFailure(result)) ?? t("Memory request failed."));
      toast.error(failureToast);

      return false;
    }

    return true;
  };

  const sectionKey = (section: MemorySection) => `${section.scope}:${section.scopeId}`;

  const sectionCopy = (section: MemorySection) => {
    switch (section.scope) {
      case "person":
        return { title: t("About you"), description: t("Used only in your private chats.") };
      case "bot":
        return {
          title: botName,
          description: t("Its role and how it works. Used in every chat."),
        };
      case "group":
        return {
          title: section.title,
          description: t("Shared with everyone in this group chat."),
        };
      case "project":
        return {
          title: section.title,
          description: t("Shared with every bot in this project."),
        };
      case "workspace":
        return { title: t("Workspace"), description: t("Shared with every bot in the workspace.") };
    }
  };

  const sections = query.data?.sections ?? [];
  const empty = sections.every((section) => section.memories.length === 0) && adding === null;

  const entry = (section: MemorySection, memory: Memory) => {
    const meta = memoryEntryMeta(memory, names, i18n);

    if (editing === memory.id) {
      return (
        <MemoryDraft
          key={memory.id}
          initial={memory.text}
          label={t("Edit memory")}
          busy={busy}
          onCancel={() => setEditing(null)}
          onSave={(text) =>
            void run(
              () => update({ environmentId, input: { id: memory.id, text } }),
              t("Memory couldn't be saved"),
            ).then((saved) => saved && setEditing(null))
          }
        />
      );
    }

    const replaced = section.memories.find((candidate) => candidate.id === memory.replacesId);

    return (
      <li key={memory.id} className="group/memory flex items-start gap-2 py-1.5">
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="text-13px whitespace-pre-wrap text-foreground">
            {memory.status === "pending" && memory.text === ""
              ? t("Delete: {text}", { text: replaced?.text ?? "" })
              : memory.text}
          </p>
          <p className="text-xs text-muted-foreground">{meta}</p>
          {memory.status === "pending" ? (
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <Badge variant="warning">{t("Waiting for approval")}</Badge>
              {writable ? (
                <>
                  <Button
                    size="xs"
                    variant="ghost-muted"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () =>
                          decide({ environmentId, input: { id: memory.id, decision: "reject" } }),
                        t("Memory couldn't be saved"),
                      )
                    }
                  >
                    {t("Reject")}
                  </Button>
                  <Button
                    size="xs"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () =>
                          decide({ environmentId, input: { id: memory.id, decision: "approve" } }),
                        t("Memory couldn't be saved"),
                      )
                    }
                  >
                    {t("Approve")}
                  </Button>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
        {writable && memory.status === "active" ? (
          <Menu onOpenChange={(menuOpen) => !menuOpen && setConfirmDelete(null)}>
            <MenuTrigger
              render={
                <Button size="icon-sm" variant="ghost-muted" aria-label={t("Memory actions")} />
              }
            >
              <RiMore2Line />
            </MenuTrigger>
            <MenuPopup align="end">
              <MenuItem onClick={() => setEditing(memory.id)}>{t("Edit")}</MenuItem>
              <MenuItem
                variant="destructive"
                closeOnClick={confirmDelete === memory.id}
                onClick={() => {
                  if (confirmDelete !== memory.id) return setConfirmDelete(memory.id);

                  void run(
                    () => remove({ environmentId, input: { id: memory.id } }),
                    t("Memory couldn't be deleted"),
                  ).then((deleted) => deleted && toast.success(t("Memory has been deleted")));
                }}
              >
                {confirmDelete === memory.id ? t("Confirm delete") : t("Delete")}
              </MenuItem>
            </MenuPopup>
          </Menu>
        ) : null}
      </li>
    );
  };

  return (
    <BotSideSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("Memory")}
      description={t("What {bot} remembers. Only you see what it remembers about you.", {
        bot: botName,
      })}
    >
      {(error ?? query.error) ? (
        <div
          role="alert"
          className="rounded-lg bg-destructive/8 p-3 text-sm text-destructive-foreground"
        >
          {error ?? query.error}
        </div>
      ) : null}
      {!writable ? (
        <p className="text-sm text-muted-foreground">
          {t("Memory is off. Turn it on in Settings to change what bots remember.")}
        </p>
      ) : null}
      {query.isPending && !query.data ? (
        <SkeletonRegion label={t("Loading memory…")}>
          <div className="space-y-6">
            {[t("About you"), botName].map((title) => (
              <BotSideSheetSection key={title} title={title}>
                {[0, 1].map((row) => (
                  <div key={row} className="space-y-1.5 py-1.5">
                    <Skeleton className={row === 0 ? "h-3 w-3/4" : "h-3 w-1/2"} />
                    <Skeleton className="h-2.5 w-1/3" />
                  </div>
                ))}
              </BotSideSheetSection>
            ))}
          </div>
        </SkeletonRegion>
      ) : null}
      {query.data && empty ? (
        <BotSideSheetEmpty
          icon={RiBrainLine}
          title={t("No memories yet")}
          description={t("{bot} saves what it learns here. You can change or delete anything.", {
            bot: botName,
          })}
          action={
            writable ? (
              <Button
                variant="outline"
                onClick={() => {
                  const person = sections.find((section) => section.scope === "person");

                  if (person) setAdding(sectionKey(person));
                }}
              >
                {t("Add memory")}
              </Button>
            ) : undefined
          }
        />
      ) : null}
      {query.data && !empty ? (
        <>
          {sections
            .filter(
              (section) =>
                section.memories.length > 0 ||
                section.scope === "person" ||
                section.scope === "bot",
            )
            .map((section) => {
              const copy = sectionCopy(section);
              const key = sectionKey(section);

              return (
                <BotSideSheetSection
                  key={key}
                  title={
                    <span className="flex items-center gap-1.5">
                      {copy.title}
                      <span className="text-muted-foreground tabular-nums">
                        {i18n.formatNumber(section.memories.length)}
                      </span>
                      {isAlmostFull(section) ? (
                        <Badge variant="warning">{t("Almost full")}</Badge>
                      ) : null}
                    </span>
                  }
                  description={copy.description}
                  action={
                    writable ? (
                      <Button
                        size="icon-sm"
                        variant="ghost-muted"
                        aria-label={t("Add to {name}", { name: copy.title })}
                        disabled={busy}
                        onClick={() => setAdding(key)}
                      >
                        <RiAddLine />
                      </Button>
                    ) : undefined
                  }
                >
                  {section.memories.length > 0 ? (
                    <ul>{section.memories.map((memory) => entry(section, memory))}</ul>
                  ) : null}
                  {adding === key ? (
                    <MemoryDraft
                      initial=""
                      label={t("New memory")}
                      busy={busy}
                      onCancel={() => setAdding(null)}
                      onSave={(text) =>
                        void run(
                          () =>
                            create({
                              environmentId,
                              input: { scope: section.scope, scopeId: section.scopeId, text },
                            }),
                          t("Memory couldn't be saved"),
                        ).then((saved) => saved && setAdding(null))
                      }
                    />
                  ) : null}
                </BotSideSheetSection>
              );
            })}
          <p className="text-xs text-muted-foreground">
            {t("Deleting a memory does not remove it from past chats.")}
          </p>
        </>
      ) : null}
    </BotSideSheet>
  );
}
