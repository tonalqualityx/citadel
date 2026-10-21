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
  '/portal/history', '/portal/book', '/portal/articles', '/portal/select',
];

/**
 * The token pages (proposal, contract, MSA, addendum, onboarding, task approval) also open for
 * someone with no session, so they are bare until /api/portal/clients answers 200.
 */
const TOKEN_PREFIXES = [
  '/portal/proposal', '/portal/contract', '/portal/msa', '/portal/addendum', '/portal/onboard', '/portal/task-approval',
];

const under = (pathname: string, p: string) => pathname === p || pathname.startsWith(`${p}/`);

/** Mike 2026-10-21 15:20: only the sign-in pages (and the /portal redirect) never carry the nav. */
export function isSignInPath(pathname: string): boolean {
  return pathname === '/portal' || under(pathname, '/portal/login');
}

export function isTokenPath(pathname: string): boolean {
  return TOKEN_PREFIXES.some((p) => under(pathname, p));
}

/** True when the page is the sign-in frame; token pages are bare only while no session is confirmed. */
export function isBarePath(pathname: string, sessionConfirmed = false): boolean {
  if (isSignInPath(pathname)) return true;
  if (isTokenPath(pathname)) return !sessionConfirmed;
  return !FULL_PREFIXES.some((p) => under(pathname, p)) && !sessionConfirmed;
}

export function activeKey(pathname: string): NavKey | null {
  if (under(pathname, '/portal/work')) return 'requests';
  return NAV.find((n) => under(pathname, n.href))?.key ?? null;
}
