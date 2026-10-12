import type { ComponentType } from "react";
import type { ColorValue, StyleProp, ViewStyle } from "react-native";
import type { SvgProps } from "react-native-svg";
import { Predicate } from "effect";
import MicFill from "react-native-remix-icon/src/icons/MicFill";
import HardDriveLine from "react-native-remix-icon/src/icons/HardDriveLine";
import InboxUnarchiveLine from "react-native-remix-icon/src/icons/InboxUnarchiveLine";
import Chat1Line from "react-native-remix-icon/src/icons/Chat1Line";
import AccountCircleLine from "react-native-remix-icon/src/icons/AccountCircleLine";
import AddLine from "react-native-remix-icon/src/icons/AddLine";
import AlertLine from "react-native-remix-icon/src/icons/AlertLine";
import AppsLine from "react-native-remix-icon/src/icons/AppsLine";
import ArchiveFill from "react-native-remix-icon/src/icons/ArchiveFill";
import ArchiveLine from "react-native-remix-icon/src/icons/ArchiveLine";
import ArrowDownCircleLine from "react-native-remix-icon/src/icons/ArrowDownCircleLine";
import ArrowDownLine from "react-native-remix-icon/src/icons/ArrowDownLine";
import ArrowDownSLine from "react-native-remix-icon/src/icons/ArrowDownSLine";
import ArrowGoBackLine from "react-native-remix-icon/src/icons/ArrowGoBackLine";
import ArrowLeftSLine from "react-native-remix-icon/src/icons/ArrowLeftSLine";
import ArrowRightCircleLine from "react-native-remix-icon/src/icons/ArrowRightCircleLine";
import ArrowRightSLine from "react-native-remix-icon/src/icons/ArrowRightSLine";
import ArrowRightUpLine from "react-native-remix-icon/src/icons/ArrowRightUpLine";
import ArrowUpCircleLine from "react-native-remix-icon/src/icons/ArrowUpCircleLine";
import ArrowUpLine from "react-native-remix-icon/src/icons/ArrowUpLine";
import ArrowUpSLine from "react-native-remix-icon/src/icons/ArrowUpSLine";
import BarChartLine from "react-native-remix-icon/src/icons/BarChartLine";
import Box3Line from "react-native-remix-icon/src/icons/Box3Line";
import CameraLine from "react-native-remix-icon/src/icons/CameraLine";
import Chat3Line from "react-native-remix-icon/src/icons/Chat3Line";
import CheckLine from "react-native-remix-icon/src/icons/CheckLine";
import CheckboxCircleLine from "react-native-remix-icon/src/icons/CheckboxCircleLine";
import CloseCircleFill from "react-native-remix-icon/src/icons/CloseCircleFill";
import CloseLine from "react-native-remix-icon/src/icons/CloseLine";
import CodeLine from "react-native-remix-icon/src/icons/CodeLine";
import ComputerLine from "react-native-remix-icon/src/icons/ComputerLine";
import DeleteBinLine from "react-native-remix-icon/src/icons/DeleteBinLine";
import EditBoxLine from "react-native-remix-icon/src/icons/EditBoxLine";
import EditLine from "react-native-remix-icon/src/icons/EditLine";
import EqualizerLine from "react-native-remix-icon/src/icons/EqualizerLine";
import ErrorWarningLine from "react-native-remix-icon/src/icons/ErrorWarningLine";
import ExpandDiagonalLine from "react-native-remix-icon/src/icons/ExpandDiagonalLine";
import ExternalLinkLine from "react-native-remix-icon/src/icons/ExternalLinkLine";
import EyeLine from "react-native-remix-icon/src/icons/EyeLine";
import FileCopyLine from "react-native-remix-icon/src/icons/FileCopyLine";
import FileTextLine from "react-native-remix-icon/src/icons/FileTextLine";
import Filter3Fill from "react-native-remix-icon/src/icons/Filter3Fill";
import Filter3Line from "react-native-remix-icon/src/icons/Filter3Line";
import FlashlightLine from "react-native-remix-icon/src/icons/FlashlightLine";
import FolderAddLine from "react-native-remix-icon/src/icons/FolderAddLine";
import FolderFill from "react-native-remix-icon/src/icons/FolderFill";
import FolderLine from "react-native-remix-icon/src/icons/FolderLine";
import FolderOpenLine from "react-native-remix-icon/src/icons/FolderOpenLine";
import FontSize from "react-native-remix-icon/src/icons/FontSize";
import FontSize2 from "react-native-remix-icon/src/icons/FontSize2";
import GitBranchLine from "react-native-remix-icon/src/icons/GitBranchLine";
import GitMergeLine from "react-native-remix-icon/src/icons/GitMergeLine";
import GitPullRequestLine from "react-native-remix-icon/src/icons/GitPullRequestLine";
import GlobalLine from "react-native-remix-icon/src/icons/GlobalLine";
import HammerLine from "react-native-remix-icon/src/icons/HammerLine";
import ImageLine from "react-native-remix-icon/src/icons/ImageLine";
import InformationLine from "react-native-remix-icon/src/icons/InformationLine";
import Key2Line from "react-native-remix-icon/src/icons/Key2Line";
import KeyboardLine from "react-native-remix-icon/src/icons/KeyboardLine";
import LayoutColumnLine from "react-native-remix-icon/src/icons/LayoutColumnLine";
import LayoutRightLine from "react-native-remix-icon/src/icons/LayoutRightLine";
import Link from "react-native-remix-icon/src/icons/Link";
import MoonLine from "react-native-remix-icon/src/icons/MoonLine";
import MoreLine from "react-native-remix-icon/src/icons/MoreLine";
import NodeTree from "react-native-remix-icon/src/icons/NodeTree";
import Notification3Line from "react-native-remix-icon/src/icons/Notification3Line";
import PaletteLine from "react-native-remix-icon/src/icons/PaletteLine";
import PlayLine from "react-native-remix-icon/src/icons/PlayLine";
import PushpinLine from "react-native-remix-icon/src/icons/PushpinLine";
import QrCodeLine from "react-native-remix-icon/src/icons/QrCodeLine";
import RefreshLine from "react-native-remix-icon/src/icons/RefreshLine";
import SearchLine from "react-native-remix-icon/src/icons/SearchLine";
import ServerLine from "react-native-remix-icon/src/icons/ServerLine";
import Settings3Line from "react-native-remix-icon/src/icons/Settings3Line";
import SideBarLine from "react-native-remix-icon/src/icons/SideBarLine";
import SparklingLine from "react-native-remix-icon/src/icons/SparklingLine";
import StopFill from "react-native-remix-icon/src/icons/StopFill";
import SubtractLine from "react-native-remix-icon/src/icons/SubtractLine";
import SunLine from "react-native-remix-icon/src/icons/SunLine";
import TerminalBoxLine from "react-native-remix-icon/src/icons/TerminalBoxLine";
import TextSpacing from "react-native-remix-icon/src/icons/TextSpacing";
import TimeLine from "react-native-remix-icon/src/icons/TimeLine";
import ToolsLine from "react-native-remix-icon/src/icons/ToolsLine";
import UnpinLine from "react-native-remix-icon/src/icons/UnpinLine";
import WifiOffLine from "react-native-remix-icon/src/icons/WifiOffLine";
import ListUnordered from "react-native-remix-icon/src/icons/ListUnordered";

