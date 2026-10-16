import {
  type EnvironmentId,
  isSkillFile,
  LIBRARY_SKILLS_FOLDER_ID,
  type LibraryFile,
  type LibraryFolder,
  LibraryFolderId,
  type LibraryVisibility,
  parseSkillFrontMatter,
} from "@otto/contracts";
import { RiFolderUploadLine, RiSparkling2Line, RiUploadLine } from "@remixicon/react";
import type { AtomCommandResult } from "@otto/client-runtime/state/runtime";
import { useNavigate } from "@tanstack/react-router";
import JSZip from "jszip";
import { AsyncResult } from "effect/unstable/reactivity";
import { useEffect, useRef, useState } from "react";

import { useI18n } from "../../i18n";
import { SkeletonSettingsSections } from "../ui/skeleton";
import { randomUUID } from "../../lib/utils";
import { libraryEnvironment } from "../../state/library";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { useLibraryData, useLibraryFailure, useLibraryUpload } from "../library/use-library";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Field, FieldError, FieldLabel } from "../ui/field";
import { Input } from "../ui/input";
import { MenuItem } from "../ui/menu";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { Spinner } from "../ui/spinner";
import { AddMenu, CustomizeGroup, CustomizeRow } from "./customize-group";
import { planSkillImport } from "./customize.logic";

/** What an import brings besides its SKILL.md: files by their path inside the skill. */
interface SkillSource {
  readonly content: string;
  readonly folders: readonly string[];
  readonly files: ReadonlyArray<{ readonly path: string; readonly value: File }>;
}

interface SkillDraft {
  readonly name: string;
  readonly description: string;
  readonly visibility: LibraryVisibility;
  readonly source: SkillSource | null;
}

const fileName = (path: string) => path.split("/").pop() ?? path;

/**
 * A new skill, from scratch or from an imported folder or zip: its name and when to use it
 * become the SKILL.md front matter; it joins the group it was added from.
 */
function SkillDialog({
  environmentId,
  initial,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly initial: SkillDraft;
  readonly onClose: () => void;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const createSkill = useAtomCommand(libraryEnvironment.createSkill, { reportFailure: false });
  const createFolder = useAtomCommand(libraryEnvironment.createFolder, { reportFailure: false });
  const { upload } = useLibraryUpload();
  const fail = useLibraryFailure();
  const [draft, setDraft] = useState(initial);
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);

  const error = !draft.name.trim()
    ? t("Name is required.")
    : !draft.description.trim()
      ? t("Say when bots should use it.")
      : null;

  const save = async () => {
    setAttempted(true);

    if (error) return;
    setSaving(true);

    const created = await createSkill({
      environmentId,
      input: {
        name: draft.name.trim(),
        description: draft.description.trim(),
        visibility: draft.visibility,
        ...(draft.source ? { content: draft.source.content } : {}),
      },
    });

    if (!AsyncResult.isSuccess(created)) {
      setSaving(false);
      fail(created, t("Could not create the skill"));

      return;
    }

    const source = draft.source;

    if (source) {
      const folderIds = new Map<string, LibraryFolderId>([["", created.value.folderId]]);

      for (const path of source.folders) {
        const folderId = LibraryFolderId.make(randomUUID());
        const parentId = folderIds.get(path.split("/").slice(0, -1).join("/"));

        if (parentId === undefined) continue;

        const result = await createFolder({
          environmentId,
          input: { folderId, parentId, title: fileName(path) },
        });

        if (AsyncResult.isSuccess(result)) folderIds.set(path, folderId);
      }

      for (const [path, folderId] of folderIds) {
        const inFolder = source.files.filter(
          (file) => file.path.split("/").slice(0, -1).join("/") === path,
        );

        if (inFolder.length > 0) {
          await upload(
            environmentId,
            inFolder.map((file) => file.value),
            { folderId },
          );
        }
      }
    }

    setSaving(false);
    onClose();
    void navigate({
      to: "/settings/skills/$id",
      params: { id: created.value.folderId },
    });
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>{initial.source ? t("Import skill") : t("New skill")}</DialogTitle>
        </DialogHeader>
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <DialogPanel className="flex flex-col gap-4">
            <Field>
              <FieldLabel>{t("Name")}</FieldLabel>
              <Input
                autoFocus
                value={draft.name}
                maxLength={64}
                placeholder={t("Weekly report")}
                onChange={(event) => setDraft({ ...draft, name: event.currentTarget.value })}
              />
            </Field>
            <Field>
              <FieldLabel>{t("When to use it")}</FieldLabel>
              <Textarea
                value={draft.description}
                maxLength={1024}
                placeholder={t("Use when someone asks for the weekly numbers.")}
                onChange={(event) => setDraft({ ...draft, description: event.currentTarget.value })}
              />
              {attempted && error ? <FieldError match>{error}</FieldError> : null}
            </Field>
            {initial.source ? (
              <p className="text-13px text-muted-foreground">
                {t("SKILL.md and {count} more files.", { count: initial.source.files.length })}
              </p>
            ) : null}
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("Cancel")}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? <Spinner /> : null}
              {initial.source ? t("Import") : t("Create skill")}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

