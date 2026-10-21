/**
 * The write guard for view-as sessions. EVERY write route (POST, PATCH, PUT, DELETE) under
 * app/api/portal and app/api/portal-chat calls this as its first statement:
 *
 *   const viewAsRefusal = await refuseIfViewAs();
 *   if (viewAsRefusal) return viewAsRefusal;
 *
 * It looks at the portal session cookie only. A request with no cookie (the email engine, a token
 * link, a staff call with a bearer key) costs nothing. A cookie that belongs to a view-as session
 * row, live or not, is refused with 403 and a plain line. It fails closed: if the lookup itself
 * errors the request is refused. lib/portal/__tests__/view-as-routes.test.ts derives the list of
 * write routes from the filesystem and fails if one is missing the call.
 */
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { VIEW_AS_ACTION } from '@/lib/portal/view-as';
import { VIEW_AS_READ_ONLY_LINE } from '@/lib/portal/view-as-copy';

const CLIENT_SESSION_COOKIE_NAME = 'client_session';

export function viewAsRefusedResponse(): NextResponse {
  return NextResponse.json({ error: VIEW_AS_READ_ONLY_LINE, code: 'view_as_read_only' }, { status: 403 });
}

export async function refuseIfViewAs(): Promise<NextResponse | null> {
  try {
    const token = (await cookies()).get(CLIENT_SESSION_COOKIE_NAME)?.value;
    if (!token) return null;
    const row = await prisma.portalSession.findFirst({
      where: { session_token: token, action: VIEW_AS_ACTION },
      select: { id: true },
    });
    return row ? viewAsRefusedResponse() : null;
  } catch (error) {
    console.error('view-as guard lookup failed, refusing the write:', error);
    return viewAsRefusedResponse();
  }
}
