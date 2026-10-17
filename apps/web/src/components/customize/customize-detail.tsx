import { toast } from "sonner";
import { useAtomValue } from "@effect/atom-react";
import {
  type EnvironmentId,
  isSkillFile,
  type LibraryFile,
  type LibraryFolder,
  type LibraryVisibility,
  type McpServer,
  parseSkillFrontMatter,
  type WorkParticipant,
} from "@otto/contracts";
import {
  RiDeleteBinLine,
  RiFileTextLine,
  RiFolderOpenLine,
  RiPencilLine,
  RiPuzzleLine,
  RiShapesLine,
  RiSparkling2Line,
  RiToolsLine,
} from "@remixicon/react";
import { useNavigate } from "@tanstack/react-router";
import { AsyncResult } from "effect/unstable/reactivity";
import { type ReactNode, useEffect, useState } from "react";

import { useI18n } from "../../i18n";
import { ensureLocalApi } from "../../local-api";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { libraryEnvironment } from "../../state/library";
import { environmentMcpServersAtom } from "../../state/mcp-servers";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { environmentSnapshotAtom } from "../../state/shell";
import { useAtomCommand } from "../../state/use-atom-command";
import { LibraryVisibilitySelect } from "../library/library-actions";
import { formatLibrarySize } from "../library/library.logic";
import { useLibraryData } from "../library/use-library";
import { SettingsCard, SettingsRow } from "../settings/settings-layout";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Switch } from "../ui/switch";
import { SettingsPageContainer } from "../settings/settings-layout";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { WorkEmpty } from "../work/work-pages";
import { CustomizeGroup, CustomizeItem, CustomizeRow } from "./customize-group";
import { serverHost } from "./customize-integrations";
import { deleteSkill, skillContents } from "./customize-skills";
import { systemSkillForPage, type SystemSkillView } from "./system-skills";
import type { CustomizeEntityType } from "./customize.logic";
import { McpServerDialog, useMcpCommands } from "./mcp-server-dialog";

/** The header of a detail page: a 40px logo tile, the 22px name and one muted line. */
export function DetailHeader({
  logo,
  title,
  description,
  actions,
}: {
  readonly logo: ReactNode;
  readonly title: string;
  readonly description: string | null;
  /** Quiet icon actions at the header's right, such as Edit and Remove. */
  readonly actions?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-4">
      <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border/70 bg-card text-muted-foreground">
        {logo}
      </span>
      <div className="min-w-0">
        <h1 className="truncate text-22px leading-title font-medium tracking-title-lg text-foreground">
          {title}
        </h1>
        {description ? (
          <p className="line-clamp-2 text-13px leading-copy text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="ms-auto flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </div>
  );
}

/** The Owner row: who an integration or skill serves, changed only by the person who added it. */
function OwnerRow({
  visibility,
  editable,
  owner,
  onChange,
}: {
  readonly visibility: LibraryVisibility;
  readonly editable: boolean;
  readonly owner: string | null;
  readonly onChange: (visibility: LibraryVisibility) => void;
}) {
  const { t } = useI18n();

  return (
    <SettingsRow
      title={t("Owner")}
      description={owner ? t("Added by {name}", { name: owner }) : undefined}
      control={
        <LibraryVisibilitySelect value={visibility} editable={editable} onChange={onChange} />
      }
    />
  );
}

/** A quiet 28px icon action with its tooltip, at the right of the page header. */
function TopAction({
  icon,
  label,
  onClick,
}: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button size="icon-sm" variant="ghost-muted" aria-label={label} onClick={onClick}>
            {icon}
          </Button>
        }
      />
      <TooltipPopup side="bottom">{label}</TooltipPopup>
    </Tooltip>
  );
}

function DetailLayout({ children }: { readonly children: ReactNode }) {
  return <SettingsPageContainer>{children}</SettingsPageContainer>;
}

const personName = (participant: WorkParticipant | undefined) =>
  participant?.kind === "person" ? participant.displayName : null;

function NotFound() {
  const { t } = useI18n();

  return (
    <DetailLayout>
      <WorkEmpty
        icon={<RiShapesLine />}
        title={t("Not found")}
        description={t("It may have been removed, or it isn't shared with you.")}
      />
    </DetailLayout>
  );
}

