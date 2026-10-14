import type * as Path from "effect/Path";

/** Library bytes sit next to chat attachments, one file per Library file id. */
export function libraryDirectory(path: Path.Path, attachmentsDir: string): string {
  return path.join(path.dirname(attachmentsDir), "library");
}

/** Server-made ids only; anything else resolves to nothing. */
export function libraryFilePath(
  path: Path.Path,
  attachmentsDir: string,
  fileId: string,
): string | null {
  return /^[A-Za-z0-9-]{1,100}$/.test(fileId)
    ? path.join(libraryDirectory(path, attachmentsDir), fileId)
    : null;
}
