/**
 * GET and POST /api/home/learned: what the home screen learned (Slice 7b), for the signed-in caller only.
 * Browser session only: requireHomeUser answers 403 to an API key and to the chat, so nothing but Mike's own press here
 * can put a weight back or switch learning. (The chat can only undo a Learned line, through the existing undo.)
 *
 * GET -> `{on, items: [{evidence_key, sentence, since}]}`. Sentences only: no weight or percent leaves the server.
 * POST, strict body, one of `{action: 'put_back', evidence_key}` or `{action: 'learning', on: boolean}`
 *   -> `{ok, on, items, action_id?, undo_until?}`. Put back sets the weight to 100 and holds it 30 days.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { prisma } from '@/lib/db/prisma';
import { resolveUserTimezone } from '@/lib/services/user-timezone';
import { requireHomeUser } from '@/lib/home/gate';
import { listLearned } from '@/lib/home/learn/learned';
import { learningOn, putBack, setLearning } from '@/lib/home/learn/weights-store';

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('put_back'), evidence_key: z.string().min(3).max(200) }).strict(),
  z.object({ action: z.literal('learning'), on: z.boolean() }).strict(),
]);

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET() {
  try {
    const auth = await requireHomeUser();
    const timezone = await resolveUserTimezone(auth.userId);
    const [on, items] = await Promise.all([learningOn(prisma, auth.userId), listLearned(prisma, auth.userId, timezone)]);
    return NextResponse.json({ on, items }, { headers: NO_STORE });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireHomeUser();
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError('The request body must be JSON.', 400);
    }
    const parsed = bodySchema.parse(body);
    const now = new Date();
    const timezone = await resolveUserTimezone(auth.userId);
    let extra: { action_id?: string; undo_until?: string } = {};
    if (parsed.action === 'put_back') {
      extra = await putBack(prisma, auth.userId, parsed.evidence_key, now);
    } else {
      await setLearning(prisma, auth.userId, parsed.on);
    }
    const [on, items] = await Promise.all([learningOn(prisma, auth.userId), listLearned(prisma, auth.userId, timezone)]);
    return NextResponse.json({ ok: true, on, items, ...extra }, { headers: NO_STORE });
  } catch (error) {
    return handleApiError(error);
  }
}
