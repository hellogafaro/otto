import { useAtomValue } from "@effect/atom-react";
import {
  BotId,
  isSkillFile,
  type ComposioConnection,
  type EnvironmentId,
  type LibraryFolderId,
  type McpServer,
  type McpServerId,
  type ProviderAccessStatus,
} from "@otto/contracts";
import { Predicate } from "effect";
import { useMemo } from "react";

import { useI18n } from "../../i18n";
import { ensureLocalApi } from "../../localApi";
import { botEnvironment, environmentPeopleAtom } from "../../state/bots";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { useLibraryData } from "../library/useLibrary";
import { toastManager } from "../ui/toast";
import { BotSkillsSection, BotToolsSection } from "./BotToolsSection";
import { botMcpServers, botSkillFolders, buildBotAccountItems } from "./botTools.logic";
import type { Bot } from "./types";

// SAFETY: the empty ID is an inactive-query sentinel; no environment request is sent for it.
const NO_ENVIRONMENT = "" as EnvironmentId;

/**
 * Otto: A bot's Integrations and Skills with their per-bot switches. They save at once, like
 * Customize's, apart from the profile draft: MCP servers and skills on the bot, app accounts
 * on the account (only its owner lends a personal one to someone else's bot).
 */
export function BotToolSwitches({
  bot,
  environmentId,
  servers,
  accessStatuses,
  canDelegate,
}: {
  readonly bot: Bot;
  readonly environmentId: EnvironmentId | null;
  readonly servers: readonly McpServer[];
  readonly accessStatuses: readonly ProviderAccessStatus[];
  readonly canDelegate: boolean;
}) {
  const { t } = useI18n();
  const updateBot = useAtomCommand(botEnvironment.update, { reportFailure: false });

  const updateAccount = useAtomCommand(serverEnvironment.updateComposioConnection, {
    reportFailure: false,
  });

  const people = useAtomValue(environmentPeopleAtom(environmentId ?? NO_ENVIRONMENT));
  const library = useLibraryData();
  const ownerPersonId = bot.owner?.kind === "person" ? bot.owner.personId : null;

  const composioStatus = useEnvironmentQuery(
    environmentId ? serverEnvironment.composioStatus({ environmentId, input: {} }) : null,
  );

  const accounts = useMemo(
    () =>
      buildBotAccountItems(
        composioStatus.data?.connections ?? [],
        { id: bot.id, ownerPersonId },
        people.current?.id ?? null,
      ),
    [bot.id, composioStatus.data, ownerPersonId, people],
  );

  const saveSwitches = (input: {
    readonly disabledMcpServerIds?: readonly McpServerId[];
    readonly disabledSkillIds?: readonly LibraryFolderId[];
  }) => {
    if (!environmentId) return;

    void updateBot({ environmentId, input: { botId: BotId.make(bot.id), ...input } }).then(
      (result) => {
        if (Predicate.isTagged(result, "Failure")) {
          toastManager.add({ type: "error", title: t("Could not save bot settings") });
        }
      },
    );
  };

  const switchAccount = async (connection: ComposioConnection, enabled: boolean) => {
    if (!environmentId) return;
    const name = connection.toolkitName ?? connection.toolkitSlug;
    const lends = accounts.some((item) => item.connection.id === connection.id && item.lends);

    if (enabled && lends) {
      const confirmed = await ensureLocalApi().dialogs.confirm(
        t(
          "Turn on your {app} account for {bot}? Everyone who chats with {bot} can use it through the bot, without seeing it.",
          { app: name, bot: bot.name },
        ),
        { confirmLabel: t("Turn on") },
      );

      if (!confirmed) return;
    }

    const result = await updateAccount({
      environmentId,
      input: { connectionId: connection.id, bot: { botId: bot.id, enabled } },
    });

    if (Predicate.isTagged(result, "Failure")) {
      toastManager.add({ type: "error", title: t("Could not update {name}", { name }) });

      return;
    }

    composioStatus.refresh();
  };

  return (
    <>
      <BotToolsSection
        servers={botMcpServers(servers, ownerPersonId)}
        accessStatuses={accessStatuses}
        disabledIds={bot.disabledMcpServerIds}
        onDisabledIdsChange={(ids) => saveSwitches({ disabledMcpServerIds: ids })}
        accounts={accounts}
        onAccountChange={(connection, enabled) => void switchAccount(connection, enabled)}
        canDelegate={canDelegate}
      />
      {environmentId ? (
        <BotSkillsSection
          environmentId={environmentId}
          skills={botSkillFolders(library.folders, ownerPersonId).map((folder) => ({
            folder,
            main: library.files.find((file) => file.folderId === folder.id && isSkillFile(file)),
          }))}
          disabledIds={bot.disabledSkillIds ?? []}
          onDisabledIdsChange={(ids) => saveSwitches({ disabledSkillIds: ids })}
        />
      ) : null}
    </>
  );
}
