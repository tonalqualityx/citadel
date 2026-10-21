import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api/errors';
import { requireClientAuth } from '@/lib/services/client-auth';
import { loadPortalAccess } from '@/lib/portal/access';
import { loadHistory, parsePagination } from '@/lib/portal/history';

// GET /api/portal/history?page=1&page_size=20 (portal MVP A5)
// Completed client-visible tasks and published articles across the ACTIVE client, newest first.
// Visibility is the A1 history rule; project scope is the A3 rule. The payload is an allow-list:
// type, id, title, optional url, project name, and a date.
export async function GET(request: NextRequest) {
  try {
    const session = await requireClientAuth();
    const access = await loadPortalAccess(session);
    const { page, pageSize } = parsePagination(new URL(request.url).searchParams);
    const { items, hasMore } = await loadHistory(access, { page, pageSize });
    return NextResponse.json({ items, page, page_size: pageSize, has_more: hasMore });
  } catch (error) {
    return handleApiError(error);
  }
}
