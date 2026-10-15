import * as Config from "effect/Config";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Option from "effect/Option";

const trimNonEmptyOption = (value: string): Option.Option<string> => {
  const trimmed = value.trim();

  return trimmed.length > 0 ? Option.some(trimmed) : Option.none();
};

const trimmedString = (name: string) =>
  Config.string(name).pipe(Config.option, Config.map(Option.flatMap(trimNonEmptyOption)));

/**
 * Variables shared with the server read `OTTO_<suffix>` first and fall back
 * to the legacy `OTTO_LEGACY_<suffix>` name, matching the server's own aliases.
 */
const aliasedTrimmedString = (suffix: string) =>
  Config.all([trimmedString(`OTTO_${suffix}`), trimmedString(`OTTO_LEGACY_${suffix}`)]).pipe(
    Config.map(([primary, legacy]) => Option.orElse(primary, () => legacy)),
  );

const aliasedOption = <A>(read: (name: string) => Config.Config<A>, suffix: string) =>
  Config.all([
    Config.option(read(`OTTO_${suffix}`)),
    Config.option(read(`OTTO_LEGACY_${suffix}`)),
  ]).pipe(Config.map(([primary, legacy]) => Option.orElse(primary, () => legacy)));

const optionalBoolean = (name: string) =>
  Config.boolean(name).pipe(Config.option, Config.map(Option.getOrElse(() => false)));

const commaSeparatedStrings = (name: string) =>
  trimmedString(name).pipe(
    Config.map(
      Option.match({
        onNone: () => [],
        onSome: (value) =>
          value
            .split(",")
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0),
      }),
    ),
  );

const compactEnv = (env: Readonly<Record<string, string | undefined>>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );

export const DesktopConfig = Config.all({
  appDataDirectory: trimmedString("APPDATA"),
  xdgConfigHome: trimmedString("XDG_CONFIG_HOME"),
  xdgDataHome: trimmedString("XDG_DATA_HOME"),
  ottoLegacyHome: aliasedTrimmedString("HOME"),
  devServerUrl: Config.url("VITE_DEV_SERVER_URL").pipe(Config.option),
  appUserModelIdOverride: trimmedString("OTTO_LEGACY_DESKTOP_APP_USER_MODEL_ID"),
  devRemoteOttoLegacyServerEntryPath: trimmedString(
    "OTTO_LEGACY_DEV_REMOTE_OTTO_LEGACY_SERVER_ENTRY_PATH",
  ),
  configuredBackendPort: aliasedOption(Config.port, "PORT"),
  commitHashOverride: trimmedString("OTTO_LEGACY_COMMIT_HASH"),
  desktopLanHostOverride: trimmedString("OTTO_LEGACY_DESKTOP_LAN_HOST"),
  desktopHttpsEndpointUrls: commaSeparatedStrings("OTTO_LEGACY_DESKTOP_HTTPS_ENDPOINTS"),
  otlpTracesUrl: aliasedTrimmedString("OTLP_TRACES_URL"),
  otlpExportIntervalMs: aliasedOption(Config.int, "OTLP_EXPORT_INTERVAL_MS").pipe(
    Config.map(Option.getOrElse(() => 10_000)),
  ),
  appImagePath: trimmedString("APPIMAGE"),
  disableAutoUpdate: optionalBoolean("OTTO_LEGACY_DISABLE_AUTO_UPDATE"),
  mockUpdates: optionalBoolean("OTTO_LEGACY_DESKTOP_MOCK_UPDATES"),
  mockUpdateServerPort: Config.port("OTTO_LEGACY_DESKTOP_MOCK_UPDATE_SERVER_PORT").pipe(
    Config.withDefault(3000),
  ),
});

export const layerTest = (env: Readonly<Record<string, string | undefined>>) =>
  ConfigProvider.layer(ConfigProvider.fromEnv({ env: compactEnv(env) }));
