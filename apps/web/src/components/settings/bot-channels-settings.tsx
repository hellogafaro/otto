import { Predicate } from "effect";
import { useAtomValue } from "@effect/atom-react";
import { channelBindingNeedsProject } from "@otto/client-runtime/channel-presentation";
import {
  createTranslator,
  type PluralForms,
  type TranslationParams,
} from "@otto/client-runtime/i18n";
import { defaultProjectIdForBot } from "@otto/shared/channelProject";
import {
  BotId,
  type ChannelConnectionId,
  type ChannelConnectionProfile,
  type ChannelProvider,
  type EnvironmentId,
  type OrchestrationBot,
  type ProjectId,
} from "@otto/contracts";
import { useEffect, useMemo, useRef, useState } from "react";

import { isChannelIdentityConflict, resolveChannelSettingsAccess } from "../../channel-access";
import { requestConfirmDialog } from "../../confirm-dialog";
import { useI18n } from "../../i18n";
import { useEnvironmentSettings } from "../../hooks/use-settings";
import { botEnvironment, environmentBotsAtom } from "../../state/bots";
import { useEnvironmentSessionState } from "../../state/session";
import { environmentSnapshotAtom } from "../../state/shell";
import { useAtomCommand } from "../../state/use-atom-command";
import { LogoTile } from "../customize/customize-group";
import { Badge } from "../ui/badge";
import { Spinner } from "../ui/spinner";
import { toast } from "sonner";
import { CHANNEL_PROVIDER_META } from "./channel-provider-meta";
import type { ProviderConnectionState } from "./provider-status";
import { SettingsMessageRow } from "./settings-detail-layout";
import { SettingsPageContainer, SettingsSection } from "./settings-layout";
import { searchableSetting } from "./settings-search";

// SAFETY: the empty ID is an inactive-query sentinel; no environment request is sent for it.
const NO_ENVIRONMENT = "" as EnvironmentId;

export const UNASSIGNED = "unassigned";

type Translate = (message: string, params?: TranslationParams) => string;

type Pluralize = (count: number, forms: PluralForms) => string;

const englishTranslator = createTranslator("en");

export function assignedBotForConnection(
  connectionId: ChannelConnectionId,
  bots: ReadonlyArray<Pick<OrchestrationBot, "id" | "name" | "archivedAt" | "channelBindings">>,
) {
  return bots.find((bot) =>
    (bot.channelBindings ?? []).some((binding) => binding.connectionId === connectionId),
  );
}

export function providerLabel(provider: ChannelProvider): string {
  if (provider === "imessage") return "Photon";

  if (provider === "whatsapp") return "Meta Cloud API";

  if (provider === "telegram") return "Telegram Bot API";

  if (provider === "slack") return "Slack Socket Mode";

  return "Discord Gateway";
}

export function channelTestInstructions(
  provider: ChannelProvider,
  botName?: string,
  t: Translate = englishTranslator.translate,
): string {
  if (provider === "imessage") return t("Send a direct iMessage to this line to test a reply.");

  if (provider === "whatsapp") return t("Send a direct WhatsApp message to this number.");

  if (provider === "telegram") return t("Send a direct Telegram message to this bot.");
  const name = botName ?? t("the bot");

  if (provider === "slack") {
    return t("Send a direct message or mention {name} in a Slack channel thread.", { name });
  }

  return t("Send a direct message or mention {name} in a Discord server.", { name });
}

export function parsePhotonHostedCredentials(input: string): {
  readonly projectId: string;
  readonly projectSecret: string;
} | null {
  const entries = new Map<string, string>();

  for (const line of input.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    const separator = line.indexOf("=");

    if (separator <= 0) return null;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();

    if (
      (key !== "SPECTRUM_PROJECT_ID" && key !== "SPECTRUM_PROJECT_SECRET") ||
      !value ||
      entries.has(key)
    ) {
      return null;
    }

    entries.set(key, value);
  }

  const projectId = entries.get("SPECTRUM_PROJECT_ID");
  const projectSecret = entries.get("SPECTRUM_PROJECT_SECRET");

  return projectId && projectSecret ? { projectId, projectSecret } : null;
}

type ChannelBot = Pick<OrchestrationBot, "id" | "name" | "archivedAt" | "channelBindings">;

type ChannelBinding = OrchestrationBot["channelBindings"][number];

type LiveProject = { readonly id: ProjectId };