/** Reads a picked folder or zip as a skill draft, or says why it isn't one. */
async function readSkillImport(
  entries: ReadonlyArray<{ readonly path: string; readonly value: File }>,
  visibility: LibraryVisibility,
): Promise<SkillDraft | null> {
  const plan = planSkillImport(entries);

  if (plan === null) return null;
  const content = await plan.main.text();
  const frontMatter = parseSkillFrontMatter(content);

  return {
    name: (frontMatter.name ?? plan.rootName ?? "").slice(0, 64),
    description: (frontMatter.description ?? "").slice(0, 1024),
    visibility,
    source: { content, folders: plan.folders, files: plan.files },
  };
}

async function zipEntries(zipFile: File) {
  const zip = await JSZip.loadAsync(zipFile);
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);

  return Promise.all(
    entries.map(async (entry) => ({
      path: entry.name,
      value: new File([await entry.async("blob")], fileName(entry.name)),
    })),
  );
}

/** Every folder and file inside a skill, deepest folders first, the skill's own folder last. */
export function skillContents(
  skill: LibraryFolder,
  folders: readonly LibraryFolder[],
  files: readonly LibraryFile[],
) {
  const inside: LibraryFolder[] = [skill];

  for (const folder of inside) {
    inside.push(...folders.filter((candidate) => candidate.parentId === folder.id));
  }

  const ids = new Set(inside.map((folder) => folder.id));

  return {
    folders: inside.toReversed(),
    files: files.filter((file) => file.folderId !== null && ids.has(file.folderId)),
  };
}

/**
 * Deletes a skill once confirmed: its files, then its folders from the deepest up, since only
 * an empty folder can go. Stops at the first failure. Resolves to whether it is gone.
 */
export async function deleteSkill(input: {
  readonly contents: ReturnType<typeof skillContents>;
  readonly confirm: () => Promise<boolean>;
  readonly deleteFile: (fileId: LibraryFile["id"]) => Promise<AtomCommandResult<unknown, unknown>>;
  readonly deleteFolder: (
    folderId: LibraryFolder["id"],
  ) => Promise<AtomCommandResult<unknown, unknown>>;
  readonly fail: (result: AtomCommandResult<unknown, unknown>) => void;
}): Promise<boolean> {
  if (!(await input.confirm())) return false;

  for (const file of input.contents.files) {
    const result = await input.deleteFile(file.id);

    if (!AsyncResult.isSuccess(result)) {
      input.fail(result);

      return false;
    }
  }

  for (const folder of input.contents.folders) {
    const result = await input.deleteFolder(folder.id);

    if (!AsyncResult.isSuccess(result)) {
      input.fail(result);

      return false;
    }
  }

  return true;
}

/** One skill in its group card: its name and when to use it, from SKILL.md. */
/** A skill's SKILL.md front matter (its name and when to use it), reloaded when the file saves. */
export function useSkillFrontMatter(environmentId: EnvironmentId, main: LibraryFile | undefined) {
  const document = useEnvironmentQuery(
    main ? libraryEnvironment.document({ environmentId, input: { fileId: main.id } }) : null,
  );

  const refreshDocument = document.refresh;
  const savedAt = main?.updatedAt;

  useEffect(() => {
    if (savedAt) refreshDocument();
  }, [savedAt, refreshDocument]);

  return document.data ? parseSkillFrontMatter(document.data.content) : {};
}

