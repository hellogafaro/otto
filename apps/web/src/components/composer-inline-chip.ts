// Otto: Mention and skill tags are plain inline text on a blue tint at the size of the text
// around them, with 4px corners, 3px sides and 2px top and bottom; inline padding never changes
// the line height.
export const INLINE_TAG_CLASS_NAME =
  "rounded-sm bg-skill/14 px-0.75 py-0.5 text-skill-foreground box-decoration-clone";

// File, settings and terminal chips share the tag's tint and corners, with a leading icon.
const INLINE_CHIP_CLASS_NAME =
  "inline-flex max-w-full items-baseline gap-[0.25em] rounded-sm px-0.75 align-baseline bg-skill/14 text-skill-foreground";

export const CHAT_INLINE_CHIP_CLASS_NAME = INLINE_CHIP_CLASS_NAME;

export const COMPOSER_INLINE_CHIP_CLASS_NAME = `${INLINE_CHIP_CLASS_NAME} select-none`;

export const COMPOSER_INLINE_CHIP_DECORATOR_CLASS_NAME =
  "relative inline-flex align-[-0.125em] leading-none data-[composer-chip-selected]:after:pointer-events-none data-[composer-chip-selected]:after:absolute data-[composer-chip-selected]:after:inset-0 data-[composer-chip-selected]:after:rounded-sm data-[composer-chip-selected]:after:bg-[Highlight] data-[composer-chip-selected]:after:opacity-30 data-[composer-chip-selected]:after:content-['']";

// AppIcon repeats this string for `fit="inline-chip"`; change both together.
export const COMPOSER_INLINE_CHIP_ICON_CLASS_NAME =
  "block size-[1em] shrink-0 self-center opacity-85 [&>svg]:block";

export const CHAT_INLINE_CHIP_LABEL_CLASS_NAME = "truncate";

export const COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME = "block truncate select-none";

export const COMPOSER_INLINE_SKILL_CHIP_CLASS_NAME = COMPOSER_INLINE_CHIP_CLASS_NAME;

export const CHAT_INLINE_SKILL_CHIP_CLASS_NAME = INLINE_TAG_CLASS_NAME;

// Holds either the skill's emoji or the fallback skill glyph at the same box
// and full opacity, so adjacent chips with and without an emoji match.
export const INLINE_SKILL_CHIP_ICON_CLASS_NAME =
  "flex size-[1em] shrink-0 items-center justify-center self-center text-[1em] leading-none [&>svg]:block [&>svg]:size-full";

export const SKILL_CHIP_ICON_SVG = `<svg width="100%" height="100%" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>`;

export const COMPOSER_INLINE_CHIP_DISMISS_BUTTON_CLASS_NAME =
  "ml-[0.17em] inline-flex size-[1.17em] shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground/72 transition-colors hover:bg-foreground/6 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
