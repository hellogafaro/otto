import { SymbolView } from "../components/AppSymbol";
import { Image, type ImageStyle, type StyleProp } from "react-native";

import { markdownFileIconSource } from "@otto/mobile-markdown-text/file-icons";
import { resolveMarkdownFileIcon } from "@otto/mobile-markdown-text/links";
import { useThemeColor } from "../lib/useThemeColor";

export function FileEntryIcon(props: {
  readonly path: string;
  readonly kind: "file" | "directory";
  readonly size?: number;
  readonly style?: StyleProp<ImageStyle>;
}) {
  const size = props.size ?? 16;
  const folderColor = useThemeColor("--color-icon-subtle");

  if (props.kind === "directory") {
    return <SymbolView name="folder" size={size} tintColor={folderColor} />;
  }

  return (
    <Image
      source={markdownFileIconSource(resolveMarkdownFileIcon(props.path))}
      resizeMode="contain"
      style={[{ width: size, height: size }, props.style]}
    />
  );
}
