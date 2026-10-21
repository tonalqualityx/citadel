import { NextResponse } from 'next/server';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { fetchAdminSoon } from '@/lib/oracle/admin-soon';

// Clarity Phase 8 (composition) — Process mode's admin-soon stage. The filter and its documentation
// live in lib/oracle/admin-soon.ts so GET /api/waits/mine reads the same list.

export async function GET() {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['admin']);
    return NextResponse.json(await fetchAdminSoon(auth.userId));
  } catch (error) {
    return handleApiError(error);
  }
}
