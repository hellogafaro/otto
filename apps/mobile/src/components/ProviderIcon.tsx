import ClaudeFill from "react-native-remix-icon/src/icons/ClaudeFill";
import OpenaiFill from "react-native-remix-icon/src/icons/OpenaiFill";
import BrainLine from "react-native-remix-icon/src/icons/BrainLine";
import SparklingFill from "react-native-remix-icon/src/icons/SparklingFill";
import BracesLine from "react-native-remix-icon/src/icons/BracesLine";
import CodeBoxLine from "react-native-remix-icon/src/icons/CodeBoxLine";
import Robot2Line from "react-native-remix-icon/src/icons/Robot2Line";
import { useAppearancePreferences } from "../features/settings/appearance/AppearancePreferencesProvider";

type ProviderIconProps = {
  readonly provider: string | null | undefined;
  readonly size?: number;
};

const PROVIDER_ICONS = new Map([
  ["claudeAgent", ClaudeFill],
  ["codex", OpenaiFill],
  ["grok", SparklingFill],
  ["kimi", BrainLine],
  ["customOpenai", BracesLine],
  ["opencode", CodeBoxLine],
  ["opencodeGo", CodeBoxLine],
]);

export function ProviderIcon({ provider, size = 16 }: ProviderIconProps) {
  const { themeAppearance } = useAppearancePreferences();
  const Icon = PROVIDER_ICONS.get(provider ?? "") ?? Robot2Line;

  const fill =
    provider === "claudeAgent" ? "#D97757" : themeAppearance === "dark" ? "#e5e5e5" : "#171717";

  return <Icon width={size} height={size} fill={fill} accessible={false} />;
}
