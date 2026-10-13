import { useAtomValue } from "@effect/atom-react";
import { ProviderInstanceId, type BotEngine } from "@otto/contracts";
import { useMemo, useState } from "react";

import { usePrimarySettings } from "../../hooks/useSettings";
import { useI18n } from "../../i18n";
import { getCustomModelOptionsByInstance } from "../../modelSelection";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { primaryServerProvidersAtom } from "../../state/server";
import { ProviderUnavailableNotice } from "../chat/ProviderUnavailableNotice";
import { TraitsPicker } from "../chat/TraitsPicker";
import { Button } from "../ui/button";
import { Dialog, DialogFooter, DialogPopup, DialogTitle } from "../ui/dialog";
import { BotAvatarPopover } from "./BotAvatarPopover";
import { BotModelPicker } from "./BotModelPicker";
import { botEngineForModelPick, botEngineForOptions } from "./botEngineSelection";
import { randomBotAvatar } from "./roster.logic";
import type { BotAvatar } from "./types";
import { useBotEngineAvailability } from "./useBotEngineAvailability";

export interface NewBotInput {
  readonly name: string;
  readonly avatar: BotAvatar;
  /** Null keeps the app's default model, which the bot follows when it changes. */
  readonly engine: BotEngine | null;
}

/**
 * Creates a bot from a name alone: the avatar starts random and the model on
 * the app default, both changeable here. Everything else lives in the bot's
 * settings, and the bot asks for context in its first message.
 */
export function NewBotDialog({
  open,
  onOpenChange,
  onCreate,
  /** Set while a create is in flight, so the form cannot be submitted twice. */
  submitting = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: NewBotInput) => void;
  submitting?: boolean;
}) {
  const { t } = useI18n();
  const environmentId = usePrimaryEnvironmentId();
  const settings = usePrimarySettings();
  const providers = useAtomValue(primaryServerProvidersAtom);
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState<BotAvatar>(() => randomBotAvatar());
  const [engine, setEngine] = useState<BotEngine | null>(null);
  // A bot that no provider can run is still created; it replies once one connects.
  const { instanceEntries, selection, blocked, unavailability } = useBotEngineAvailability(engine);
  const trimmedName = name.trim();
  const activeEntry = instanceEntries.find((entry) => entry.instanceId === selection?.instanceId);

  const modelOptionsByInstance = useMemo(
    () =>
      getCustomModelOptionsByInstance(
        settings,
        providers,
        selection ? ProviderInstanceId.make(selection.instanceId) : null,
        selection?.model ?? null,
      ),
    [providers, selection, settings],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-md" bottomStickOnMobile={false}>
        <form
          className="flex flex-col"
          onSubmit={(event) => {
            event.preventDefault();

            if (submitting || trimmedName.length === 0) return;
            onCreate({ name: trimmedName, avatar, engine });
          }}
        >
          <DialogTitle className="sr-only">{t("New bot")}</DialogTitle>
          <div className="flex flex-col items-start gap-3 px-5 pt-5 pb-4">
            <BotAvatarPopover value={avatar} name={trimmedName} onChange={setAvatar} />
            <input
              autoFocus
              required
              data-testid="new-bot-name-input"
              maxLength={80}
              aria-label={t("Bot name")}
              placeholder={t("Name your bot")}
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="w-full bg-transparent text-lg leading-7 font-medium tracking-title-sm text-foreground outline-none placeholder:text-muted-foreground/72"
            />
            <p className="text-sm text-muted-foreground">
              {t("It introduces itself and asks about your work.")}
            </p>
            {blocked && unavailability ? (
              <ProviderUnavailableNotice
                className="w-full"
                presentation={unavailability}
                provider={unavailability.provider}
                environmentId={environmentId}
              />
            ) : null}
          </div>

          <DialogFooter className="items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-0.5">
              {selection ? (
                <BotModelPicker
                  activeInstanceId={ProviderInstanceId.make(selection.instanceId)}
                  model={selection.model}
                  instanceEntries={instanceEntries}
                  modelOptionsByInstance={modelOptionsByInstance}
                  disabled={submitting}
                  onChange={(instanceId, model) =>
                    setEngine(
                      botEngineForModelPick({
                        previous: selection,
                        instanceId,
                        model,
                        instanceEntries,
                      }),
                    )
                  }
                />
              ) : null}
              {selection && activeEntry ? (
                <TraitsPicker
                  provider={activeEntry.driverKind}
                  instanceId={activeEntry.instanceId}
                  models={activeEntry.models}
                  model={selection.model}
                  prompt=""
                  onPromptChange={() => {}}
                  modelOptions={selection.options}
                  allowPromptInjectedEffort={false}
                  onModelOptionsChange={(options) =>
                    setEngine(botEngineForOptions({ selection, options, instanceEntries }))
                  }
                />
              ) : null}
            </div>
            <Button
              type="submit"
              variant="primary"
              disabled={submitting || trimmedName.length === 0}
            >
              {submitting ? t("Creating") : t("Create bot")}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
