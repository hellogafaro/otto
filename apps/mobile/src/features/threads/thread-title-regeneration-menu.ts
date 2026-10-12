import { nativeMenuImage } from "../../native/nativeIcons";
import type { MenuAction } from "@react-native-menu/menu";

export function buildThreadTitleRegenerationMenuItems(input: {
  readonly supported: boolean;
  readonly isRegenerating: boolean;
}): MenuAction[] {
  if (!input.supported) return [];

  return [
    {
      id: "regenerate-title",
      title: input.isRegenerating ? "Regenerating…" : "Regenerate title",
      image: nativeMenuImage("arrow.clockwise"),
      ...(input.isRegenerating ? { attributes: { disabled: true } } : {}),
    },
  ];
}
