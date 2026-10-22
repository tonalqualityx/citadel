import {
  BadgeCheck, CalendarDays, Check, CircleCheck, CircleX, CircleDashed, Contrast, FileText, Flag, Folder, History,
  MessageSquareText, PenLine, Tag, TriangleAlert, type LucideIcon,
} from 'lucide-react';
import type { ChipTone } from '@/lib/portal/status-labels';

// One icon per chip tone, per kind and per history type. Icons are always aria-hidden next to a word.
export const TONE_ICON: Record<ChipTone, LucideIcon> = {
  attention: PenLine,
  moving: Contrast,
  done: CircleCheck,
  quiet: CircleDashed,
  urgent: TriangleAlert,
  quote: Tag,
};

export type Kind = 'project' | 'retainer' | 'request' | 'history';

export const KIND_ICON: Record<Kind, LucideIcon> = {
  project: Folder,
  retainer: CalendarDays,
  request: MessageSquareText,
  history: History,
};

export type HistoryType = 'completed' | 'approved' | 'cancelled' | 'published' | 'milestone';

export const TYPE_ICON: Record<HistoryType, LucideIcon> = {
  completed: Check,
  approved: BadgeCheck,
  cancelled: CircleX,
  published: FileText,
  milestone: Flag,
};
