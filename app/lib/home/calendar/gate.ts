/**
 * Home screen Slice 10a: who may read the calendar routes. Everything requireHomeUser asks
 * (a signed-in browser session, an admin, home view on), and the session user's own address
 * must be the calendar's owner: CalendarEvent has no user column, so the check is the
 * address. There is no user id parameter anywhere.
 */

import { requireHomeUser } from '../gate';
import type { AuthPayload } from '@/lib/auth/middleware';
import { AuthError } from '@/lib/api/errors';
import { CALENDAR_OWNER_EMAIL } from './rules';

export function isCalendarOwnerEmail(email: string | null | undefined): boolean {
  return (email ?? '').trim().toLowerCase() === CALENDAR_OWNER_EMAIL;
}

export async function requireCalendarOwner(): Promise<AuthPayload> {
  const auth = await requireHomeUser();
  if (!isCalendarOwnerEmail(auth.email)) {
    throw new AuthError('This calendar is not available for this user', 403);
  }
  return auth;
}
