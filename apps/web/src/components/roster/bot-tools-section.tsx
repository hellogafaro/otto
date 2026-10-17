import { RiInformationLine, RiPuzzleLine, RiSparkling2Line } from "@remixicon/react";
import type {
  ComposioConnection,
  EnvironmentId,
  LibraryFile,
  LibraryFolder,
  LibraryFolderId,
  McpServer,
  McpServerId,
  ProviderAccessStatus,
} from "@otto/contracts";

import { useMemo, type ReactNode } from "react";

import type { MessageKey } from "@otto/client-runtime/i18n";

import { useI18n } from "../../i18n";
import { cn } from "../../lib/utils";
import { LogoTile } from "../customize/customize-group";
import { AppLogo } from "../customize/customize-integrations";
import { useSkillFrontMatter } from "../customize/customize-skills";
import { SYSTEM_SKILLS } from "../customize/system-skills";
import { SettingsRow, SettingsSection } from "../settings/settings-layout";
import { Switch } from "../ui/switch";
import {
  botToolStatus,
  buildBotToolItems,
  isBotToolEnabled,
  planBotToolToggle,
  type BotAccountItem,
  type BotToolItem,
  type BotToolStatus,
} from "./bot-tools.logic";

const STATUS_LABEL: Record<BotToolStatus, MessageKey> = {
  connected: "Connected",
  "needs-setup": "Needs setup",
  error: "Error",
};

const STATUS_DOT: Record<BotToolStatus, string> = {
  connected: "bg-success",
  "needs-setup": "bg-warning",
  error: "bg-destructive",
};

/**
 * Otto: One thing a bot can use, with its per-bot switch, in Customize's row shape: a 32px
 * logo tile, the 13px/500 name over a 12px muted line, then the status and the switch.
 */
export function BotToggleRow({
  icon,
  name,
  description,
  status,
  checked,
  disabled = false,
  onCheckedChange,
}: {
  readonly icon: ReactNode;
  readonly name: string;
  readonly description?: string | undefined;
  readonly status: BotToolStatus | null;
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
}) {
  const { t } = useI18n();

  return (
    <div data-settings-row="" className="flex items-center gap-3 px-4 py-3">
      <LogoTile>{icon}</LogoTile>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-13px font-medium text-foreground">{name}</span>
        {description ? (
          <span className="block truncate text-xs text-muted-foreground">{description}</span>
        ) : null}
      </span>
      {status ? (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span aria-hidden className={cn("size-1.5 rounded-full", STATUS_DOT[status])} />
          {t(STATUS_LABEL[status])}
        </span>
      ) : null}
      <Switch
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => onCheckedChange(Boolean(next))}
        aria-label={
          checked
            ? t("Turn off {name} for this bot", { name })
            : t("Turn on {name} for this bot", { name })
        }
      />
    </div>
  );
}

function ToolIcon({ item }: { readonly item: BotToolItem }) {
  if (!item.logo) return <RiPuzzleLine aria-hidden className="size-4" />;

  return (
    <picture>
      {item.logo.darkSrc ? (
        <source media="(prefers-color-scheme: dark)" srcSet={item.logo.darkSrc} />
      ) : null}
      <img src={item.logo.src} alt="" className="size-4 object-contain" />
    </picture>
  );
}

const urlHost = (value: string) => (URL.canParse(value) ? new URL(value).host : value);

/**
 * The bot's Integrations: the app accounts and MCP servers it can use, each with a switch
 * that saves at once. Team accounts and servers are on for every bot, the viewer's personal
 * ones for the bots they own; turning a personal account on for someone else's bot lends it.
 */
