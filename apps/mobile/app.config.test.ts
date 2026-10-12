import * as NodeChildProcess from "node:child_process";
import { expect, it } from "vite-plus/test";

const configUrl = new URL("./app.config.ts", import.meta.url).href;

it.each([
  ["development", "Otto Dev", ["otto-dev", "otto"], "studio.hellogafaro.otto.dev"],
  ["production", "Otto", ["otto"], "studio.hellogafaro.otto"],
  ["", "Otto", ["otto"], "studio.hellogafaro.otto"],
  ["preview", "Otto", ["otto"], "studio.hellogafaro.otto"],
  [" development ", "Otto", ["otto"], "studio.hellogafaro.otto"],
])(
  "resolves APP_VARIANT=%j without changing app identity",
  (appVariant, name, scheme, identifier) => {
    const output = NodeChildProcess.execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `import config from ${JSON.stringify(configUrl)};
process.stdout.write(JSON.stringify({
  name: config.name,
  scheme: config.scheme,
  iosBundleIdentifier: config.ios.bundleIdentifier,
  androidPackage: config.android.package,
  appVariant: config.extra.appVariant,
}));`,
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          APP_VARIANT: appVariant,
          OTTO_LEGACY_IOS_PERSONAL_TEAM: "",
          OTTO_LEGACY_IOS_PERSONAL_TEAM_BUNDLE_ID: "",
          OTTO_APPLE_TEAM_ID: "",
          OTTO_EXPO_PROJECT_ID: "",
          OTTO_EXPO_OWNER: "",
        },
      },
    );

    expect(output).toBe(
      JSON.stringify({
        name,
        scheme,
        iosBundleIdentifier: identifier,
        androidPackage: identifier,
        appVariant: appVariant === "development" ? "development" : "production",
      }),
    );
  },
);
