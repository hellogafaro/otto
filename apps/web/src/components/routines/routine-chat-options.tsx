import type { RoutineThreadMode } from "@otto/contracts";
import {
  RiChat3Line,
  RiChatHistoryLine,
  RiWechatLine,
  type RemixiconComponentType,
} from "@remixicon/react";

import { useI18n } from "../../i18n";
import {
  ComposerControl,
  ComposerControlChevron,
  ComposerControlIcon,
} from "../chat/composer-control";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

const MODES = ["target", "single", "per-run"] as const satisfies readonly RoutineThreadMode[];

const MODE_ICONS = {
  target: RiChatHistoryLine,
  single: RiChat3Line,
  "per-run": RiWechatLine,
} as const satisfies Record<RoutineThreadMode, RemixiconComponentType>;

const modeIcon = (mode: RoutineThreadMode) => MODE_ICONS[mode];

function ModeIcon({ mode }: { readonly mode: RoutineThreadMode }) {
  const Icon = modeIcon(mode);

  return <Icon aria-hidden className="size-3.5" />;
}

function useModeLabel() {
  const { t } = useI18n();

  return (mode: RoutineThreadMode) =>
    ({
      target: t("Original chat"),
      "per-run": t("New chat every run"),
      single: t("One new chat"),
    })[mode];
}

/**
 * Otto: Where a routine posts: Original chat (the chat it was set up in), One new chat
 * (made on the first run, then reused) or New chat every run. A quiet select on
 * the routine page.
 */
export function RoutineChatSelect({
  value,
  onChange,
  originalChatAvailable,
}: {
  readonly value: RoutineThreadMode;
  readonly onChange: (mode: RoutineThreadMode) => void;
  /** False when the routine's chat is a group chat or gone, so it cannot post there. */
  readonly originalChatAvailable: boolean;
}) {
  const { t } = useI18n();
  const label = useModeLabel();

  return (
    <Select
      value={value}
      onValueChange={(next) => {
        const mode = MODES.find((candidate) => candidate === next);

        if (mode) onChange(mode);
      }}
    >
      <SelectTrigger size="sm" variant="ghost" className="w-auto min-w-0" aria-label={t("Chat")}>
        <SelectValue>
          <span className="flex items-center gap-1.5">
            <ModeIcon mode={value} />
            {label(value)}
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectPopup alignItemWithTrigger={false}>
        {MODES.map((mode) => (
          <SelectItem
            key={mode}
            hideIndicator
            value={mode}
            disabled={mode === "target" && !originalChatAvailable}
          >
            <span className="flex items-center gap-2">
              <ModeIcon mode={mode} />
              {label(mode)}
            </span>
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

/** The same choice as a composer control in New routine. */
export function RoutineChatControl({
  value,
  onChange,
}: {
  readonly value: RoutineThreadMode;
  readonly onChange: (mode: RoutineThreadMode) => void;
}) {
  const { t } = useI18n();
  const label = useModeLabel();

  return (
    <Menu>
      <MenuTrigger render={<ComposerControl aria-label={t("Chat")} className="max-w-52 min-w-0" />}>
        <ComposerControlIcon icon={modeIcon(value)} />
        <span className="min-w-0 truncate">{label(value)}</span>
        <ComposerControlChevron />
      </MenuTrigger>
      <MenuPopup align="start">
        <MenuRadioGroup value={value} onValueChange={(next: RoutineThreadMode) => onChange(next)}>
          {MODES.map((mode) => (
            <MenuRadioItem key={mode} value={mode} closeOnClick>
              <span className="flex items-center gap-2">
                <ComposerControlIcon icon={modeIcon(mode)} />
                {label(mode)}
              </span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}
