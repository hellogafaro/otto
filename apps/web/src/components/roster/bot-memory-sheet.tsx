import { RiAddLine, RiArrowRightSLine } from "@remixicon/react";
import { Predicate } from "effect";
import { squashAtomCommandFailure } from "@otto/client-runtime/state/runtime";
import {
  type EnvironmentId,
  GENERAL_PROJECT_ID,
  type Memory,
  type MemoryOwner,
  ProjectId,
  MEMORY_TEXT_MAX_CHARS,
} from "@otto/contracts";
import { useState } from "react";
import { toast } from "sonner";

import { BotSideSheet } from "./bot-side-sheet";

import { usePrimarySettings } from "~/hooks/use-settings";
import { useI18n } from "../../i18n";
import { useProjects } from "../../state/entities";
import { memoryEnvironment } from "../../state/memory";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { CardCountRow } from "../customize/customize-group";
import { SettingsSection } from "../settings/settings-layout";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Field, FieldLabel } from "../ui/field";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Skeleton, SkeletonRegion } from "../ui/skeleton";
import { Textarea } from "../ui/textarea";

const OWNERS: ReadonlyArray<MemoryOwner> = ["you", "team"];

/** The Applies to value for a line true in every project. */
const ALL_PROJECTS = "all";

/** The server's own error text, shown as received, or null when it sent none. */
export function memoryErrorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : null;
}

