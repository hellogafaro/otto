import { resolveFileIconKind } from "@otto/client-runtime/file-icons";

const LANGUAGE_EXTENSION_ALIASES = {
  bash: "sh",
  csharp: "cs",
  dockerfile: "dockerfile",
  javascript: "js",
  jsx: "jsx",
  markdown: "md",
  mdx: "mdx",
  plaintext: "txt",
  python: "py",
  ruby: "rb",
  rust: "rs",
  shell: "sh",
  shellscript: "sh",
  swift: "swift",
  typescript: "ts",
  tsx: "tsx",
  yaml: "yml",
};

const LANGUAGE_EXTENSION_ALIASES_LOOKUP = new Map(Object.entries(LANGUAGE_EXTENSION_ALIASES));

export function basenameOfPath(pathValue: string): string {
  const slashIndex = pathValue.lastIndexOf("/");

  return slashIndex === -1 ? pathValue : pathValue.slice(slashIndex + 1);
}

export function inferEntryKindFromPath(pathValue: string): "file" | "directory" {
  const base = basenameOfPath(pathValue);

  if (base.startsWith(".") && !base.slice(1).includes(".")) return "directory";

  return base.includes(".") ? "file" : "directory";
}

export function syntheticFileNameForLanguageId(languageId: string): string {
  const normalized = languageId.toLowerCase();

  return `file.${LANGUAGE_EXTENSION_ALIASES_LOOKUP.get(normalized) ?? normalized}`;
}

export function hasSpecificFileIconForFileName(fileName: string): boolean {
  return resolveFileIconKind(fileName) !== "default";
}
