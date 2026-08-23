/**
 * Every icon the app uses, named for what it *means* rather than what it looks
 * like, and mapped to Reicon in exactly one place.
 *
 * The rest of the codebase imports `ScreenIcon`, not `Monitor`. That keeps the
 * icon library swappable in this file alone, and it stops the same concept
 * being drawn two different ways in two different panels — which is the way
 * icon sets normally rot.
 */

import {
  Add,
  AspectRatioSquare,
  Crosshairs,
  Display,
  AlertCircle,
  Archive,
  ArrowLeft,
  ArrowRight,
  Bell,
  Camera,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Comment,
  Copy,
  Crop,
  Cursor,
  Download,
  Eye,
  EyeClosed,
  File,
  Filter,
  Folder,
  Frame,
  Fullscreen,
  Globe,
  Grid,
  Hand,
  HelpCircle,
  Home,
  Image,
  InfoCircle,
  Layers,
  Link,
  List,
  Lock,
  LockOpen,
  Maximize,
  Menu,
  Mic,
  MicOff,
  Minus,
  Monitor,
  More,
  Nodes,
  Pen,
  Play,
  Plus,
  Presentation,
  Record,
  Redo,
  Refresh,
  Search,
  Send,
  Settings,
  Share,
  Shield,
  Star,
  Stickynote,
  Text,
  Trash,
  Undo,
  Upload,
  User,
  Users,
  Video,
  VideoSlash,
  Volume,
  X,
} from "reicon-react";
import type { ComponentType, SVGProps } from "react";

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "color"> {
  size?: number;
  weight?: "Outline" | "Filled";
  color?: string;
}

export type Icon = ComponentType<IconProps>;

/* --- what things are ------------------------------------------------------ */
/** The stage: the rectangle the audience sees. Never the same glyph as a window. */
export const StageIcon = AspectRatioSquare as Icon;
/** The stage following the operator's work, rather than staying put. */
export const FollowIcon = Crosshairs as Icon;
export const ScreenIcon = Monitor as Icon;
export const DisplayIcon = Display as Icon;
export const WindowIcon = Frame as Icon;
export const RegionIcon = Crop as Icon;
export const CameraIcon = Camera as Icon;
export const ImageIcon = Image as Icon;
export const VideoIcon = Video as Icon;
export const FileIcon = File as Icon;
export const FolderIcon = Folder as Icon;
export const NoteIcon = Stickynote as Icon;
export const WebIcon = Globe as Icon;
export const ConnectionIcon = Nodes as Icon;
export const LayersIcon = Layers as Icon;
export const BoardIcon = Grid as Icon;
export const TemplateIcon = List as Icon;

/* --- tools ---------------------------------------------------------------- */
export const SelectIcon = Cursor as Icon;
export const PanIcon = Hand as Icon;
export const FrameToolIcon = Frame as Icon;
export const CommentIcon = Comment as Icon;
export const PenIcon = Pen as Icon;
export const TextIcon = Text as Icon;
export const PresentIcon = Presentation as Icon;

/* --- actions -------------------------------------------------------------- */
export const AddIcon = Plus as Icon;
export const AddBoxIcon = Add as Icon;
export const RemoveIcon = Minus as Icon;
export const CloseIcon = X as Icon;
export const CheckIcon = Check as Icon;
export const MoreIcon = More as Icon;
export const MenuIcon = Menu as Icon;
export const SearchIcon = Search as Icon;
export const FilterIcon = Filter as Icon;
export const CopyIcon = Copy as Icon;
export const TrashIcon = Trash as Icon;
export const UndoIcon = Undo as Icon;
export const RedoIcon = Redo as Icon;
export const RefreshIcon = Refresh as Icon;
export const UploadIcon = Upload as Icon;
export const DownloadIcon = Download as Icon;
export const SendIcon = Send as Icon;
export const ShareIcon = Share as Icon;
export const LinkIcon = Link as Icon;
export const SettingsIcon = Settings as Icon;
export const ExpandIcon = Fullscreen as Icon;
export const MaximizeIcon = Maximize as Icon;

/* --- state ---------------------------------------------------------------- */
export const LockedIcon = Lock as Icon;
export const UnlockedIcon = LockOpen as Icon;
export const EyeIcon = Eye as Icon;
/** A part of a tile the audience never sees. */
export const HideIcon = EyeClosed as Icon;
export const RecordIcon = Record as Icon;
export const PlayIcon = Play as Icon;
export const MicIcon = Mic as Icon;
export const MicOffIcon = MicOff as Icon;
export const VideoOffIcon = VideoSlash as Icon;
export const VolumeIcon = Volume as Icon;
export const ShieldIcon = Shield as Icon;
export const InfoIcon = InfoCircle as Icon;
export const WarnIcon = AlertCircle as Icon;
export const HelpIcon = HelpCircle as Icon;
export const ClockIcon = Clock as Icon;
export const StarIcon = Star as Icon;
export const ArchiveIcon = Archive as Icon;
export const BellIcon = Bell as Icon;
export const HomeIcon = Home as Icon;

/* --- people --------------------------------------------------------------- */
export const PersonIcon = User as Icon;
export const PeopleIcon = Users as Icon;

/* --- direction ------------------------------------------------------------ */
export const ChevronDownIcon = ChevronDown as Icon;
export const ChevronUpIcon = ChevronUp as Icon;
export const ChevronLeftIcon = ChevronLeft as Icon;
export const ChevronRightIcon = ChevronRight as Icon;
export const BackIcon = ArrowLeft as Icon;
export const ForwardIcon = ArrowRight as Icon;

/**
 * The icon for a board tile, so a tile is drawn the same way in the sidebar, the
 * inspector header and the Add Screens picker.
 */
export function tileIcon(kind: string): Icon {
  switch (kind) {
    case "source":
      return ScreenIcon;
    case "camera":
      return CameraIcon;
    case "image":
      return ImageIcon;
    case "video":
      return VideoIcon;
    case "pdf":
      return FileIcon;
    case "note":
      return NoteIcon;
    case "web":
      return WebIcon;
    default:
      return LayersIcon;
  }
}
