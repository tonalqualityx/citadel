import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { recordResult, resultSchema } from '@/lib/secret-drops/drops';

/**
 * POST /api/secret-drops/:id/result  { ok: true, stored_where } | { ok: false, reason }
 * The machine stored the key (or says why not). The ciphertext is wiped either way; storing lifts the hold on the waiting task and closes Mike's
 * own task asking for the key.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    const { id } = await params;
    const body = resultSchema.parse(await request.json());
    return NextResponse.json(await recordResult(auth, id, body));
  } catch (error) {
    return handleApiError(error);
  }
}