/** The bot bound to a connection and its live binding, when there is one. */
export function connectionAssignment(
  connectionId: ChannelConnectionId,
  bots: ReadonlyArray<ChannelBot>,
) {
  const bot = assignedBotForConnection(connectionId, bots);
  const binding = bot?.channelBindings.find((candidate) => candidate.connectionId === connectionId);

  return { bot, binding };
}

/** Headline state of one connection, for list rows and the channel header. */
export function connectionState(
  bot: ChannelBot | undefined,
  binding: ChannelBinding | undefined,
  liveProjects: ReadonlyArray<LiveProject>,
  t: Translate = englishTranslator.translate,
): Pick<ProviderConnectionState, "tone" | "label"> {
  if (!bot || !binding) return { tone: "neutral", label: t("No bot") };

  if (channelBindingNeedsProject(binding, liveProjects)) {
    return { tone: "attention", label: t("Choose another project") };
  }

  switch (binding.status) {
    case "connecting":
      return { tone: "pending", label: t("Connecting…") };
    case "failed":
      return { tone: "attention", label: t("Connection failed") };
    case "needs-reconnect":
      return { tone: "attention", label: t("Needs reconnect") };
    case "disconnected":
      return { tone: "neutral", label: t("Disconnected") };
    case "not-live":
      return { tone: "attention", label: t("Not live") };
    default:
      return binding.lastError || binding.failureCategory
        ? { tone: "attention", label: t("Needs attention") }
        : { tone: "positive", label: t("Connected") };
  }
}

/** Headline state of a channel kind across all of its connections. */
export function channelState(
  provider: ChannelProvider,
  connections: ReadonlyArray<ChannelConnectionProfile>,
  bots: ReadonlyArray<ChannelBot>,
  liveProjects: ReadonlyArray<LiveProject>,
  t: Translate = englishTranslator.translate,
  plural: Pluralize = englishTranslator.plural,
): Pick<ProviderConnectionState, "tone" | "label"> {
  const own = connections.filter((connection) => connection.provider === provider);

  if (own.length === 0) return { tone: "neutral", label: t("Not set up") };

  const states = own.map((connection) => {
    const { bot, binding } = connectionAssignment(connection.id, bots);

    return connectionState(bot, binding, liveProjects, t);
  });

  if (states.some((state) => state.tone === "attention")) {
    return { tone: "attention", label: t("Needs attention") };
  }

  if (states.some((state) => state.tone === "pending")) {
    return { tone: "pending", label: t("Connecting…") };
  }

  return {
    tone: states.some((state) => state.tone === "positive") ? "positive" : "neutral",
    label: plural(own.length, { one: "{count} connection", other: "{count} connections" }),
  };
}

