import { Pressable, View } from "react-native";
import { SymbolView } from "../../../../components/AppSymbol";
import { AppText as Text } from "../../../../components/AppText";
import { useMobileI18n } from "../../../../lib/i18n";
import { useThemeColor } from "../../../../lib/useThemeColor";
import { useAppearancePreferences } from "../AppearancePreferencesProvider";

const modes = [
  { mode: "system", title: "System", symbol: "desktopcomputer" },
  { mode: "light", title: "Light", symbol: "sun.max" },
  { mode: "dark", title: "Dark", symbol: "moon" },
] as const;

export function ThemeAppearanceSection() {
  const { t } = useMobileI18n();
  const { isReady, themeMode, setThemeMode } = useAppearancePreferences();
  const foreground = useThemeColor("--color-foreground");

  return (
    <View className="gap-2">
      <Text className="text-sm text-foreground-muted">{t("Color scheme")}</Text>
      <View accessibilityRole="radiogroup" className="flex-row gap-2">
        {modes.map(({ mode, title, symbol }) => (
          <Pressable
            accessibilityLabel={t(title)}
            accessibilityRole="radio"
            accessibilityState={{ checked: themeMode === mode, disabled: !isReady }}
            className={
              themeMode === mode
                ? "flex-1 items-center gap-2 rounded-xl border border-foreground bg-card p-4"
                : "flex-1 items-center gap-2 rounded-xl border border-border bg-card p-4"
            }
            disabled={!isReady}
            key={mode}
            onPress={() => setThemeMode(mode)}
          >
            <SymbolView name={{ ios: symbol }} size={20} tintColor={foreground} />
            <Text className="text-sm text-foreground">{t(title)}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
