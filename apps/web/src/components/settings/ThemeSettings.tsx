import { RiComputerLine, RiMoonLine, RiSunLine } from "@remixicon/react";
import { useI18n } from "../../i18n";
import { useTheme } from "../../hooks/useTheme";
import { Button } from "../ui/button";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { SettingsSection } from "./settingsLayout";

const modes = [
  { mode: "system", title: "System", icon: RiComputerLine },
  { mode: "light", title: "Light", icon: RiSunLine },
  { mode: "dark", title: "Dark", icon: RiMoonLine },
] as const;

export function ColorSchemeSettings() {
  const { appearanceMode, setAppearanceMode } = useTheme();
  const { t } = useI18n();

  return (
    <SettingsSection id="appearance" title={t("Color scheme")}>
      <div aria-label={t("Color scheme")} className="grid grid-cols-3 gap-2" role="group">
        {modes.map(({ mode, title, icon: Icon }) => (
          <Button
            aria-label={t(title)}
            aria-pressed={appearanceMode === mode}
            key={mode}
            onClick={() => {
              if (!setAppearanceMode(mode)) {
                toastManager.add(
                  stackedThreadToast({
                    type: "error",
                    title: t("Could not save preferences. Try again."),
                  }),
                );
              }
            }}
            variant={appearanceMode === mode ? "segment-selected" : "segment"}
          >
            <Icon className="size-4" />
            {t(title)}
          </Button>
        ))}
      </div>
    </SettingsSection>
  );
}
