import * as Config from "effect/Config";
import * as Option from "effect/Option";

/**
 * Server environment variables use `OTTO_` names. Each one still accepts its
 * older `OTTO_LEGACY_` name as a fallback alias, so existing shells, service units,
 * and scripts keep working. The `OTTO_` name wins when both are set.
 */
export const OTTO_ENV_PREFIX = "OTTO_";

export const LEGACY_ENV_PREFIX = "OTTO_LEGACY_";

/** Reads `OTTO_<suffix>`, falling back to `OTTO_LEGACY_<suffix>`. */
export function aliasedEnv<A>(
  read: (name: string) => Config.Config<A>,
  suffix: string,
): Config.Config<Option.Option<A>> {
  return Config.all([
    Config.option(read(`${OTTO_ENV_PREFIX}${suffix}`)),
    Config.option(read(`${LEGACY_ENV_PREFIX}${suffix}`)),
  ]).pipe(Config.map(([primary, legacy]) => Option.orElse(primary, () => legacy)));
}

/** Plain `process.env` lookup with the same precedence as {@link aliasedEnv}. */
export function readAliasedEnv(
  env: Readonly<Record<string, string | undefined>>,
  suffix: string,
): string | undefined {
  const primary = env[`${OTTO_ENV_PREFIX}${suffix}`]?.trim();

  if (primary) return primary;
  const legacy = env[`${LEGACY_ENV_PREFIX}${suffix}`]?.trim();

  return legacy || undefined;
}