/** What a remote server offers, read live from the server itself. */
/** The saved header names, shown only to the person who manages the server. Values never leave it. */
function McpHeadersRow({
  environmentId,
  server,
}: {
  readonly environmentId: EnvironmentId;
  readonly server: McpServer;
}) {
  const { t } = useI18n();

  const headers = useEnvironmentQuery(
    serverEnvironment.mcpServerHeaders({ environmentId, input: { mcpServerId: server.id } }),
  );

  const names = headers.data?.names ?? [];

  if (names.length === 0) return null;

  return (
    <SettingsRow
      title={t("Headers")}
      description={<span className="break-all font-mono text-xs">{names.join(", ")}</span>}
    />
  );
}

function McpTools({
  environmentId,
  server,
  edits,
}: {
  readonly environmentId: EnvironmentId;
  readonly server: McpServer;
  /** Bumped when the edit dialog closes, since new headers can change what the server lists. */
  readonly edits: number;
}) {
  const { t } = useI18n();

  const tools = useEnvironmentQuery(
    server.enabled && server.transport === "url"
      ? serverEnvironment.mcpServerTools({ environmentId, input: { mcpServerId: server.id } })
      : null,
  );

  const refreshTools = tools.refresh;

  useEffect(() => {
    if (edits > 0) refreshTools();
  }, [edits, refreshTools]);

  const commands = useMcpCommands();

  const authenticate = useAtomCommand(serverEnvironment.authenticateMcpServer, {
    reportFailure: false,
  });

  const [signingIn, setSigningIn] = useState(false);
  const names = tools.data?.toolNames ?? [];
  const needsSignIn = tools.data?.needsSignIn === true;

  const signIn = async () => {
    setSigningIn(true);

    const result = await authenticate({
      environmentId,
      mcpServerId: server.id,
      onAuthorizationUrl: (url) => ensureLocalApi().shell.openExternal(url),
    });

    setSigningIn(false);

    if (
      !commands.failed(t("{name} sign-in couldn't be completed", { name: server.name }), result)
    ) {
      tools.refresh();
    }
  };

  const note = !server.enabled
    ? t("Turn it on to see its tools.")
    : needsSignIn
      ? t("Sign in to see its tools.")
      : tools.error
        ? t("Couldn't reach the server.")
        : tools.data === undefined
          ? t("Loading tools")
          : names.length === 0
            ? t("No tools")
            : null;

  return (
    <CustomizeGroup
      title={t("Tools")}
      count={tools.data && !needsSignIn ? names.length : undefined}
      empty={note ? { icon: <RiToolsLine />, description: note } : null}
      action={
        needsSignIn ? (
          <Button size="sm" variant="outline" disabled={signingIn} onClick={() => void signIn()}>
            {signingIn ? <Spinner /> : null}
            {t("Sign in")}
          </Button>
        ) : undefined
      }
    >
      {names.map((name) => (
        <CustomizeItem
          key={name}
          icon={<RiToolsLine aria-hidden className="size-4" />}
          name={name}
        />
      ))}
    </CustomizeGroup>
  );
}

