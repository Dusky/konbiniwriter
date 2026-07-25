import React from 'react'
import {
  Search, FileText, Folder, FolderOpen, Sparkles, Settings, Settings2,
  Check, TriangleAlert, Info, ChevronRight, ChevronDown, Plus, X,
  Trash2, BookOpen, Wand2, Download, Upload, RefreshCw, Copy, Pencil,
  Square, ArrowUp, Wrench, Eye, Clock, PanelLeft, PanelRight, Columns2,
  Focus, NotebookText, History, FileOutput, TextSearch, ChartColumn,
  Undo2, Redo2, Flame, StickyNote, Clapperboard,
  Palette, Rocket, Trophy, Library, Gauge,
  type LucideIcon,
} from 'lucide-react'

// One monochrome icon set for the whole app — Lucide, stroked, currentColor, on
// a 24px grid — so UI glyphs stop being emoji (✦ ⚙ ▸ …). Usage: <Icon name="search" />.
// Size defaults to 1em so an icon tracks its text; pass `size` for a fixed px.

export type IconName =
  | 'search' | 'document' | 'folder' | 'folder-open' | 'sparkle' | 'settings'
  | 'settings-2' | 'check' | 'warning' | 'info' | 'chevron' | 'chevron-down'
  | 'plus' | 'x' | 'close' | 'trash' | 'book' | 'wand' | 'download' | 'upload'
  | 'refresh' | 'copy' | 'edit' | 'stop' | 'send' | 'tool' | 'eye' | 'clock'
  | 'panel-left' | 'panel-right' | 'columns' | 'focus' | 'notebook' | 'history'
  | 'file-output' | 'text-search' | 'chart' | 'undo' | 'redo' | 'flame'
  | 'sticky-note' | 'clapperboard' | 'palette' | 'rocket' | 'trophy' | 'library' | 'gauge'

const MAP: Record<IconName, LucideIcon> = {
  search: Search,
  document: FileText,
  folder: Folder,
  'folder-open': FolderOpen,
  sparkle: Sparkles,
  settings: Settings,
  'settings-2': Settings2,
  check: Check,
  warning: TriangleAlert,
  info: Info,
  chevron: ChevronRight,
  'chevron-down': ChevronDown,
  plus: Plus,
  x: X,
  close: X,
  trash: Trash2,
  book: BookOpen,
  wand: Wand2,
  download: Download,
  upload: Upload,
  refresh: RefreshCw,
  copy: Copy,
  edit: Pencil,
  stop: Square,
  send: ArrowUp,
  tool: Wrench,
  eye: Eye,
  clock: Clock,
  'panel-left': PanelLeft,
  'panel-right': PanelRight,
  columns: Columns2,
  focus: Focus,
  notebook: NotebookText,
  history: History,
  'file-output': FileOutput,
  'text-search': TextSearch,
  chart: ChartColumn,
  undo: Undo2,
  redo: Redo2,
  flame: Flame,
  'sticky-note': StickyNote,
  clapperboard: Clapperboard,
  palette: Palette,
  rocket: Rocket,
  trophy: Trophy,
  library: Library,
  gauge: Gauge,
}

interface Props {
  name: IconName
  /** Pixel size; omit to size at 1em (tracks surrounding text). */
  size?: number
  strokeWidth?: number
  className?: string
  style?: React.CSSProperties
  'aria-label'?: string
}

export default function Icon({ name, size, strokeWidth = 1.6, className, style, 'aria-label': ariaLabel }: Props): React.ReactElement {
  const Cmp = MAP[name]
  return (
    <Cmp
      size={size ?? '1em'}
      strokeWidth={strokeWidth}
      className={className}
      style={{ flexShrink: 0, ...style }}
      role={ariaLabel ? 'img' : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
    />
  )
}
