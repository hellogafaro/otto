import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeModule from "node:module";
import * as NodeURL from "node:url";

const moduleDirectory = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "..",
);

const repositoryRoot = NodePath.resolve(moduleDirectory, "../../../..");

const outputDirectory = NodePath.join(moduleDirectory, "assets/file-icons");

const require = NodeModule.createRequire(NodePath.join(repositoryRoot, "apps/web/package.json"));

const icons = require("@remixicon/react");

const { createElement } = require("react");

const { renderToStaticMarkup } = require("react-dom/server");

const source = NodeFS.readFileSync(
  NodePath.join(repositoryRoot, "apps/web/src/components/chat/FileEntryIcon.tsx"),
  "utf8",
);

const mapping = source.match(/const FILE_ICONS = \{([\s\S]*?)\} satisfies/)?.[1];

if (!mapping) throw new Error("Could not read the shared Remix file-icon selection.");

const entries = [...mapping.matchAll(/\s+(\w+): (Ri\w+),/g)];

if (entries.length === 0) throw new Error("Expected Remix file-icon selections.");

NodeFS.mkdirSync(outputDirectory, { recursive: true });

for (const [, kind, name] of entries) {
  const svgPath = NodePath.join(outputDirectory, `.remix-${kind}.svg`);
  const pngPath = NodePath.join(outputDirectory, `remix_${kind}.png`);
  const svg = renderToStaticMarkup(createElement(icons[name], { size: 64, color: "#84848a" }));
  NodeFS.writeFileSync(svgPath, svg);

  try {
    NodeChildProcess.execFileSync("sips", ["-s", "format", "png", svgPath, "--out", pngPath], {
      stdio: "ignore",
    });
  } finally {
    NodeFS.rmSync(svgPath);
  }
}

NodeFS.writeFileSync(
  NodePath.join(moduleDirectory, "src/markdownFileIcons.generated.ts"),
  'import type { ImageSourcePropType } from "react-native";\n\nexport const MARKDOWN_FILE_ICON_SOURCES = {\n' +
    entries
      .map(([, kind]) => `  ${kind}: require("../assets/file-icons/remix_${kind}.png"),`)
      .join("\n") +
    "\n} as const satisfies Record<string, ImageSourcePropType>;\n",
);

for (const name of NodeFS.readdirSync(outputDirectory)) {
  if (/^pierre_\w+\.png$/.test(name)) NodeFS.rmSync(NodePath.join(outputDirectory, name));
}

console.log(`Generated ${entries.length} native Remix file icons.`);
