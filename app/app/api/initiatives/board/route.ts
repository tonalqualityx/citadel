import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { loadInitiativeBoard } from '@/lib/initiatives/board';

// GET /api/initiatives/board - everything the Initiatives screen shows, in focus order (design.md 3.1)
export async function GET() {
  try {
    await requireAuth();
    return NextResponse.json(await loadInitiativeBoard());
  } catch (error) {
    return handleApiError(error);
  }
}