function SkillRow({
  environmentId,
  skill,
  main,
}: {
  readonly environmentId: EnvironmentId;
  readonly skill: LibraryFolder;
  readonly main: LibraryFile | undefined;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const frontMatter = useSkillFrontMatter(environmentId, main);

  return (
    <CustomizeRow
      logo={<RiSparkling2Line aria-hidden className="size-4" />}
      name={frontMatter.name ?? skill.title}
      detail={frontMatter.description ?? (main ? t("Skill") : t("No SKILL.md yet"))}
      onOpen={() => void navigate({ to: "/settings/skills/$id", params: { id: skill.id } })}
    />
  );
}

/**
 * Otto: Customize's Skills tab: the Library's Skills folder, one folder per skill holding its
 * SKILL.md and any references, scripts or assets. Two group cards like Integrations: Yours (you
 * and the bots you own; anyone chatting with them uses it without seeing it here) and Workspace,
 * each with a plus to write a skill or import a folder or zip into that group. Scripts are read
 * by bots, never run.
 */
export function CustomizeSkills({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const { t } = useI18n();
  const data = useLibraryData();
  const [draft, setDraft] = useState<SkillDraft | null>(null);
  const importVisibility = useRef<LibraryVisibility>("user");
  const folderInput = useRef<HTMLInputElement>(null);
  const zipInput = useRef<HTMLInputElement>(null);

  const skills = data.folders
    .filter((folder) => folder.parentId === LIBRARY_SKILLS_FOLDER_ID)
    .toSorted((left, right) => left.title.localeCompare(right.title));

  if (!data.loaded)
    return <SkeletonSettingsSections label={t("Loading settings")} sections={[2, 2]} />;

  const importSkill = async (
    read: () => Promise<ReadonlyArray<{ readonly path: string; readonly value: File }>>,
  ) => {
    try {
      const next = await readSkillImport(await read(), importVisibility.current);

      if (next) {
        setDraft(next);

        return;
      }

      toastManager.add({
        type: "error",
        title: t("Not a skill"),
        description: t("A skill needs a SKILL.md file."),
      });
    } catch {
      toastManager.add({ type: "error", title: t("Could not read that skill") });
    }
  };

  const pick = (visibility: LibraryVisibility, input: HTMLInputElement | null) => {
    importVisibility.current = visibility;
    input?.click();
  };

  return (
    <div className="flex flex-col gap-10">
      {(["user", "organization"] as const).map((visibility) => {
        const group = skills.filter((skill) => skill.visibility === visibility);

        return (
          <CustomizeGroup
            key={visibility}
            title={visibility === "user" ? t("Yours") : t("Team")}
            count={group.length}
            empty={
              group.length === 0
                ? {
                    icon: <RiSparkling2Line />,
                    description: t("No skills"),
                  }
                : null
            }
            action={
              <AddMenu label={visibility === "user" ? t("Add to yours") : t("Add to team")}>
                <MenuItem
                  onClick={() => setDraft({ name: "", description: "", visibility, source: null })}
                >
                  <RiSparkling2Line />
                  {t("New skill")}
                </MenuItem>
                <MenuItem onClick={() => pick(visibility, folderInput.current)}>
                  <RiFolderUploadLine />
                  {t("Import folder")}
                </MenuItem>
                <MenuItem onClick={() => pick(visibility, zipInput.current)}>
                  <RiUploadLine />
                  {t("Import .zip")}
                </MenuItem>
              </AddMenu>
            }
          >
            {group.map((skill) => (
              <SkillRow
                key={skill.id}
                environmentId={environmentId}
                skill={skill}
                main={data.files.find((file) => file.folderId === skill.id && isSkillFile(file))}
              />
            ))}
          </CustomizeGroup>
        );
      })}
      <input
        ref={(node) => {
          folderInput.current = node;
          node?.setAttribute("webkitdirectory", "");
        }}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          const files = [...(event.currentTarget.files ?? [])];
          event.currentTarget.value = "";
          void importSkill(async () =>
            files.map((file) => ({ path: file.webkitRelativePath || file.name, value: file })),
          );
        }}
      />
      <input
        ref={zipInput}
        type="file"
        accept=".zip,application/zip"
        hidden
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";

          if (file) void importSkill(() => zipEntries(file));
        }}
      />
      {draft ? (
        <SkillDialog environmentId={environmentId} initial={draft} onClose={() => setDraft(null)} />
      ) : null}
    </div>
  );
}
