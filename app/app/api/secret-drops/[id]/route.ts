import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { machineView } from '@/lib/secret-drops/drops';

/** GET /api/secret-drops/:id  The machine reads a drop: its status, and the ciphertext while it is received and not yet stored. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    const { id } = await params;
    return NextResponse.json(await machineView(auth, id), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleApiError(error);
  }
}
