import { CalendarDays, Folder, History, House, MessageSquareText, Video, type LucideIcon } from 'lucide-react';

export type NavKey = 'home' | 'projects' | 'retainer' | 'requests' | 'history' | 'book';

export const NAV: Array<{ key: NavKey; href: string; label: string; icon: LucideIcon }> = [
  { key: 'home', href: '/portal/home', label: 'Home', icon: House },
  { key: 'projects', href: '/portal/projects', label: 'Projects', icon: Folder },
  { key: 'retainer', href: '/portal/retainer', label: 'Retainer', icon: CalendarDays },
  { key: 'requests', href: '/portal/requests', label: 'Requests', icon: MessageSquareText },
  { key: 'history', href: '/portal/history', label: 'History', icon: History },
  { key: 'book', href: '/portal/book', label: 'Book a meeting', icon: Video },
];

/** Pages that only exist for a signed-in person. They get the full shell at once. */
const FULL_PREFIXES = [
  '/portal/home', '/portal/projects', '/portal/retainer', '/portal/requests', '/portal/work',
  '/portal/history', '/portal/book', '/portal/articles',
];

/** Sign-in, the account picker and the token pages (a prospect can open these with no session). */
const BARE_PREFIXES = [
  '/portal/login', '/portal/select', '/portal/proposal', '/portal/contract', '/portal/msa',
  '/portal/addendum', '/portal/onboard', '/portal/task-approval',
];

const under = (pathname: string, p: string) => pathname === p || pathname.startsWith(`${p}/`);

export function isBarePath(pathname: string): boolean {
  if (FULL_PREFIXES.some((p) => under(pathname, p))) return false;
  return BARE_PREFIXES.some((p) => under(pathname, p)) || pathname === '/portal';
}

export function activeKey(pathname: string): NavKey | null {
  if (under(pathname, '/portal/work')) return 'requests';
  return NAV.find((n) => under(pathname, n.href))?.key ?? null;
}
