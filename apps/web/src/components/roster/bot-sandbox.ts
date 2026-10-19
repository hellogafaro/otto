import { DEFAULT_LOCAL_EXECUTION_MODE, type RuntimeMode, type SandboxSize } from "@otto/contracts";
import { createTranslator } from "@otto/client-runtime/i18n";

import type { useI18n } from "../../i18n";
import type { Bot } from "./types";

type Translate = ReturnType<typeof useI18n>["t"];

const translateEnglish: Translate = createTranslator("en").translate;

export const DEFAULT_BOT_RUNTIME_MODE: RuntimeMode = DEFAULT_LOCAL_EXECUTION_MODE;

export const BOT_SANDBOX_OPTIONS = [
  { value: "local", label: "Local" },
  { value: "boat", label: "Boat" },
] as const;

export type BotSandboxChoice = (typeof BOT_SANDBOX_OPTIONS)[number]["value"] | "default";

export function botSandboxChoice(sandbox: Bot["sandbox"]): BotSandboxChoice {
  return sandbox ?? "default";
}

/** "Local" is interface copy; the cloud sandbox labels are product names and stay as written. */
export function botSandboxLabel(
  sandbox: BotSandboxChoice,
  t: Translate = translateEnglish,
): string {
  if (sandbox === "default") return t("Default sandbox");
  const option = BOT_SANDBOX_OPTIONS.find((candidate) => candidate.value === sandbox);

  return !option || option.value === "local" ? t("Local") : option.label;
}

export function sandboxSizeLabel(size: SandboxSize, t: Translate = translateEnglish): string {
  return size === "small" ? t("Small") : size === "medium" ? t("Medium") : t("Large");
}