/** "Lora Boutique · Oct 2026 · Weekly report": where a line applies, when it was last confirmed and the chat it came from. */
export function memoryMeta(
  memory: Pick<Memory, "projectId" | "projectTitle" | "confirmedAt" | "threadTitle">,
  labels: { readonly allProjects: string; readonly deletedProject: string },
  formatDate: ReturnType<typeof useI18n>["formatDate"],
) {
  return [
    memory.projectId === null ? labels.allProjects : (memory.projectTitle ?? labels.deletedProject),
    formatDate(new Date(memory.confirmedAt), { month: "short", year: "numeric" }),
    memory.threadTitle,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** What the open dialog edits: a new line in Yours or Team, or an existing line. */
type Editing =
  | { readonly owner: MemoryOwner; readonly memory: null }
  | { readonly owner: MemoryOwner; readonly memory: Memory };

/**
 * Otto: what bots remember, yours and the team's, opened from a chat's details or Settings. It
 * keeps itself up to date; people only fix or add a line, in a dialog, and delete one after a
 * confirmation. A new line applies to the chat's project, or to every project outside one.
 */
export function BotMemorySheet({
  open,
  onOpenChange,
  environmentId,
  projectId,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly environmentId: EnvironmentId;
  /** The project of the chat it was opened from, or null outside one. */
  readonly projectId: ProjectId | null;
}) {
  const { t, plural, formatDate } = useI18n();
  const writable = usePrimarySettings((settings) => settings.memory.enabled);

  const projects = useProjects().filter(
    (project) => project.environmentId === environmentId && project.id !== GENERAL_PROJECT_ID,
  );

  const query = useEnvironmentQuery(
    open ? memoryEnvironment.list({ environmentId, input: {} }) : null,
  );

  const create = useAtomCommand(memoryEnvironment.create, { reportFailure: false });
  const update = useAtomCommand(memoryEnvironment.update, { reportFailure: false });
  const remove = useAtomCommand(memoryEnvironment.remove, { reportFailure: false });
  const [editing, setEditing] = useState<Editing | null>(null);
  const [text, setText] = useState("");
  const [appliesTo, setAppliesTo] = useState<string>(ALL_PROJECTS);
  const [deleting, setDeleting] = useState<Memory | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const owners = {
    you: {
      title: t("Yours"),
      description: t("Learned in your private chats with bots, and used only there."),
    },
    team: {
      title: t("Team"),
      description: t("Learned in chats everyone can read, and used in every chat."),
    },
  } satisfies Record<MemoryOwner, { title: string; description: string }>;

  const labels = { allProjects: t("All projects"), deletedProject: t("Deleted project") };

  /** Runs one change; a failure keeps the dialog open and shows the server's reason. */
  const run = async (
    change: () => Promise<Parameters<typeof squashAtomCommandFailure>[0] | { _tag: "Success" }>,
    failureToast: string,
  ) => {
    setBusy(true);
    setError(null);
    const result = await change();
    setBusy(false);

    if (!Predicate.isTagged(result, "Failure")) return true;
    setError(memoryErrorMessage(squashAtomCommandFailure(result)) ?? t("Memory request failed."));
    toast.error(failureToast);

    return false;
  };

  const openEditor = (next: Editing) => {
    setError(null);
    setText(next.memory?.text ?? "");
    setAppliesTo((next.memory ? next.memory.projectId : projectId) ?? ALL_PROJECTS);
    setEditing(next);
  };

  const trimmed = text.trim();
  const appliesToProjectId = appliesTo === ALL_PROJECTS ? null : ProjectId.make(appliesTo);

  const save = () => {
    if (!editing) return;

    void run(
      () =>
        editing.memory
          ? update({
              environmentId,
              input: { id: editing.memory.id, projectId: appliesToProjectId, text: trimmed },
            })
          : create({
              environmentId,
              input: { owner: editing.owner, projectId: appliesToProjectId, text: trimmed },
            }),
      t("Memory couldn't be saved"),
    ).then((saved) => saved && setEditing(null));
  };

  const confirmDelete = (memory: Memory) =>
    void run(
      () => remove({ environmentId, input: { id: memory.id } }),
      t("Memory couldn't be deleted"),
    ).then((deleted) => {
      if (!deleted) return;
      setDeleting(null);
      setEditing(null);
      toast.success(t("Memory has been deleted"));
    });

  const memories = query.data?.memories ?? [];

  const projectLabel = (value: string) =>
    value === ALL_PROJECTS
      ? labels.allProjects
      : (projects.find((project) => project.id === value)?.title ?? labels.deletedProject);

  const unchanged =
    editing?.memory != null &&
    trimmed === editing.memory.text &&
    appliesToProjectId === editing.memory.projectId;

  return (
    <BotSideSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("Memory")}
      description={t(
        "What bots remember. They learn from chats on their own and forget what stops coming up.",
      )}
    >
      {query.error ? (
        <div
          role="alert"
          className="rounded-lg bg-destructive/8 p-3 text-sm text-destructive-foreground"
        >
          {query.error}
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
            {OWNERS.map((owner) => (
              <SettingsSection key={owner} title={owners[owner].title}>
                {[0, 1].map((row) => (
                  <div key={row} data-settings-row="" className="space-y-1.5 px-4 py-3">
                    <Skeleton className={row === 0 ? "h-3 w-3/4" : "h-3 w-1/2"} />
                    <Skeleton className="h-2.5 w-1/3" />
                  </div>
                ))}
              </SettingsSection>
            ))}
          </div>
        </SkeletonRegion>
      ) : null}
      {query.data ? (
        <>
          {OWNERS.map((owner) => {
            const lines = memories.filter((memory) => memory.owner === owner);

            return (
              <SettingsSection
                key={owner}
                title={owners[owner].title}
                description={owners[owner].description}
              >
                <CardCountRow
                  label={plural(lines.length, { one: "{count} memory", other: "{count} memories" })}
                  action={
                    writable ? (
                      <Button
                        size="icon-sm"
                        variant="ghost-muted"
                        aria-label={t("Add to {name}", { name: owners[owner].title })}
                        onClick={() => openEditor({ owner, memory: null })}
                      >
                        <RiAddLine aria-hidden className="size-4" />
                      </Button>
                    ) : null
                  }
                />
                {lines.map((memory) => (
                  <div key={memory.id} data-settings-row="">
                    <button
                      type="button"
                      disabled={!writable}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left outline-none enabled:hover:bg-foreground/3.5 focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => openEditor({ owner, memory })}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-13px font-medium text-foreground">
                          {memory.text}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {memoryMeta(memory, labels, formatDate)}
                        </span>
                      </span>
                      {writable ? (
                        <RiArrowRightSLine
                          aria-hidden
                          className="size-4 shrink-0 text-muted-foreground"
                        />
                      ) : null}
                    </button>
                  </div>
                ))}
              </SettingsSection>
            );
          })}
          <p className="text-xs text-muted-foreground">
            {t("Bots also search past chats when they need a detail.")}
          </p>
        </>
      ) : null}
      <Dialog open={editing !== null} onOpenChange={(next) => !next && setEditing(null)}>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>{editing?.memory ? t("Edit memory") : t("Add memory")}</DialogTitle>
            <DialogDescription>
              {editing
                ? [
                    owners[editing.owner].title,
                    editing.memory
                      ? formatDate(new Date(editing.memory.confirmedAt), {
                          month: "short",
                          year: "numeric",
                        })
                      : "",
                    editing.memory?.threadTitle,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : null}
            </DialogDescription>
          </DialogHeader>
          <form
            className="contents"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <DialogPanel className="space-y-4">
              <Textarea
                autoFocus
                aria-label={t("Memory")}
                maxLength={MEMORY_TEXT_MAX_CHARS}
                value={text}
                disabled={busy}
                onChange={(event) => setText(event.currentTarget.value)}
              />
              <Field>
                <FieldLabel>{t("Applies to")}</FieldLabel>
                <Select
                  value={appliesTo}
                  disabled={busy}
                  onValueChange={(value) => value && setAppliesTo(value)}
                >
                  <SelectTrigger className="w-full" aria-label={t("Applies to")}>
                    <SelectValue>{projectLabel(appliesTo)}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    <SelectItem value={ALL_PROJECTS}>{labels.allProjects}</SelectItem>
                    {projects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.title}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </Field>
              {error ? (
                <p role="alert" className="text-sm text-destructive-foreground">
                  {error}
                </p>
              ) : null}
            </DialogPanel>
            <DialogFooter className="sm:justify-between">
              {editing?.memory ? (
                <Button
                  type="button"
                  variant="ghost-destructive"
                  disabled={busy}
                  onClick={() => setDeleting(editing.memory)}
                >
                  {t("Delete")}
                </Button>
              ) : (
                <span />
              )}
              <div className="flex gap-1.5">
                <DialogClose render={<Button type="button" variant="ghost" />}>
                  {t("Cancel")}
                </DialogClose>
                <Button type="submit" disabled={busy || trimmed.length === 0 || unchanged}>
                  {t("Save")}
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogPopup>
      </Dialog>
      <AlertDialog open={deleting !== null} onOpenChange={(next) => !next && setDeleting(null)}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Delete memory?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("Bots will forget this. They can learn it again if it comes up.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="ghost" />}>{t("Cancel")}</AlertDialogClose>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => deleting && confirmDelete(deleting)}
            >
              {t("Delete")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </BotSideSheet>
  );
}
