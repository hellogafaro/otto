import { RiComputerLine, RiMoonLine, RiSunLine } from "@remixicon/react";
import { useI18n } from "../../i18n";
import { useTheme } from "../../hooks/use-theme";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { toast } from "sonner";
import { SettingsRow } from "./settings-layout";

const modes = [
  { mode: "system", title: "System", icon: RiComputerLine },
  { mode: "light", title: "Light", icon: RiSunLine },
  { mode: "dark", title: "Dark", icon: RiMoonLine },
] as const;

export function ColorSchemeSettings() {
  const { appearanceMode, setAppearanceMode } = useTheme();
  const { t } = useI18n();

  return (
    <SettingsRow
      id="appearance"
      title={t("Color scheme")}
      control={
        <ToggleGroup
          aria-label={t("Color scheme")}
          variant="segmented"
          value={[appearanceMode]}
          onValueChange={(next) => {
            const mode = modes.find((option) => option.mode === next[0])?.mode;

            if (mode && !setAppearanceMode(mode)) {
              toast.error(t("Preferences couldn't be saved"));
            }
          }}
        >
          {modes.map(({ mode, title, icon: Icon }) => (
            <Toggle key={mode} value={mode} aria-label={t(title)}>
              <Icon className="size-3.5" />
              {t(title)}
            </Toggle>
          ))}
        </ToggleGroup>
      }
    />
  );
}
