import { PRODUCT_HOME_DIRNAME } from "@otto/shared/devHome";
import * as Option from "effect/Option";

export type JoinPath = (first: string, ...segments: string[]) => string;

function normalizeConfiguredBaseDir(ottoLegacyHome: Option.Option<string>): Option.Option<string> {
  if (Option.isNone(ottoLegacyHome)) {
    return Option.none();
  }

  const trimmed = ottoLegacyHome.value.trim();

  return trimmed.length > 0 ? Option.some(trimmed) : Option.none();
}

export function resolveDesktopBaseDir(input: {
  readonly homeDirectory: string;
  readonly joinPath: JoinPath;
  readonly ottoLegacyHome: Option.Option<string>;
}): string {
  return Option.getOrElse(normalizeConfiguredBaseDir(input.ottoLegacyHome), () =>
    input.joinPath(input.homeDirectory, PRODUCT_HOME_DIRNAME),
  );
}

export function resolveDesktopStateDir(input: {
  readonly baseDir: string;
  readonly isDevelopment: boolean;
  readonly joinPath: JoinPath;
  readonly ottoLegacyHome: Option.Option<string>;
}): string {
  const useDevSubdir =
    input.isDevelopment && Option.isNone(normalizeConfiguredBaseDir(input.ottoLegacyHome));

  return input.joinPath(input.baseDir, useDevSubdir ? "dev" : "userdata");
}
