import { useAtomValue } from "@effect/atom-react";
import {
  AuthSessionId,
  BotId,
  type EnvironmentId,
  GroupId,
  type Visibility,
  type WorkParticipant,
  workParticipantKey,
} from "@otto/contracts";
import { Predicate } from "effect";
import { useState } from "react";

import { useI18n } from "../../i18n";
import { randomUUID } from "../../lib/utils";
import { botEnvironment } from "../../state/bots";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { environmentSnapshotAtom } from "../../state/shell";
import { useAtomCommand } from "../../state/use-atom-command";
import { PromptDialog } from "../prompt-dialog";
import { toastManager } from "../ui/toast";
import { AssigneesMenu, useWorkParticipants } from "../work/work-participants";
import { useStartChat } from "./chat-navigation";
import { ProjectComposerControl, useProjectChoice } from "./project-composer-control";
import { VisibilityComposerControl } from "./visibility-composer-control";
import { type NewChatPreset, useRosterStore } from "./roster-store";
import { threadTitle } from "./thread-runtime-attachments";

// SAFETY: the empty ID is an inactive-query sentinel; no environment request is sent for it.
const NO_ENVIRONMENT = "" as EnvironmentId;

/** Mounts New chat while the roster store asks for it. */
export function NewChatDialogHost() {
  const preset = useRosterStore((state) => state.newChat);

  if (preset === null) return null;

  return <NewChatDialog preset={preset} />;
}

/**
 * Otto: Every chat starts here, in the routine composer: an optional title, the prompt,
 * its members and its project, "No project" (the home project) by default. One bot makes a DM; anyone more makes a group, even
 * the same people again, and a group of people only is fine. A blank title is the first
 * message's, as for any chat.
 */
function NewChatDialog({ preset }: { readonly preset: NewChatPreset }) {
  const { t } = useI18n();
  const startChat = useStartChat();
  const environmentId = usePrimaryEnvironmentId();
  const snapshot = useAtomValue(environmentSnapshotAtom(environmentId ?? NO_ENVIRONMENT));
  const participants = useWorkParticipants(snapshot ?? null);
  const selectedBotId = useRosterStore((state) => state.selectedBotId);
  const createGroup = useAtomCommand(botEnvironment.groups.create, { reportFailure: false });
  const [title, setTitle] = useState("");
  const [chosenMembers, setChosenMembers] = useState<WorkParticipant[] | null>(null);
  const projectChoice = useProjectChoice(preset.projectId);
  const { project } = projectChoice;
  const [submitting, setSubmitting] = useState(false);
  const [visibility, setVisibility] = useState<Visibility>("user");
  const close = () => useRosterStore.getState().openNewChat(null);

  // You are always in your own chats, so the picker offers everyone else.
  const others = {
    ...participants,
    people: participants.people.filter((person) => person.personId !== snapshot?.currentPersonId),
  };

  const everyone: WorkParticipant[] = [
    ...others.people,
    ...others.bots.map((bot): WorkParticipant => ({ kind: "bot", botId: BotId.make(bot.id) })),
  ];

  const presetMembers = everyone.filter((member) =>
    preset.memberKeys?.includes(workParticipantKey(member)),
  );

  const lastBot = others.bots.find((bot) => bot.id === selectedBotId) ?? others.bots[0];

  const members =
    chosenMembers ??
    (presetMembers.length > 0
      ? presetMembers
      : lastBot
        ? [{ kind: "bot" as const, botId: BotId.make(lastBot.id) }]
        : []);

  // Otto: A DM's creator picks who sees it; a group chat is seen by its members.
  const isDirect = members.length === 1 && members[0]?.kind === "bot";

  const submit = async (prompt: string) => {
    const bots = members.flatMap((member) => (member.kind === "bot" ? [member.botId] : []));
    const people = members.flatMap((member) => (member.kind === "person" ? [member] : []));
    const named = title.trim();

    const options = {
      prompt,
      visibility,
      ...(project ? { projectId: project.id } : {}),
      ...(named ? { title: named } : {}),
    };

    const [onlyBot] = bots;
    setSubmitting(true);

    try {
      if (bots.length === 1 && people.length === 0 && onlyBot) {
        if ((await startChat({ kind: "bot", id: onlyBot }, options)) !== null) close();

        return;
      }

      if (environmentId === null) {
        toastManager.add({ type: "error", title: t("Connect an environment first") });

        return;
      }

      const groupId = GroupId.make(`group-${randomUUID()}`);
      const [bossBotId, ...specialistBotIds] = bots;

      const result = await createGroup({
        environmentId,
        input: {
          groupId,
          name: named || threadTitle(prompt, []),
          ...(bossBotId ? { bossBotId } : {}),
          specialistBotIds,
          ...(people.length > 0
            ? {
                people: people.map((person) => ({
                  kind: "person" as const,
                  personId: AuthSessionId.make(person.personId),
                  displayName: person.displayName,
                })),
              }
            : {}),
        },
      });

      if (Predicate.isTagged(result, "Failure")) {
        toastManager.add({ type: "error", title: t("Could not start the chat") });

        return;
      }

      if ((await startChat({ kind: "group", id: groupId }, options)) !== null) close();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PromptDialog
      open
      onOpenChange={(open) => {
        if (!open && !submitting) close();
      }}
      title={t("New chat")}
      titleInput={{ value: title, onChange: setTitle, label: t("Chat title") }}
      placeholder={t("What do you want to work on?")}
      pickers={
        <>
          <AssigneesMenu
            variant="composer"
            label={t("Members")}
            value={members}
            onChange={setChosenMembers}
            participants={others}
          />
          <ProjectComposerControl choice={projectChoice} />
          {isDirect ? (
            <VisibilityComposerControl value={visibility} onChange={setVisibility} />
          ) : null}
        </>
      }
      submitLabel={t("Start")}
      canSubmit={members.length > 0 && project !== null && !submitting}
      onSubmit={(prompt) => void submit(prompt)}
    />
  );
}
