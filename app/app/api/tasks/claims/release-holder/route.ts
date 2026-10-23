import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { releaseHolder } from '@/lib/tasks/claims';

const bodySchema = z.object({ holder: z.string().trim().min(1).max(200) });

// POST /api/tasks/claims/release-holder - release every claim one holder owns (the worker's cleanup trap).
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const body = bodySchema.parse(await request.json());
    const released = await releaseHolder({ holder: body.holder });
    return NextResponse.json({ released });
  } catch (error) {
    return handleApiError(error);
  }
}
