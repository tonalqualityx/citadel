import { NextResponse } from 'next/server';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { syncEngineRows } from '@/lib/recurring-work/engine-sync';

// POST /api/recurring-work/engine-sync - reconcile the engine rows with the Troubador schedules and maintenance plans
export async function POST() {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    return NextResponse.json(await syncEngineRows());
  } catch (error) {
    return handleApiError(error);
  }
}
