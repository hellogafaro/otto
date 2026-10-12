import { Image } from "expo-image";

const source = require("../../../../assets/prod/otto-app-1024.png");

export function BrandIcon(props: { readonly borderRadius: number; readonly size: number }) {
  return (
    <Image
      source={source}
      accessibilityIgnoresInvertColors
      style={{ borderRadius: props.borderRadius, height: props.size, width: props.size }}
    />
  );
}
