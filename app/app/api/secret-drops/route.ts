import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { mintDrop, mintSchema } from '@/lib/secret-drops/drops';

/**
 * POST /api/secret-drops  { key_name, label?, task_id?, mike_task_id?, public_key, expires_in_minutes?, replaces_existing? }
 * A one-time link Mike pastes a key into (lib/secret-drops/drops.ts). Mike, or the Bast machine (worker key or front session).
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    const body = mintSchema.parse(await request.json());
    const base = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
    return NextResponse.json(await mintDrop(auth, body, base), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
