import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { renewHolder } from '@/lib/tasks/claims';

const bodySchema = z.object({ holder: z.string().trim().min(1).max(200), ttl_seconds: z.number().int().optional().nullable() });

// POST /api/tasks/claims/renew-holder - extend every live lease one holder owns (the worker's background renewer).
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const body = bodySchema.parse(await request.json());
    const renewed = await renewHolder({ holder: body.holder, ttlSeconds: body.ttl_seconds });
    return NextResponse.json({ renewed });
  } catch (error) {
    return handleApiError(error);
  }
}