/** Everything the channel pages read and change, for one environment. */
export function useChannelSettings(environmentId: EnvironmentId | null) {
  const { t } = useI18n();
  const targetEnvironmentId = environmentId ?? NO_ENVIRONMENT;
  const session = useEnvironmentSessionState(targetEnvironmentId);
  const bots = useAtomValue(environmentBotsAtom(targetEnvironmentId));
  const snapshot = useAtomValue(environmentSnapshotAtom(targetEnvironmentId));
  const liveProjects = useMemo(() => snapshot?.projects ?? [], [snapshot]);
  const activeBots = useMemo(() => bots.filter((bot) => bot.archivedAt === null), [bots]);

  const connections = useEnvironmentSettings(
    targetEnvironmentId,
    (settings) => settings.channelConnections,
  );

  const deleteConnection = useAtomCommand(botEnvironment.channels.deleteConnection, {
    reportFailure: false,
  });

  const attach = useAtomCommand(botEnvironment.channels.attach, { reportFailure: false });

  const disconnect = useAtomCommand(botEnvironment.channels.disconnect, {
    reportFailure: false,
  });

  const detach = useAtomCommand(botEnvironment.channels.detach, { reportFailure: false });

  const reconnect = useAtomCommand(botEnvironment.channels.reconnect, {
    reportFailure: false,
  });

  const changeProject = useAtomCommand(botEnvironment.channels.changeProject, {
    reportFailure: false,
  });

  const [busy, setBusy] = useState(false);
  const [busyConnectionId, setBusyConnectionId] = useState<string | null>(null);

  const [pendingProfile, setPendingProfile] = useState<{
    readonly id: string;
    readonly present: boolean;
  } | null>(null);

  const mutationRef = useRef(false);

  const access =
    environmentId === null
      ? "no-environment"
      : resolveChannelSettingsAccess({ isPending: session.isPending, session: session.data });

  // A failed channel command names the identity conflict when that is the cause.
  const failureTitle = (result: Parameters<typeof isChannelIdentityConflict>[0], title: string) =>
    isChannelIdentityConflict(result) ? t("Another bot already uses this account") : title;

  useEffect(() => {
    if (!pendingProfile) return;
    const present = connections.some((connection) => connection.id === pendingProfile.id);

    if (present !== pendingProfile.present) return;
    mutationRef.current = false;
    setBusy(false);
    setPendingProfile(null);
  }, [connections, pendingProfile]);

  const removeConnection = async (connection: ChannelConnectionProfile) => {
    if (!environmentId || mutationRef.current) return;

    const confirmed =
      (await requestConfirmDialog(
        t("Delete {name}? Its saved credentials are removed from this environment.", {
          name: connection.name,
        }),
        { variant: "destructive", confirmLabel: t("Delete") },
      )) ?? false;

    if (!confirmed || mutationRef.current) return;
    mutationRef.current = true;
    setBusy(true);

    const result = await deleteConnection({
      environmentId,
      input: { connectionId: connection.id },
    });

    if (Predicate.isTagged(result, "Failure")) {
      mutationRef.current = false;
      setBusy(false);
      toast.error(t("Unassign this channel before deleting it"));

      return;
    }

    setPendingProfile({ id: connection.id, present: false });
  };

  /** Moves a connection to another bot, or to no bot. A new bot needs a live project. */
  const updateAssignment = async (
    connection: ChannelConnectionProfile,
    nextBotId: string,
    projectId: ProjectId | null,
  ) => {
    if (!environmentId || busyConnectionId) return;

    if (nextBotId !== UNASSIGNED && projectId === null) return;

    const { bot: assignedBot, binding: assignedBinding } = connectionAssignment(
      connection.id,
      bots,
    );

    if (assignedBot?.id === nextBotId) return;

    const destinationBinding = bots
      .find((bot) => bot.id === nextBotId)
      ?.channelBindings.find((binding) => binding.provider === connection.provider);

    // A detached binding keeps its provider row without a connection, so only a bound or
    // still-live legacy binding occupies the bot.
    const destinationOccupied =
      destinationBinding !== undefined &&
      (destinationBinding.connectionId
        ? destinationBinding.connectionId !== connection.id
        : destinationBinding.status !== "disconnected");

    if (destinationOccupied) {
      toast.error(t("Unassign the channel already connected to this bot first"));

      return;
    }

    setBusyConnectionId(connection.id);

    if (assignedBot) {
      const result = await detach({
        environmentId,
        input: { botId: assignedBot.id, provider: connection.provider },
      });

      if (Predicate.isTagged(result, "Failure")) {
        setBusyConnectionId(null);
        toast.error(t("Channel couldn't be unassigned"));

        return;
      }
    }

    if (nextBotId !== UNASSIGNED && projectId !== null) {
      const result = await attach({
        environmentId,
        input: {
          botId: BotId.make(nextBotId),
          connectionId: connection.id,
          provider: connection.provider,
          projectId,
        },
      });

      if (Predicate.isTagged(result, "Failure")) {
        // A failed attach keeps the new bot on the connection, so it has to let go before the
        // previous bot can have the connection back.
        // The previous project may be gone; restore into the chosen live project instead.
        const previousProjectId = assignedBinding?.projectId ?? null;

        const restoreProjectId =
          previousProjectId !== null &&
          liveProjects.some((project) => project.id === previousProjectId)
            ? previousProjectId
            : projectId;

        const released = assignedBot
          ? await detach({
              environmentId,
              input: { botId: BotId.make(nextBotId), provider: connection.provider },
            })
          : null;

        const restored = assignedBot
          ? await attach({
              environmentId,
              input: {
                botId: assignedBot.id,
                connectionId: connection.id,
                projectId: restoreProjectId,
                provider: connection.provider,
              },
            })
          : null;

        // Attaching starts the channel, so a binding the user had disconnected goes back to
        // disconnected rather than coming back online after a failed move.
        const stopped =
          assignedBot &&
          Predicate.isTagged(restored ?? {}, "Success") &&
          assignedBinding?.status === "disconnected"
            ? await disconnect({
                environmentId,
                input: { botId: assignedBot.id, provider: connection.provider },
              })
            : null;

        toast.error(
          failureTitle(
            result,
            Predicate.isTagged(released ?? {}, "Failure") ||
              Predicate.isTagged(restored ?? {}, "Failure") ||
              Predicate.isTagged(stopped ?? {}, "Failure")
              ? t("Channel couldn't be assigned or restored")
              : t("Channel couldn't be assigned"),
          ),
        );
      }
    }

    setBusyConnectionId(null);
  };

  const moveToProject = async (
    connection: ChannelConnectionProfile,
    botId: BotId,
    projectId: ProjectId,
  ) => {
    if (!environmentId || busyConnectionId) return;
    setBusyConnectionId(connection.id);

    const result = await changeProject({
      environmentId,
      input: { botId, provider: connection.provider, projectId },
    });

    setBusyConnectionId(null);

    if (Predicate.isTagged(result, "Failure")) {
      toast.error(failureTitle(result, t("Channel couldn't be moved to this project")));
    }
  };

  const runBindingCommand = async (
    command: typeof disconnect,
    connection: ChannelConnectionProfile,
    botId: BotId,
    title: string,
  ) => {
    if (!environmentId || busyConnectionId) return;
    setBusyConnectionId(connection.id);

    const result = await command({
      environmentId,
      input: { botId, provider: connection.provider },
    });

    setBusyConnectionId(null);

    if (Predicate.isTagged(result, "Failure")) {
      toast.error(failureTitle(result, title));
    }
  };

  return {
    access,
    bots,
    activeBots,
    liveProjects,
    connections,
    busy,
    busyConnectionId,
    /** The project a picker preselects for a bot, or for any bot when `botId` is null. */
    projectHint: (botId: BotId | null) =>
      snapshot ? defaultProjectIdForBot(snapshot, botId) : null,
    removeConnection,
    updateAssignment,
    moveToProject,
    disconnectConnection: (connection: ChannelConnectionProfile, botId: BotId) =>
      runBindingCommand(disconnect, connection, botId, t("Channel couldn't be disconnected")),
    reconnectConnection: (connection: ChannelConnectionProfile, botId: BotId) =>
      runBindingCommand(reconnect, connection, botId, t("Channel couldn't be reconnected")),
    /** Hold the page busy until a connection the setup dialog saved shows up. */
    awaitSavedConnection: (connectionId: string) =>
      setPendingProfile({ id: connectionId, present: true }),
  };
}

