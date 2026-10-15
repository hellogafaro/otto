import { RiFlashlightLine } from "@remixicon/react";

import { memo, useState } from "react";
import { useI18n } from "~/i18n";
import { cn } from "~/lib/utils";
import { Menu, MenuPopup, MenuTrigger } from "../ui/menu";
import { ComposerControl, ComposerControlChevron, ComposerControlIcon } from "./composer-control";
import { type TraitsMenuContentProps, TraitsMenuContent } from "./traits-menu-content";
import {
  type TraitsPersistence,
  buildTraitsTriggerDisplay,
  getTraitsSectionVisibility,
  shouldRenderTraitsControls,
} from "./traits-picker.logic";

export const TraitsPicker = memo(function TraitsPicker({
  provider,
  instanceId,
  models,
  model,
  prompt,
  onPromptChange,
  modelOptions,
  allowPromptInjectedEffort = true,
  triggerVariant,
  triggerFit,
  ...persistence
}: TraitsMenuContentProps & TraitsPersistence) {
  const { t } = useI18n();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const { descriptors, primarySelectDescriptor, ultrathinkPromptControlled } =
    getTraitsSectionVisibility({
      provider,
      models,
      model,
      prompt,
      modelOptions,
      allowPromptInjectedEffort,
    });

  if (
    !shouldRenderTraitsControls({
      provider,
      models,
      model,
      prompt,
      modelOptions,
      allowPromptInjectedEffort,
    })
  ) {
    return null;
  }

  const { label: triggerLabel, showFastModeIcon } = buildTraitsTriggerDisplay({
    provider,
    descriptors,
    primarySelectDescriptorId: primarySelectDescriptor?.id ?? null,
    ultrathinkPromptControlled,
    t,
  });

  const fastModeIcon = showFastModeIcon ? (
    <>
      <ComposerControlIcon
        icon={RiFlashlightLine}
        className={cn(
          "fill-current opacity-80",
          provider === "claudeAgent" ? "text-brand-claude" : "text-foreground",
        )}
      />
      <span className="sr-only">{t("Fast mode on")}</span>
    </>
  ) : null;

  const isCodexStyle = provider === "codex";

  return (
    <Menu
      open={isMenuOpen}
      onOpenChange={(open) => {
        setIsMenuOpen(open);
      }}
    >
      <MenuTrigger
        render={
          <ComposerControl
            variant={triggerVariant ?? "ghost"}
            presentation={
              triggerFit === "settings-row" ? "composer-control-settings-row" : undefined
            }
            className={cn(
              isCodexStyle
                ? "min-w-0 max-w-40 shrink justify-start overflow-hidden whitespace-nowrap sm:max-w-48"
                : "shrink-0 whitespace-nowrap",
              triggerFit === "settings-row" && "min-w-0 max-w-none shrink-0",
            )}
          />
        }
      >
        {isCodexStyle ? (
          <span className="flex min-w-0 w-full items-center gap-1.5 overflow-hidden">
            {fastModeIcon}
            <span className="min-w-0 truncate">{triggerLabel}</span>
            <ComposerControlChevron />
          </span>
        ) : (
          <>
            {fastModeIcon}
            <span>{triggerLabel}</span>
            <ComposerControlChevron />
          </>
        )}
      </MenuTrigger>
      <MenuPopup align="start">
        <TraitsMenuContent
          provider={provider}
          {...(instanceId ? { instanceId } : {})}
          models={models}
          model={model}
          prompt={prompt}
          onPromptChange={onPromptChange}
          modelOptions={modelOptions}
          allowPromptInjectedEffort={allowPromptInjectedEffort}
          {...persistence}
        />
      </MenuPopup>
    </Menu>
  );
});

export { TraitsMenuContent, type TraitsMenuContentProps } from "./traits-menu-content";

export { buildTraitsTriggerDisplay, shouldRenderTraitsControls } from "./traits-picker.logic";
