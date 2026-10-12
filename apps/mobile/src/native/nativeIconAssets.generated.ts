import type { ImageSourcePropType } from "react-native";

export const NATIVE_ICON_ASSETS = {
  "arrow.clockwise": { source: { uri: "remix_refresh_line" }, imageName: "remix_refresh_line" },
  "arrow.down": { source: { uri: "remix_arrow_down_line" }, imageName: "remix_arrow_down_line" },
  "arrow.up": { source: { uri: "remix_arrow_up_line" }, imageName: "remix_arrow_up_line" },
  "arrow.up.left.and.arrow.down.right": {
    source: { uri: "remix_expand_diagonal_line" },
    imageName: "remix_expand_diagonal_line",
  },
  "arrow.uturn.backward": {
    source: { uri: "remix_arrow_go_back_line" },
    imageName: "remix_arrow_go_back_line",
  },
  archivebox: { source: { uri: "remix_archive_line" }, imageName: "remix_archive_line" },
  checkmark: { source: { uri: "remix_check_line" }, imageName: "remix_check_line" },
  clock: { source: { uri: "remix_time_line" }, imageName: "remix_time_line" },
  desktopcomputer: { source: { uri: "remix_computer_line" }, imageName: "remix_computer_line" },
  gearshape: { source: { uri: "remix_settings3_line" }, imageName: "remix_settings3_line" },
  "list.bullet": { source: { uri: "remix_list_unordered" }, imageName: "remix_list_unordered" },
  "line.3.horizontal.decrease.circle": {
    source: { uri: "remix_filter3_line" },
    imageName: "remix_filter3_line",
  },
  "line.3.horizontal.decrease.circle.fill": {
    source: { uri: "remix_filter3_fill" },
    imageName: "remix_filter3_fill",
  },
  pin: { source: { uri: "remix_pushpin_line" }, imageName: "remix_pushpin_line" },
  "pin.slash": { source: { uri: "remix_unpin_line" }, imageName: "remix_unpin_line" },
  plus: { source: { uri: "remix_add_line" }, imageName: "remix_add_line" },
  "qrcode.viewfinder": { source: { uri: "remix_qr_code_line" }, imageName: "remix_qr_code_line" },
  "sidebar.left": { source: { uri: "remix_side_bar_line" }, imageName: "remix_side_bar_line" },
  "square.and.pencil": { source: { uri: "remix_edit_box_line" }, imageName: "remix_edit_box_line" },
  trash: { source: { uri: "remix_delete_bin_line" }, imageName: "remix_delete_bin_line" },
  xmark: { source: { uri: "remix_close_line" }, imageName: "remix_close_line" },
} as const satisfies Record<string, { source: ImageSourcePropType; imageName: string }>;
