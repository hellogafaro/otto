import {
  SelectableMarkdownText as OttoLegacySelectableMarkdownText,
  type SelectableMarkdownTextProps,
} from "@otto/mobile-markdown-text/renderer";

import { highlightCodeSnippet } from "../features/threads/codeHighlighter";

type MobileSelectableMarkdownTextProps = Omit<SelectableMarkdownTextProps, "highlightCode">;

export type {
  MarkdownImageRenderer,
  MarkdownImageRequest,
  NativeMarkdownTextStyle,
  SelectableMarkdownSkill,
} from "@otto/mobile-markdown-text/types";

export function hasNativeSelectableMarkdownText(): boolean {
  return true;
}

export function SelectableMarkdownText(props: MobileSelectableMarkdownTextProps) {
  return <OttoLegacySelectableMarkdownText {...props} highlightCode={highlightCodeSnippet} />;
}
