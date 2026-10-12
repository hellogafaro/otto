"use strict";

const path = require("path");

const fs = require("fs");

const { withDangerousMod, IOSConfig } = require("expo/config-plugins");

module.exports = function withRemixNativeIcons(config) {
  config = withDangerousMod(config, [
    "ios",
    (cfg) => {
      const catalog = path.join(
        IOSConfig.Paths.getSourceRoot(cfg.modRequest.projectRoot),
        "Images.xcassets",
      );

      const source = path.join(cfg.modRequest.projectRoot, "assets/native-icons");

      for (const filename of fs.readdirSync(source)) {
        if (!filename.endsWith(".png")) continue;

        const name = path
          .basename(filename, ".png")
          .replace(/^Remix/, "remix_")
          .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
          .toLowerCase();

        const imageSet = path.join(catalog, `${name}.imageset`);
        fs.mkdirSync(imageSet, { recursive: true });
        fs.copyFileSync(path.join(source, filename), path.join(imageSet, filename));
        fs.writeFileSync(
          path.join(imageSet, "Contents.json"),
          JSON.stringify({
            images: [{ idiom: "universal", filename, scale: "1x" }],
            info: { author: "expo", version: 1 },
            properties: { "template-rendering-intent": "template" },
          }) + "\n",
        );
      }

      return cfg;
    },
  ]);

  return withDangerousMod(config, [
    "android",
    (cfg) => {
      const source = path.join(cfg.modRequest.projectRoot, "assets/native-icons");
      const output = path.join(cfg.modRequest.platformProjectRoot, "app/src/main/res/drawable");
      fs.mkdirSync(output, { recursive: true });

      for (const filename of fs.readdirSync(source)) {
        if (!filename.endsWith(".png")) continue;

        const name = path
          .basename(filename, ".png")
          .replace(/^Remix/, "remix_")
          .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
          .toLowerCase();

        fs.copyFileSync(path.join(source, filename), path.join(output, `${name}.png`));
      }

      return cfg;
    },
  ]);
};
