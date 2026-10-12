declare module "react-native-remix-icon/src/icons/*" {
  import type { ComponentType } from "react";
  import type { SvgProps } from "react-native-svg";

  const Icon: ComponentType<SvgProps>;
  export default Icon;
}
