import type { RoutineThreadMode } from "@otto/contracts";
import {
  RiChat3Line,
  RiChatNewLine,
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

const MODES = ["target", "per-run", "single"] as const satisfies readonly RoutineThreadMode[];

const MODE_ICONS = {
  target: RiChat3Line,
  "per-run": RiWechatLine,
  single: RiChatNewLine,
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
      target: t("Same chat"),
      "per-run": t("New chat every run"),
      single: t("New single chat"),
    })[mode];
}

/**
 * Otto: Where a routine posts: Same chat (every run in the routine's own chat), New chat
 * every run, or New single chat (one new chat that every run posts in). A quiet select on
 * the routine page.
 */
export function RoutineChatSelect({
  value,
  onChange,
}: {
  readonly value: RoutineThreadMode;
  readonly onChange: (mode: RoutineThreadMode) => void;
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
          <SelectItem key={mode} hideIndicator value={mode}>
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
