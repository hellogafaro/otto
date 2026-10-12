import * as NodeModule from "node:module";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const mobileDirectory = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "..",
);

const require = NodeModule.createRequire(NodePath.resolve(mobileDirectory, "../web/package.json"));

const icons = require("@remixicon/react");

const { createElement } = require("react");

const { renderToStaticMarkup } = require("react-dom/server");

const output = NodePath.resolve(mobileDirectory, "assets/widget-icons");

const mapping = {
  RemixApproval: "RiErrorWarningFill",
  RemixInput: "RiQuestionFill",
  RemixFailed: "RiCloseCircleFill",
  RemixCompleted: "RiCheckboxCircleFill",
  RemixStarting: "RiLoader4Line",
  RemixStale: "RiHistoryLine",
  RemixRunning: "RiLoopRightLine",
};

NodeFS.mkdirSync(output, { recursive: true });

for (const [name, icon] of Object.entries(mapping)) {
  const svgPath = NodePath.resolve(output, `${name}.svg`);
  NodeFS.writeFileSync(
    svgPath,
    renderToStaticMarkup(createElement(icons[icon], { size: 64, color: "#000" })),
  );

  try {
    NodeChildProcess.execFileSync(
      "sips",
      ["-s", "format", "png", svgPath, "--out", NodePath.resolve(output, `${name}.png`)],
      {
        stdio: "ignore",
      },
    );
  } finally {
    NodeFS.rmSync(svgPath);
  }
}

const symbolSource = NodeFS.readFileSync(
  NodePath.resolve(mobileDirectory, "src/components/AppSymbol.tsx"),
  "utf8",
);

const selections = symbolSource.match(/const ICONS = \{([\s\S]*?)\} satisfies/)?.[1];

if (!selections) throw new Error("Expected native Remix icon selections.");

const nativeNames = new Set([
  "archivebox",
  "desktopcomputer",
  "gearshape",
  "checkmark",
  "trash",
  "arrow.uturn.backward",
  "clock",
  "arrow.up",
  "arrow.down",
  "pin.slash",
  "pin",
  "arrow.clockwise",
  "xmark",
  "list.bullet",
  "square.and.pencil",
  "sidebar.left",
  "arrow.up.left.and.arrow.down.right",
  "line.3.horizontal.decrease.circle",
  "line.3.horizontal.decrease.circle.fill",
  "plus",
  "qrcode.viewfinder",
]);

const entries = [...selections.matchAll(/^  (?:"([^"]+)"|(\w+)): (\w+),/gm)].filter((entry) =>
  nativeNames.has(entry[1] ?? entry[2]),
);

if (entries.length !== nativeNames.size) throw new Error("Missing a native Remix icon selection.");

const nativeOutput = NodePath.resolve(mobileDirectory, "assets/native-icons");

NodeFS.mkdirSync(nativeOutput, { recursive: true });

const filenames = new Set(entries.map((entry) => `Remix${entry[3]}.png`));

for (const filename of NodeFS.readdirSync(nativeOutput)) {
  if (filename.startsWith("Remix") && filename.endsWith(".png") && !filenames.has(filename)) {
    NodeFS.rmSync(NodePath.join(nativeOutput, filename));
  }
}

for (const icon of new Set(entries.map((entry) => entry[3]))) {
  const name = `Remix${icon}`;
  const svgPath = NodePath.resolve(nativeOutput, `${name}.svg`);

  NodeFS.writeFileSync(
    svgPath,
    renderToStaticMarkup(createElement(icons[`Ri${icon}`], { size: 64, color: "#000" })),
  );

  try {
    NodeChildProcess.execFileSync(
      "sips",
      ["-s", "format", "png", svgPath, "--out", NodePath.resolve(nativeOutput, `${name}.png`)],
      { stdio: "ignore" },
    );
  } finally {
    NodeFS.rmSync(svgPath);
  }
}

NodeFS.writeFileSync(
  NodePath.resolve(mobileDirectory, "src/native/nativeIconAssets.generated.ts"),
  'import type { ImageSourcePropType } from "react-native";\n\nexport const NATIVE_ICON_ASSETS = {\n' +
    entries
      .map(([, quoted, plain, icon]) => {
        const drawable = `remix_${icon.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase()}`;

        return `  ${JSON.stringify(quoted ?? plain)}: { source: { uri: "${drawable}" }, imageName: "${drawable}" },`;
      })
      .join("\n") +
    "\n} as const satisfies Record<string, { source: ImageSourcePropType; imageName: string }>;\n",
);

console.log(
  `Generated ${Object.keys(mapping).length} Remix widget icons and ${entries.length} native icon selections.`,
);
