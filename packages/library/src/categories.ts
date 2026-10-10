export const LIBRARY_CATEGORIES = [
  "all",
  "documents",
  "images",
  "video",
  "audio",
  "other",
] as const;
export type LibraryCategory = (typeof LIBRARY_CATEGORIES)[number];
