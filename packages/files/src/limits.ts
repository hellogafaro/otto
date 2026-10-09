/** Largest saved File (decimal bytes). The one place to change the storage capacity. */
export const MAX_FILE_BYTES = 100_000_000;
/** In-memory consumers (model/tool/preview/Skill materialization) stay far below the storage maximum. */
export const SMALL_FILE_BYTES = 8 * 1024 * 1024;
/** Deepest allowed folder nesting; a top-level folder has depth 1. */
export const MAX_FOLDER_DEPTH = 8;
