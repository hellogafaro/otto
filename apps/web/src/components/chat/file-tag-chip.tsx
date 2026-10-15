import { inferEntryKindFromPath } from "../../file-icons";
import {
  CHAT_INLINE_CHIP_CLASS_NAME,
  CHAT_INLINE_CHIP_LABEL_CLASS_NAME,
  COMPOSER_INLINE_CHIP_CLASS_NAME,
  COMPOSER_INLINE_CHIP_ICON_CLASS_NAME,
  COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME,
} from "../composer-inline-chip";
import { FileEntryIcon } from "./file-entry-icon";

export const FILE_TAG_CHIP_CLASS_NAME = COMPOSER_INLINE_CHIP_CLASS_NAME;

export const CHAT_FILE_TAG_CHIP_CLASS_NAME = CHAT_INLINE_CHIP_CLASS_NAME;

export function FileTagChipContent(props: {
  path: string;
  label: string;
  theme: "light" | "dark";
  selectable?: boolean;
}) {
  return (
    <>
      <FileEntryIcon
        pathValue={props.path}
        kind={inferEntryKindFromPath(props.path)}
        className={COMPOSER_INLINE_CHIP_ICON_CLASS_NAME}
      />
      <span
        className={
          props.selectable
            ? CHAT_INLINE_CHIP_LABEL_CLASS_NAME
            : COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME
        }
      >
        {props.label}
      </span>
    </>
  );
}