const ICONS = {
  "mic.fill": MicFill,
  internaldrive: HardDriveLine,
  "tray.and.arrow.up": InboxUnarchiveLine,
  sparkles: SparklingLine,
  hammer: HammerLine,
  "bubble.left": Chat1Line,
  wrench: ToolsLine,
  bolt: FlashlightLine,
  minus: SubtractLine,
  "arrow.branch": GitBranchLine,
  "arrow.clockwise": RefreshLine,
  "arrow.down.circle": ArrowDownCircleLine,
  "arrow.down": ArrowDownLine,
  "arrow.right.circle": ArrowRightCircleLine,
  "arrow.triangle.branch": GitBranchLine,
  "arrow.triangle.pull": GitPullRequestLine,
  "arrow.turn.left.up": ArrowGoBackLine,
  "arrow.up": ArrowUpLine,
  "arrow.up.circle": ArrowUpCircleLine,
  "arrow.up.left.and.arrow.down.right": ExpandDiagonalLine,
  "arrow.up.right": ArrowRightUpLine,
  "arrow.up.right.circle": ArrowRightUpLine,
  "arrow.uturn.backward": ArrowGoBackLine,
  archivebox: ArchiveLine,
  "archivebox.fill": ArchiveFill,
  "bell.badge": Notification3Line,
  "bolt.circle": FlashlightLine,
  "bolt.horizontal.circle": FlashlightLine,
  camera: CameraLine,
  "chart.bar.xaxis": BarChartLine,
  checkmark: CheckLine,
  "checkmark.circle": CheckboxCircleLine,
  clock: TimeLine,
  cube: Box3Line,
  "chevron.down": ArrowDownSLine,
  "chevron.left": ArrowLeftSLine,
  "chevron.left.forwardslash.chevron.right": CodeLine,
  "chevron.right": ArrowRightSLine,
  "chevron.up": ArrowUpSLine,
  desktopcomputer: ComputerLine,
  "doc.on.doc": FileCopyLine,
  "doc.text": FileTextLine,
  ellipsis: MoreLine,
  moon: MoonLine,
  "ellipsis.circle": MoreLine,
  "exclamationmark.triangle": AlertLine,
  eye: EyeLine,
  folder: FolderLine,
  "folder.badge.plus": FolderAddLine,
  "folder.fill": FolderFill,
  gearshape: Settings3Line,
  key: Key2Line,
  "info.circle": InformationLine,
  link: Link,
  "list.bullet": ListUnordered,
  "line.3.horizontal.decrease.circle": Filter3Line,
  "line.3.horizontal.decrease.circle.fill": Filter3Fill,
  magnifyingglass: SearchLine,
  paintbrush: PaletteLine,
  "person.crop.circle": AccountCircleLine,
  photo: ImageLine,
  pin: PushpinLine,
  "pin.slash": UnpinLine,
  play: PlayLine,
  plus: AddLine,
  "qrcode.viewfinder": QrCodeLine,
  "point.3.connected.trianglepath.dotted": NodeTree,
  "point.topleft.down.curvedto.point.bottomright.up": GitMergeLine,
  safari: ExternalLinkLine,
  "server.rack": ServerLine,
  "sidebar.left": SideBarLine,
  "sidebar.right": LayoutRightLine,
  "slider.horizontal.3": EqualizerLine,
  "square.and.pencil": EditBoxLine,
  "square.grid.2x2": AppsLine,
  "square.split.2x1": LayoutColumnLine,
  "sun.max": SunLine,
  "stop.fill": StopFill,
  terminal: TerminalBoxLine,
  globe: GlobalLine,
  "text.bubble": Chat3Line,
  "text.word.spacing": TextSpacing,
  "textformat.size": FontSize,
  "textformat.size.larger": FontSize2,
  "textformat.size.smaller": FontSize2,
  trash: DeleteBinLine,
  "wifi.slash": WifiOffLine,
  xmark: CloseLine,
  "xmark.circle.fill": CloseCircleFill,
} satisfies Record<string, ComponentType<SvgProps>>;

