// One icon family across the dashboard: Lucide. The affectUI App Shell (local copy) names its icons
// in its own way; this maps those names to Lucide, so the shell's code stays as it was and every
// icon in the frame matches the pages' own (outline, round caps, the same stroke).
import {
  Activity,
  Archive,
  ArrowDownAZ,
  ArrowDownUp,
  ArrowDownWideNarrow,
  ArrowDownZA,
  ArrowLeftRight,
  ArrowUpDown,
  ArrowUpNarrowWide,
  ArrowUpRight,
  BetweenHorizontalEnd,
  BetweenHorizontalStart,
  BetweenVerticalEnd,
  BetweenVerticalStart,
  Bold,
  BookOpen,
  Building2,
  Calendar,
  ChartColumn,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleCheck,
  CircleHelp,
  Clipboard,
  Clock,
  Code,
  Columns3,
  Compass,
  Copy,
  CreditCard,
  DollarSign,
  Download,
  Ellipsis,
  Eraser,
  Eye,
  File,
  FileCode,
  FilePen,
  FolderOpen,
  FolderPlus,
  Folder,
  GitMerge,
  Globe,
  Grid3x3,
  HardDrive,
  Hash,
  Heading1,
  Heading2,
  Heading3,
  Image,
  Info,
  Italic,
  KeyRound,
  Languages,
  LayoutDashboard,
  LayoutGrid,
  Link,
  List,
  ListChecks,
  ListFilter,
  ListOrdered,
  LockKeyhole,
  LogOut,
  MessageCircle,
  MessageSquare,
  Monitor,
  Moon,
  Network,
  Palette,
  PanelLeft,
  PanelRight,
  Pause,
  Pencil,
  Percent,
  Pin,
  PinOff,
  Plug,
  Plus,
  Quote,
  Redo2,
  RemoveFormatting,
  Rows3,
  Scissors,
  Search,
  Settings,
  Share2,
  ShieldCheck,
  SquareArrowOutUpRight,
  SquarePen,
  SquareTerminal,
  Strikethrough,
  Sun,
  Table,
  TextCursor,
  TextSelect,
  Trash2,
  Type,
  Underline,
  Undo2,
  User,
  UserPlus,
  Users,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";

/** The shell's icon type: a Lucide icon component */
export type ShellIcon = LucideIcon;

// The App Shell's names → Lucide
export const Activity01Icon = Activity;
export const Analytics01Icon = ChartColumn;
export const Archive02Icon = Archive;
export const ArrowDown01Icon = ChevronDown;
export const ArrowLeft01Icon = ChevronLeft;
export const ArrowLeftRightIcon = ArrowLeftRight;
export const ArrowRight01Icon = ChevronRight;
export const ArrowUp01Icon = ChevronUp;
export const ArrowUpDownIcon = ArrowUpDown;
export const ArrowUpRight01Icon = ArrowUpRight;
export const Book02Icon = BookOpen;
export const BubbleChatIcon = MessageCircle;
export const Calendar03Icon = Calendar;
export const Cancel01Icon = X;
export const CheckListIcon = ListChecks;
export const ClipboardIcon = Clipboard;
export const Clock01Icon = Clock;
export const ColumnDeleteIcon = Columns3;
export const CommandLineIcon = SquareTerminal;
export const ComputerIcon = Monitor;
export const Copy01Icon = Copy;
export const Copy02Icon = Copy;
export const CreditCardIcon = CreditCard;
export const CursorTextIcon = TextCursor;
export const DashboardSquare02Icon = LayoutDashboard;
export const Delete02Icon = Trash2;
export const Dollar01Icon = DollarSign;
export const Download04Icon = Download;
export const EraserIcon = Eraser;
export const File01Icon = File;
export const File02Icon = File;
export const FileCodeIcon = FileCode;
export const FilterIcon = ListFilter;
export const Folder01Icon = Folder;
export const FolderAddIcon = FolderPlus;
export const FolderOpenIcon = FolderOpen;
export const Globe02Icon = Globe;
export const GridTableIcon = Grid3x3;
export const GridViewIcon = LayoutGrid;
export const HardDriveIcon = HardDrive;
export const Heading01Icon = Heading1;
export const Heading02Icon = Heading2;
export const Heading03Icon = Heading3;
export const HelpCircleIcon = CircleHelp;
export const Image01Icon = Image;
export const InformationCircleIcon = Info;
export const InsertColumnLeftIcon = BetweenVerticalStart;
export const InsertColumnRightIcon = BetweenVerticalEnd;
export const InsertRowDownIcon = BetweenHorizontalEnd;
export const InsertRowUpIcon = BetweenHorizontalStart;
export const LeftToRightListBulletIcon = List;
export const LeftToRightListNumberIcon = ListOrdered;
export const Link01Icon = Link;
export const ListViewIcon = List;
export const Logout01Icon = LogOut;
export const Moon02Icon = Moon;
export const MoreHorizontalIcon = Ellipsis;
export const NoteEditIcon = FilePen;
export const PaintBoardIcon = Palette;
export const PencilEdit01Icon = Pencil;
export const PencilEdit02Icon = SquarePen;
export const PercentIcon = Percent;
export const PinIcon = Pin;
export const PinOffIcon = PinOff;
export const PlusSignIcon = Plus;
export const Plug01Icon = Plug;
export const QuoteDownIcon = Quote;
export const Redo02Icon = Redo2;
export const RemoveFormattingIcon = RemoveFormatting;
export const RowDeleteIcon = Rows3;
export const Scissor01Icon = Scissors;
export const Search01Icon = Search;
export const Settings01Icon = Settings;
export const Share08Icon = Share2;
export const SidebarLeftIcon = PanelLeft;
export const SidebarRightIcon = PanelRight;
export const SortByDown01Icon = ArrowDownWideNarrow;
export const SortByUp01Icon = ArrowUpNarrowWide;
export const Sorting05Icon = ArrowDownUp;
export const SortingAZ01Icon = ArrowDownAZ;
export const SortingZA01Icon = ArrowDownZA;
export const SourceCodeIcon = Code;
export const SquareArrowUpRight02Icon = SquareArrowOutUpRight;
export const Sun03Icon = Sun;
export const Table01Icon = Table;
export const TextBoldIcon = Bold;
export const TextFontIcon = Type;
export const TextIcon = Type;
export const TextItalicIcon = Italic;
export const TextNumberSignIcon = Hash;
export const TextSelectionIcon = TextSelect;
export const TextStrikethroughIcon = Strikethrough;
export const TextUnderlineIcon = Underline;
export const Tick02Icon = Check;
export const TranslateIcon = Languages;
export const Undo02Icon = Undo2;
export const UserAdd01Icon = UserPlus;
export const UserIcon = User;
export const UserMultiple02Icon = Users;
export const ViewIcon = Eye;

// The dashboard's own menu and settings sections
export const AiNetworkIcon = Network;
export const Building03Icon = Building2;
export const CheckmarkCircle02Icon = CircleCheck;
export const Compass01Icon = Compass;
export const DashboardSquare01Icon = LayoutDashboard;
export const GitMergeIcon = GitMerge;
export const Key01Icon = KeyRound;
export const LockKeyIcon = LockKeyhole;
export const Message01Icon = MessageSquare;
export const OfficeIcon = Building2;
export const PauseIcon = Pause;
export const SecurityCheckIcon = ShieldCheck;
export const UserGroupIcon = Users;
export const WorkflowSquare10Icon = Workflow;