/** Why the channel pages cannot show connections yet, or null when they can. */
export function ChannelAccessRow({
  access,
}: {
  readonly access: ReturnType<typeof useChannelSettings>["access"];
}) {
  const { t } = useI18n();

  if (access === "no-environment") {
    return <SettingsMessageRow>{t("Connect an environment first.")}</SettingsMessageRow>;
  }

  if (access === "pending") {
    return (
      <SettingsMessageRow>
        <span className="inline-flex items-center gap-2">
          <Spinner aria-label={t("Loading channel access")} className="size-3.5" />
          {t("Checking access")}
        </span>
      </SettingsMessageRow>
    );
  }

  if (access === "denied") {
    return (
      <SettingsMessageRow>
        {t("This client does not have permission to manage channels.")}
      </SettingsMessageRow>
    );
  }

  return null;
}

/**
 * Otto: Channels are not part of the MVP. The page lists the services that are coming, each
 * with a Coming soon badge and nothing to open or connect.
 */
export function BotChannelsSettingsPanel() {
  const { t } = useI18n();

  return (
    <SettingsPageContainer>
      <SettingsSection id={searchableSetting("bot-channels").id} title={t("Channels")}>
        {CHANNEL_PROVIDER_META.map((meta) => (
          <div
            key={meta.provider}
            data-settings-row=""
            className="flex items-center gap-3 px-4 py-3"
          >
            <LogoTile>
              <meta.icon aria-hidden className="size-4" />
            </LogoTile>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-13px font-medium text-foreground">
                {meta.label}
              </span>
              <span className="block truncate text-xs text-muted-foreground">{meta.tagline}</span>
            </span>
            <Badge variant="quiet">{t("Coming soon")}</Badge>
          </div>
        ))}
      </SettingsSection>
    </SettingsPageContainer>
  );
}