export function BotToolsSection({
  servers,
  accessStatuses,
  disabledIds,
  onDisabledIdsChange,
  accounts,
  onAccountChange,
  canDelegate = true,
}: {
  /** The MCP servers this bot can use before its own switches. */
  readonly servers: readonly McpServer[];
  readonly accessStatuses: readonly ProviderAccessStatus[];
  readonly disabledIds: readonly McpServerId[];
  readonly onDisabledIdsChange: (ids: readonly McpServerId[]) => void;
  readonly accounts: readonly BotAccountItem[];
  readonly onAccountChange: (connection: ComposioConnection, enabled: boolean) => void;
  /** False when the bot's provider can neither hand off work nor receive it. */
  readonly canDelegate?: boolean;
}) {
  // Memoized because this walks the plugin catalog and does not depend on the form draft.
  const items = useMemo(() => buildBotToolItems(servers), [servers]);
  const { t } = useI18n();

  return (
    <SettingsSection id="tools" title={t("Integrations")}>
      {canDelegate ? null : (
        <p role="note" className="flex items-start gap-2 px-4 py-3 text-xs text-muted-foreground">
          <RiInformationLine className="mt-px size-3.5 shrink-0" />
          <span>
            {t(
              "This bot's provider cannot hand off work. It cannot send work to other bots or receive work from them.",
            )}
          </span>
        </p>
      )}
      {items.length === 0 && accounts.length === 0 ? (
        <SettingsRow title={t("No integrations")} />
      ) : null}
      {accounts.map(({ connection, enabled }) => {
        const name = connection.toolkitName ?? connection.toolkitSlug;

        return (
          <BotToggleRow
            key={`app:${connection.id}`}
            icon={<AppLogo src={connection.logoUrl} name={name} className="size-4" />}
            name={name}
            description={connection.alias ?? connection.accountName}
            status={connection.status === "ACTIVE" ? null : "needs-setup"}
            checked={enabled}
            onCheckedChange={(next) => onAccountChange(connection, next)}
          />
        );
      })}
      {items.map((item) => (
        <BotToggleRow
          key={item.id}
          icon={<ToolIcon item={item} />}
          name={item.name}
          description={
            item.kind === "mcp"
              ? t("MCP server · {host}", { host: urlHost(item.description) })
              : item.description
          }
          status={botToolStatus(item, accessStatuses)}
          checked={isBotToolEnabled(item, disabledIds)}
          disabled={!item.workspaceEnabled}
          onCheckedChange={(enabled) =>
            onDisabledIdsChange(planBotToolToggle(disabledIds, item.id, enabled))
          }
        />
      ))}
    </SettingsSection>
  );
}

function BotSkillRow({
  environmentId,
  skill,
  main,
  checked,
  onCheckedChange,
}: {
  readonly environmentId: EnvironmentId;
  readonly skill: LibraryFolder;
  readonly main: LibraryFile | undefined;
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
}) {
  const frontMatter = useSkillFrontMatter(environmentId, main);

  return (
    <BotToggleRow
      icon={<RiSparkling2Line aria-hidden className="size-4" />}
      name={frontMatter.name ?? skill.title}
      description={frontMatter.description}
      status={null}
      checked={checked}
      onCheckedChange={onCheckedChange}
    />
  );
}

/**
 * The bot's Skills: the built-in ones first, always on with their switches disabled, then its
 * Library skills, each on unless switched off for it; switches save at once.
 */
export function BotSkillsSection({
  environmentId,
  skills,
  disabledIds,
  onDisabledIdsChange,
}: {
  readonly environmentId: EnvironmentId;
  readonly skills: ReadonlyArray<{
    readonly folder: LibraryFolder;
    readonly main: LibraryFile | undefined;
  }>;
  readonly disabledIds: readonly LibraryFolderId[];
  readonly onDisabledIdsChange: (ids: readonly LibraryFolderId[]) => void;
}) {
  const { t } = useI18n();

  return (
    <SettingsSection
      id="skills"
      title={t("Skills")}
      description={t("Built-in skills are always on.")}
    >
      {SYSTEM_SKILLS.map((skill) => (
        <BotToggleRow
          key={skill.name}
          icon={<RiSparkling2Line aria-hidden className="size-4" />}
          name={skill.name}
          description={skill.description}
          status={null}
          checked
          disabled
          onCheckedChange={() => undefined}
        />
      ))}
      {skills.map(({ folder, main }) => (
        <BotSkillRow
          key={folder.id}
          environmentId={environmentId}
          skill={folder}
          main={main}
          checked={!disabledIds.includes(folder.id)}
          onCheckedChange={(enabled) =>
            onDisabledIdsChange(planBotToolToggle(disabledIds, folder.id, enabled))
          }
        />
      ))}
    </SettingsSection>
  );
}
