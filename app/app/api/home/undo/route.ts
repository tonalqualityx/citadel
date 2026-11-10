/**
 * POST /api/home/undo: reverse one of the caller's own home-only actions, once, within 24
 * hours (plan task H7). The action id is looked up under the caller's user id, so another
 * user's id answers 404.
 */

import { NextRequest, NextResponse } from 'next/server';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { prisma } from '@/lib/db/prisma';
import { requireHomeUser } from '@/lib/home/gate';
import { homeUndoSchema, runHomeUndo } from '@/lib/home/act';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireHomeUser();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError('The request body must be JSON.', 400);
    }
    const parsed = homeUndoSchema.parse(body);

    const result = await runHomeUndo(prisma, auth.userId, parsed.action_id, new Date());
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleApiError(error);
  }
}