const PLATFORM_ICONS = new Map<string, ComponentType<SvgProps>>([
  ["auto_awesome", SparklingLine],
  ["bolt", FlashlightLine],
  ["build", ToolsLine],
  ["chat_bubble", Chat3Line],
  ["check", CheckLine],
  ["close", CloseLine],
  ["construction", HammerLine],
  ["content_copy", FileCopyLine],
  ["edit", EditLine],
  ["error", ErrorWarningLine],
  ["folder", FolderLine],
  ["folder_open", FolderOpenLine],
  ["keyboard", KeyboardLine],
  ["keyboard_arrow_down", ArrowDownSLine],
  ["keyboard_arrow_up", ArrowUpSLine],
  ["keyboard_hide", KeyboardLine],
  ["public", GlobalLine],
  ["remove", SubtractLine],
  ["terminal", TerminalBoxLine],
  ["visibility", EyeLine],
]);

export type AppSymbolName =
  | keyof typeof ICONS
  | {
      ios?: keyof typeof ICONS;
      android?: string;
    };

export function SymbolView({
  name,
  size = 24,
  tintColor,
  style,
  accessibilityLabel,
  testID,
}: {
  name: AppSymbolName;
  size?: number;
  tintColor?: ColorValue;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  testID?: string;
}) {
  const Icon = Predicate.isString(name)
    ? ICONS[name]
    : ((name.android ? PLATFORM_ICONS.get(name.android) : undefined) ??
      (name.ios ? ICONS[name.ios] : undefined));

  if (!Icon) return null;

  return (
    <Icon
      accessibilityLabel={accessibilityLabel}
      accessible={Boolean(accessibilityLabel)}
      fill={tintColor ?? "currentColor"}
      width={size}
      height={size}
      style={style}
      testID={testID}
    />
  );
}
