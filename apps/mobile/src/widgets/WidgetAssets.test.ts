import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeVM from "node:vm";
import { describe, expect, it } from "vite-plus/test";
import { NATIVE_ICON_ASSETS } from "../native/nativeIconAssets.generated";

interface WidgetConfig {
  modRequest: { projectRoot: string; platformProjectRoot: string };
}

type WidgetMod = (config: WidgetConfig) => WidgetConfig;

interface WidgetModule {
  exports?: WidgetMod;
}

describe("Remix widget assets", () => {
  it("installs native toolbar and menu resources with matching names on both platforms", () => {
    const root = NodePath.resolve(
      NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
      "../..",
    );

    const pluginPath = NodePath.join(root, "plugins/withRemixNativeIcons.cjs");
    const require = NodeModule.createRequire(pluginPath);
    const temporary = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "otto-native-icons-"));
    const mods = new Map<string, WidgetMod>();
    const module: WidgetModule = {};

    NodeVM.runInNewContext(NodeFS.readFileSync(pluginPath, "utf8"), {
      module,
      require: (name: string) =>
        name === "expo/config-plugins"
          ? {
              withDangerousMod: (config: WidgetConfig, [platform, action]: [string, WidgetMod]) => {
                mods.set(platform, action);

                return config;
              },
              IOSConfig: { Paths: { getSourceRoot: () => NodePath.join(temporary, "ios/Otto") } },
            }
          : require(name),
    });

    try {
      const config = { modRequest: { projectRoot: root, platformProjectRoot: temporary } };
      module.exports?.(config);
      expect([...mods.keys()]).toEqual(["ios", "android"]);
      mods.get("ios")?.(config);
      mods.get("android")?.(config);

      for (const icon of Object.values(NATIVE_ICON_ASSETS)) {
        const imageSet = NodePath.join(
          temporary,
          "ios/Otto/Images.xcassets",
          `${icon.imageName}.imageset`,
        );

        const contents = JSON.parse(
          NodeFS.readFileSync(NodePath.join(imageSet, "Contents.json"), "utf8"),
        );

        expect(icon.source.uri).toBe(icon.imageName);
        expect(contents.properties["template-rendering-intent"]).toBe("template");

        const drawable = NodePath.join(
          temporary,
          "app/src/main/res/drawable",
          `${icon.imageName}.png`,
        );

        expect(NodeFS.readFileSync(drawable)).toEqual(
          NodeFS.readFileSync(NodePath.join(imageSet, contents.images[0].filename)),
        );
      }
    } finally {
      NodeFS.rmSync(temporary, { recursive: true, force: true });
    }
  });

  it("copies every generated icon into a template image set without replacing Otto artwork", () => {
    const root = NodePath.resolve(
      NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
      "../..",
    );

    const pluginPath = NodePath.join(root, "plugins/withWidgetLogoAsset.cjs");
    const require = NodeModule.createRequire(pluginPath);
    const temporary = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "otto-widget-assets-"));
    let writeAssets: WidgetMod | undefined;
    const module: WidgetModule = {};

    NodeVM.runInNewContext(NodeFS.readFileSync(pluginPath, "utf8"), {
      module,
      require: (name: string) =>
        name === "expo/config-plugins"
          ? {
              withDangerousMod: (config: WidgetConfig, [, action]: [string, WidgetMod]) => {
                writeAssets = action;

                return config;
              },
              withXcodeProject: (config: WidgetConfig) => config,
            }
          : require(name),
    });

    try {
      const config = { modRequest: { projectRoot: root, platformProjectRoot: temporary } };
      expect(module.exports).toBeTypeOf("function");
      module.exports?.(config);
      expect(writeAssets).toBeTypeOf("function");
      writeAssets?.(config);
      const catalog = NodePath.join(temporary, "ExpoWidgetsTarget/Assets.xcassets");
      const icons = NodeFS.readdirSync(NodePath.join(root, "assets/widget-icons"));
      expect(icons).toHaveLength(7);

      for (const filename of icons) {
        const imageSet = NodePath.join(catalog, `${NodePath.basename(filename, ".png")}.imageset`);

        const contents = JSON.parse(
          NodeFS.readFileSync(NodePath.join(imageSet, "Contents.json"), "utf8"),
        );

        expect(contents.properties["template-rendering-intent"]).toBe("template");
        expect(contents.images).toEqual([{ idiom: "universal", filename, scale: "1x" }]);
        expect(NodeFS.readFileSync(NodePath.join(imageSet, filename))).toEqual(
          NodeFS.readFileSync(NodePath.join(root, "assets/widget-icons", filename)),
        );
      }

      expect(NodeFS.readFileSync(NodePath.join(catalog, "OttoIcon.imageset/OttoIcon.png"))).toEqual(
        NodeFS.readFileSync(NodePath.resolve(root, "../../assets/prod/otto-app-1024.png")),
      );
    } finally {
      NodeFS.rmSync(temporary, { recursive: true, force: true });
    }
  });
});
