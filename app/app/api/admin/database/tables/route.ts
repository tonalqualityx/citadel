import { NextResponse } from 'next/server';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { getTableGroups } from '@/lib/services/database-backup';

export async function GET() {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['admin']);

    const groups = getTableGroups();

    return NextResponse.json({ groups });
  } catch (error) {
    return handleApiError(error);
  }
}
