import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { safeReturnPath } from '@/lib/auth/safe-return-path';

export const SILENT_REFRESH_COOKIE = 'silent_refresh';
/** Set by the proxy on page requests (never trusted from the client). */
export const PAGE_PATH_HEADER = 'x-citadel-page';

/**
 * For a layout that found no access cookie: go through /api/auth/continue once when a refresh
 * cookie exists and the browser has not just been through it, otherwise go to /login as before.
 * Never returns.
 */
export async function redirectToContinueOrLogin(): Promise<never> {
  const jar = await cookies();
  if (jar.get('refresh_token')?.value && !jar.get(SILENT_REFRESH_COOKIE)) {
    const page = safeReturnPath((await headers()).get(PAGE_PATH_HEADER));
    if (page) redirect(`/api/auth/continue?to=${encodeURIComponent(page)}`);
  }
  redirect('/login');
}
