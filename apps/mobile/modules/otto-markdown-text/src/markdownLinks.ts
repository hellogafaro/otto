import { resolveFileIconKind, type FileIconKind } from "@otto/client-runtime/file-icons";

type FileLinkLocation = { readonly path: string; readonly hash: string };

type FileLinkPosition = {
  readonly path: string;
  readonly line?: number;
  readonly column?: number;
};

const WINDOWS_DRIVE_PATH_PATTERN = /^[A-Za-z]:[\\/]/;

const WINDOWS_UNC_PATH_PATTERN = /^\\\\/;

const RELATIVE_PATH_PREFIX_PATTERN = /^(~\/|\.{1,2}\/)/;

const RELATIVE_FILE_PATH_PATTERN =
  /^(?:[A-Za-z0-9._-]+(?: +[A-Za-z0-9._-]+)*\/)+[A-Za-z0-9._-]+(?: +[A-Za-z0-9._-]+)*(?::\d+){0,2}$/;

const RELATIVE_FILE_NAME_PATTERN =
  /^[A-Za-z0-9._-]+(?: +[A-Za-z0-9._-]+)*\.[A-Za-z0-9_-]+(?::\d+){0,2}$/;

const POSITION_SUFFIX_PATTERN = /:\d+(?::\d+)?$/;

const POSIX_FILE_ROOT_PREFIXES = [
  "/Users/",
  "/home/",
  "/tmp/",
  "/var/",
  "/etc/",
  "/opt/",
  "/mnt/",
  "/Volumes/",
  "/private/",
  "/root/",
] as const;

export type MarkdownLinkPresentation =
  | {
      readonly kind: "external";
      readonly href: string;
      readonly host: string;
    }
  | {
      readonly kind: "file";
      readonly href: string;
      readonly icon: MarkdownFileIcon;
      readonly label: string;
      readonly path: string;
      readonly line?: number;
      readonly column?: number;
    }
  | {
      readonly kind: "link";
      readonly href: string | null;
    };

export type MarkdownFileIcon = FileIconKind;

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeDestination(value: string): string {
  const trimmed = value.trim();

  return trimmed.startsWith("<") && trimmed.endsWith(">") ? trimmed.slice(1, -1) : trimmed;
}

function fileUrlTarget(href: string): { readonly path: string; readonly hash: string } | null {
  try {
    const parsed = new URL(href);

    if (parsed.protocol.toLowerCase() !== "file:") {
      return null;
    }

    const path = /^\/[A-Za-z]:[\\/]/.test(parsed.pathname)
      ? parsed.pathname.slice(1)
      : parsed.pathname;

    return { path, hash: parsed.hash };
  } catch {
    return null;
  }
}

function stripSearchAndHash(value: string): FileLinkLocation {
  const hashIndex = value.indexOf("#");
  const pathWithSearch = hashIndex >= 0 ? value.slice(0, hashIndex) : value;
  const hash = hashIndex >= 0 ? value.slice(hashIndex) : "";
  const queryIndex = pathWithSearch.indexOf("?");

  return {
    path: queryIndex >= 0 ? pathWithSearch.slice(0, queryIndex) : pathWithSearch,
    hash,
  };
}

function splitFilePosition(path: string, hash: string): FileLinkPosition {
  const suffixMatch = path.match(/:(\d+)(?::(\d+))?$/);
  const hashMatch = suffixMatch ? null : hash.match(/^#L(\d+)(?:C(\d+))?$/i);
  const match = suffixMatch ?? hashMatch;

  if (!match?.[1]) {
    return { path };
  }

  const line = Number.parseInt(match[1], 10);
  const column = match[2] ? Number.parseInt(match[2], 10) : undefined;
  const pathWithoutPosition = suffixMatch ? path.slice(0, -suffixMatch[0].length) : path;

  return {
    path: pathWithoutPosition,
    ...(line > 0 ? { line } : {}),
    ...(column !== undefined && column > 0 ? { column } : {}),
  };
}

function looksLikePosixFilesystemPath(path: string): boolean {
  if (!path.startsWith("/")) {
    return false;
  }

  if (POSIX_FILE_ROOT_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    return true;
  }

  if (POSITION_SUFFIX_PATTERN.test(path)) {
    return true;
  }

  const basename = path.slice(path.lastIndexOf("/") + 1);

  return /\.[A-Za-z0-9_-]+$/.test(basename);
}

function looksLikeFilePath(value: string): boolean {
  if (WINDOWS_DRIVE_PATH_PATTERN.test(value) || WINDOWS_UNC_PATH_PATTERN.test(value)) {
    return true;
  }

  if (RELATIVE_PATH_PREFIX_PATTERN.test(value)) {
    return true;
  }

  if (value.startsWith("/")) {
    return looksLikePosixFilesystemPath(value);
  }

  if (resolveFileIconKind(value) !== "default") {
    return true;
  }

  return RELATIVE_FILE_PATH_PATTERN.test(value) || RELATIVE_FILE_NAME_PATTERN.test(value);
}

function fileLabel(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  const basename = normalized.slice(normalized.lastIndexOf("/") + 1);

  return basename || normalized;
}

export function resolveMarkdownFileIcon(value: string): MarkdownFileIcon {
  return resolveFileIconKind(value);
}

export function resolveMarkdownLinkPresentation(href: string): MarkdownLinkPresentation {
  const normalized = normalizeDestination(href);

  try {
    const parsed = new URL(normalized);

    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return {
        kind: "external",
        href: parsed.toString(),
        host: parsed.hostname,
      };
    }
  } catch {
    // Relative paths and non-URL link destinations are handled below.
  }

  const source = normalized.toLowerCase().startsWith("file:")
    ? fileUrlTarget(normalized)
    : stripSearchAndHash(normalized);

  const decodedSource = source
    ? { path: safeDecode(source.path.trim()), hash: safeDecode(source.hash.trim()) }
    : null;

  const fileTarget = decodedSource
    ? splitFilePosition(decodedSource.path, decodedSource.hash)
    : null;

  const targetWithPosition = fileTarget
    ? `${fileTarget.path}${
        fileTarget.line
          ? `:${fileTarget.line}${fileTarget.column ? `:${fileTarget.column}` : ""}`
          : ""
      }`
    : null;

  if (fileTarget && targetWithPosition && looksLikeFilePath(targetWithPosition)) {
    return {
      kind: "file",
      href: normalized,
      icon: resolveMarkdownFileIcon(fileTarget.path),
      label: fileLabel(targetWithPosition),
      path: fileTarget.path,
      ...(fileTarget.line ? { line: fileTarget.line } : {}),
      ...(fileTarget.column ? { column: fileTarget.column } : {}),
    };
  }

  return {
    kind: "link",
    href: /^(?:grokbot|mailto|tel):/i.test(normalized) ? normalized : null,
  };
}
