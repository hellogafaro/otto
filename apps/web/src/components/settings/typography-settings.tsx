import { Predicate } from "effect";
import {
  DEFAULT_UNIFIED_SETTINGS,
  MAX_CODE_FONT_SIZE,
  MAX_INTERFACE_FONT_SIZE,
  MIN_CODE_FONT_SIZE,
  MIN_INTERFACE_FONT_SIZE,
} from "@otto/contracts/settings";
import { usePrimarySettings, useUpdatePrimarySettings } from "../../hooks/use-settings";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingResetButton, SettingsRow } from "./settings-layout";
import { searchableSetting } from "./settings-search";
import { useI18n } from "../../i18n";

/** Otto: The font pairing is fixed (Inter and Geist Mono); only the sizes change. */
export function TypographyRows() {
  const { t } = useI18n();
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();

  return (
    <>
      <FontSizeRow
        {...searchableSetting("interface-font-size", t)}
        description={t("Everything outside code blocks and the terminal.")}
        min={MIN_INTERFACE_FONT_SIZE}
        max={MAX_INTERFACE_FONT_SIZE}
        value={settings.fontSizeInterface}
        defaultValue={DEFAULT_UNIFIED_SETTINGS.fontSizeInterface}
        onChange={(fontSizeInterface) => updateSettings({ fontSizeInterface })}
      />
      <FontSizeRow
        {...searchableSetting("code-font-size", t)}
        description={t("Code blocks, diffs, file previews, and the terminal.")}
        min={MIN_CODE_FONT_SIZE}
        max={MAX_CODE_FONT_SIZE}
        value={settings.fontSizeCode}
        defaultValue={DEFAULT_UNIFIED_SETTINGS.fontSizeCode}
        onChange={(fontSizeCode) => updateSettings({ fontSizeCode })}
      />
    </>
  );
}

function FontSizeRow({
  id,
  title,
  description,
  min,
  max,
  value,
  defaultValue,
  onChange,
}: {
  id: string;
  title: string;
  description: string;
  min: number;
  max: number;
  value: number;
  defaultValue: number;
  onChange: (value: number) => void;
}) {
  return (
    <SettingsRow
      id={id}
      title={title}
      description={description}
      resetAction={
        value !== defaultValue ? (
          <SettingResetButton label={title.toLowerCase()} onClick={() => onChange(defaultValue)} />
        ) : null
      }
      control={
        <Select
          value={String(value)}
          onValueChange={(next) => {
            if (!Predicate.isString(next)) return;
            const parsed = Number(next);

            if (Number.isInteger(parsed) && parsed >= min && parsed <= max) onChange(parsed);
          }}
        >
          <SelectTrigger className="w-22 shrink-0" aria-label={title}>
            <SelectValue>{value} px</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {Array.from({ length: max - min + 1 }, (_, index) => min + index).map((px) => (
              <SelectItem hideIndicator key={px} value={String(px)}>
                {px} px
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}