function McpDetail({
  environmentId,
  id,
}: {
  readonly environmentId: EnvironmentId;
  readonly id: string;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const commands = useMcpCommands();
  const servers = useAtomValue(environmentMcpServersAtom(environmentId));
  const personId = useAtomValue(environmentSnapshotAtom(environmentId))?.currentPersonId ?? null;
  const [editing, setEditing] = useState(false);
  const [edits, setEdits] = useState(0);
  const server: McpServer | undefined = servers.find((candidate) => candidate.id === id);

  if (!server) return <NotFound />;
  const manageable = server.createdBy === undefined || server.createdBy.personId === personId;

  const toggle = async (enabled: boolean) => {
    const result = await (enabled ? commands.enable : commands.disable)({
      environmentId,
      input: { mcpServerId: server.id },
    });

    commands.failed(
      enabled
        ? t("{name} couldn't be turned on", { name: server.name })
        : t("{name} couldn't be turned off", { name: server.name }),
      result,
    );
  };

  const setVisibility = async (visibility: LibraryVisibility) => {
    const result = await commands.setAccess({
      environmentId,
      input: { mcpServerId: server.id, visibility },
    });

    commands.failed(t("{name} couldn't be updated", { name: server.name }), result);
  };

  const remove = async () => {
    const confirmed = await ensureLocalApi().dialogs.confirm(
      t("Remove {name}? Bots stop using its tools.", { name: server.name }),
      { variant: "destructive" },
    );

    if (!confirmed) return;
    const result = await commands.remove({ environmentId, input: { mcpServerId: server.id } });

    if (!commands.failed(t("{name} couldn't be removed", { name: server.name }), result)) {
      void navigate({ to: "/settings/$section", params: { section: "integrations" } });
    }
  };

  const address = server.transport === "url" ? server.url : null;
  const host = serverHost(server, t);

  return (
    <DetailLayout>
      <DetailHeader
        logo={<RiPuzzleLine aria-hidden className="size-5" />}
        title={server.name}
        description={t("MCP server · {host}", { host })}
        actions={
          manageable ? (
            <>
              {address ? (
                <TopAction
                  icon={<RiPencilLine aria-hidden className="size-4" />}
                  label={t("Edit")}
                  onClick={() => setEditing(true)}
                />
              ) : null}
              <TopAction
                icon={<RiDeleteBinLine aria-hidden className="size-4" />}
                label={t("Remove")}
                onClick={() => void remove()}
              />
            </>
          ) : null
        }
      />
      <SettingsCard>
        <SettingsRow
          title={t("Status")}
          description={address ? undefined : t("Local servers aren't supported.")}
          control={
            <Switch
              aria-label={t("Use {name}", { name: server.name })}
              checked={server.enabled}
              disabled={!manageable}
              onCheckedChange={(checked) => void toggle(checked)}
            />
          }
        />
        <OwnerRow
          visibility={server.visibility ?? "organization"}
          editable={manageable}
          owner={manageable ? null : (server.createdBy?.displayName ?? null)}
          onChange={(visibility) => void setVisibility(visibility)}
        />
        {address ? (
          <SettingsRow
            title={t("Address")}
            description={<span className="break-all font-mono text-xs">{address}</span>}
          />
        ) : null}
        {address && manageable ? (
          <McpHeadersRow environmentId={environmentId} server={server} />
        ) : null}
      </SettingsCard>
      <McpTools environmentId={environmentId} server={server} edits={edits} />
      {editing ? (
        <McpServerDialog
          environmentId={environmentId}
          server={server}
          open
          onOpenChange={(open) => {
            setEditing(open);

            if (!open) setEdits((count) => count + 1);
          }}
        />
      ) : null}
    </DetailLayout>
  );
}

function SkillDetail({
  environmentId,
  id,
}: {
  readonly environmentId: EnvironmentId;
  readonly id: string;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const data = useLibraryData();
  const updateFolder = useAtomCommand(libraryEnvironment.updateFolder, { reportFailure: false });
  const deleteFolder = useAtomCommand(libraryEnvironment.deleteFolder, { reportFailure: false });
  const deleteFile = useAtomCommand(libraryEnvironment.deleteFile, { reportFailure: false });
  const skill: LibraryFolder | undefined = data.folders.find((folder) => folder.id === id);
  const main = data.files.find((file) => file.folderId === id && isSkillFile(file));

  const document = useEnvironmentQuery(
    main ? libraryEnvironment.document({ environmentId, input: { fileId: main.id } }) : null,
  );

  const refreshDocument = document.refresh;
  const savedAt = main?.updatedAt;

  useEffect(() => {
    if (savedAt) refreshDocument();
  }, [savedAt, refreshDocument]);

  if (!data.loaded) return <DetailLayout>{null}</DetailLayout>;

  if (!skill) return <NotFound />;
  const editable = data.canEdit(skill);
  const contents = skillContents(skill, data.folders, data.files);
  const frontMatter = document.data ? parseSkillFrontMatter(document.data.content) : {};
  const paths = new Map<string, string>([[skill.id, ""]]);

  for (const folder of contents.folders.toReversed()) {
    if (folder.id === skill.id || folder.parentId === null) continue;
    paths.set(folder.id, `${paths.get(folder.parentId) ?? ""}${folder.title}/`);
  }

  const fileName = (file: LibraryFile) =>
    file.extension ? `${file.title}.${file.extension}` : file.title;

  const files = contents.files
    .map((file) => ({
      file,
      path: `${(file.folderId && paths.get(file.folderId)) ?? ""}${fileName(file)}`,
      main: file === main,
    }))
    .toSorted(
      (left, right) =>
        Number(right.main) - Number(left.main) || left.path.localeCompare(right.path),
    );

  const openFile = (file: LibraryFile) =>
    void (file.type === "document"
      ? navigate({ to: "/library/$fileId", params: { fileId: file.id } })
      : navigate({ to: "/library", search: file.folderId ? { folder: file.folderId } : {} }));

  const setVisibility = async (visibility: LibraryVisibility) => {
    const result = await updateFolder({ environmentId, input: { folderId: skill.id, visibility } });

    if (!AsyncResult.isSuccess(result)) {
      toast.error(t("{name} couldn't be updated", { name: skill.title }));
    }
  };

  const remove = async () => {
    const removed = await deleteSkill({
      contents,
      confirm: () =>
        ensureLocalApi().dialogs.confirm(
          t("Delete {name} and its files? Bots stop using it.", { name: skill.title }),
          { variant: "destructive" },
        ),
      deleteFile: (fileId) => deleteFile({ environmentId, input: { fileId } }),
      deleteFolder: (folderId) => deleteFolder({ environmentId, input: { folderId } }),
      fail: () => toast.error(t("{name} couldn't be deleted", { name: skill.title })),
    });

    if (removed) void navigate({ to: "/settings/$section", params: { section: "skills" } });
  };

  const creator = personName(skill.createdBy);

  return (
    <DetailLayout>
      <DetailHeader
        logo={<RiSparkling2Line aria-hidden className="size-5" />}
        title={frontMatter.name ?? skill.title}
        description={frontMatter.description ?? (main ? null : t("No SKILL.md yet"))}
        actions={
          <>
            {main ? (
              <TopAction
                icon={<RiPencilLine aria-hidden className="size-4" />}
                label={t("Edit SKILL.md")}
                onClick={() => openFile(main)}
              />
            ) : null}
            <TopAction
              icon={<RiFolderOpenLine aria-hidden className="size-4" />}
              label={t("Open folder")}
              onClick={() => void navigate({ to: "/library", search: { folder: skill.id } })}
            />
            {editable ? (
              <TopAction
                icon={<RiDeleteBinLine aria-hidden className="size-4" />}
                label={t("Delete")}
                onClick={() => void remove()}
              />
            ) : null}
          </>
        }
      />
      <SettingsCard>
        <OwnerRow
          visibility={skill.visibility}
          editable={editable}
          owner={editable ? null : creator}
          onChange={(visibility) => void setVisibility(visibility)}
        />
      </SettingsCard>
      <CustomizeGroup title={t("Files")} count={files.length} empty={null}>
        {files.map(({ file, path }) => (
          <CustomizeRow
            key={file.id}
            logo={<RiFileTextLine aria-hidden className="size-4" />}
            name={path}
            detail={formatLibrarySize(file.sizeBytes)}
            onOpen={() => openFile(file)}
          />
        ))}
      </CustomizeGroup>
    </DetailLayout>
  );
}

/** Otto: a built-in skill's page: read-only, its files shown in full. */
function SystemSkillDetail({ skill }: { readonly skill: SystemSkillView }) {
  const { t } = useI18n();

  return (
    <DetailLayout>
      <DetailHeader
        logo={<RiSparkling2Line aria-hidden className="size-5" />}
        title={skill.name}
        description={skill.description}
        actions={null}
      />
      <SettingsCard>
        <SettingsRow title={t("Owner")} description={t("Built in. Every bot has it.")} />
      </SettingsCard>
      {skill.files.map((file) => (
        <CustomizeGroup key={file.path} title={file.path} empty={null}>
          <pre className="overflow-x-auto px-4 py-3 font-mono text-xs whitespace-pre-wrap text-foreground">
            {file.content}
          </pre>
        </CustomizeGroup>
      ))}
    </DetailLayout>
  );
}

function DetailBody({
  type,
  environmentId,
  id,
}: {
  readonly type: CustomizeEntityType;
  readonly environmentId: EnvironmentId;
  readonly id: string;
}) {
  switch (type) {
    case "mcp":
      return <McpDetail environmentId={environmentId} id={id} />;
    case "skill": {
      const builtIn = systemSkillForPage(id);

      return builtIn ? (
        <SystemSkillDetail skill={builtIn} />
      ) : (
        <SkillDetail environmentId={environmentId} id={id} />
      );
    }
  }
}

/**
 * Otto: One MCP server or skill on its own page (an app account opens as a dialog on its app's page),
 * on the `narrow` column: a 40px logo tile beside the 22px name and its type line, then one
 * Settings-style card (Status with its switch or state, Owner, and a server's Address), then
 * a server's tools or a skill's files. Actions (Edit, Remove, Disconnect, Delete) are quiet 28px
 * icons with tooltips at the header's right, never a menu.
 */
export function CustomizeDetailPage({
  type,
  id,
}: {
  readonly type: CustomizeEntityType;
  readonly id: string;
}) {
  const environmentId = usePrimaryEnvironmentId();

  if (!environmentId) return <DetailLayout>{null}</DetailLayout>;

  return <DetailBody type={type} environmentId={environmentId} id={id} />;
}
