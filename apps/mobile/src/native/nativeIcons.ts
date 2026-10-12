import { NATIVE_ICON_ASSETS } from "./nativeIconAssets.generated";

const icons = new Map(Object.entries(NATIVE_ICON_ASSETS));

export function nativeHeaderIcon(name: string | undefined) {
  const icon = name ? icons.get(name) : undefined;

  return icon ? { type: "image" as const, source: icon.source, tinted: true } : undefined;
}

export function nativeMenuImage(name: keyof typeof NATIVE_ICON_ASSETS): string {
  const icon = NATIVE_ICON_ASSETS[name];

  return icon.imageName;
}
