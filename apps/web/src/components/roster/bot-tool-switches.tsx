import { useAtomValue } from "@effect/atom-react";
import {
  BotId,
  isSkillFile,
  type EnvironmentId,
  type LibraryFolderId,
  type McpServer,
  type McpServerId,
  type ProviderAccessStatus,
} from "@otto/contracts";
import { Predicate } from "effect";
import { useEffect, useMemo, useState } from "react";

import { useAutosave } from "../../hooks/use-autosave";
import { useI18n } from "../../i18n";
import { botEnvironment, environmentPeopleAtom } from "../../state/bots";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { useLibraryData } from "../library/use-library";
import { toastManager } from "../ui/toast";
import { BotSkillsSection, BotToolsSection } from "./bot-tools-section";
import { botMcpServers, botSkillFolders, buildBotAccountItems } from "./bot-tools.logic";
import type { Bot } from "./types";

const sameIds = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && left.every((id) => right.includes(id));

// SAFETY: the empty ID is an inactive-query sentinel; no environment request is sent for it.
const NO_ENVIRONMENT = "" as EnvironmentId;

/**
 * Otto: A bot's Integrations and Skills with their per-bot switches, saved like the rest of the
 * page: MCP servers and skills on the bot, app accounts on the account (only its owner turns a
 * personal one on for someone else's bot).
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

  // Otto: Switches show their new state at once and save together 800ms after the last flip.
  const [pendingMcp, setPendingMcp] = useState<readonly McpServerId[] | null>(null);
  const [pendingSkills, setPendingSkills] = useState<readonly LibraryFolderId[] | null>(null);
  const [pendingAccounts, setPendingAccounts] = useState<Readonly<Record<string, boolean>>>({});
  const disabledMcp = pendingMcp ?? bot.disabledMcpServerIds;
  const disabledSkills = pendingSkills ?? bot.disabledSkillIds ?? [];

  // A pending choice gives way once the saved bot or account says the same.
  useEffect(() => {
    if (pendingMcp && sameIds(pendingMcp, bot.disabledMcpServerIds)) setPendingMcp(null);
  }, [bot.disabledMcpServerIds, pendingMcp]);

  useEffect(() => {
    if (pendingSkills && sameIds(pendingSkills, bot.disabledSkillIds ?? [])) {
      setPendingSkills(null);
    }
  }, [bot.disabledSkillIds, pendingSkills]);

  useEffect(() => {
    const settled = accounts.filter((item) => pendingAccounts[item.connection.id] === item.enabled);

    if (settled.length === 0) return;

    setPendingAccounts((current) =>
      Object.fromEntries(
        Object.entries(current).filter(
          ([id]) => !settled.some((item) => item.connection.id === id),
        ),
      ),
    );
  }, [accounts, pendingAccounts]);

  const save = () => {
    if (!environmentId) return;

    if (pendingMcp || pendingSkills) {
      void updateBot({
        environmentId,
        input: {
          botId: BotId.make(bot.id),
          ...(pendingMcp ? { disabledMcpServerIds: pendingMcp } : {}),
          ...(pendingSkills ? { disabledSkillIds: pendingSkills } : {}),
        },
      }).then((result) => {
        if (!Predicate.isTagged(result, "Failure")) return;
        setPendingMcp(null);
        setPendingSkills(null);
        toastManager.add({ type: "error", title: t("Could not save bot settings") });
      });
    }

    const changed = accounts.filter(
      (item) =>
        pendingAccounts[item.connection.id] !== undefined &&
        pendingAccounts[item.connection.id] !== item.enabled,
    );

    if (changed.length === 0) return;

    void Promise.all(
      changed.map((item) =>
        updateAccount({
          environmentId,
          input: {
            connectionId: item.connection.id,
            bot: { botId: bot.id, enabled: !item.enabled },
          },
        }),
      ),
    ).then((results) => {
      if (results.some((result) => Predicate.isTagged(result, "Failure"))) {
        setPendingAccounts({});
        toastManager.add({ type: "error", title: t("Could not save bot settings") });
      }

      composioStatus.refresh();
    });
  };

  const autosave = useAutosave(save);

  return (
    <>
      <BotToolsSection
        servers={botMcpServers(servers, ownerPersonId)}
        accessStatuses={accessStatuses}
        disabledIds={disabledMcp}
        onDisabledIdsChange={(ids) => {
          setPendingMcp(ids);
          autosave.schedule();
        }}
        accounts={accounts.map((item) => ({
          ...item,
          enabled: pendingAccounts[item.connection.id] ?? item.enabled,
        }))}
        onAccountChange={(connection, enabled) => {
          setPendingAccounts((current) => ({ ...current, [connection.id]: enabled }));
          autosave.schedule();
        }}
        canDelegate={canDelegate}
      />
      {environmentId ? (
        <BotSkillsSection
          environmentId={environmentId}
          skills={botSkillFolders(library.folders, ownerPersonId).map((folder) => ({
            folder,
            main: library.files.find((file) => file.folderId === folder.id && isSkillFile(file)),
          }))}
          disabledIds={disabledSkills}
          onDisabledIdsChange={(ids) => {
            setPendingSkills(ids);
            autosave.schedule();
          }}
        />
      ) : null}
    </>
  );
}
