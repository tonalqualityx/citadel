/**
 * POST /api/home/rule: Mike's "Not an emergency" press on an outside signal (a crisis mail or a site down row),
 * saved as a rule. Browser session only (requireHomeUser refuses an API key with 403), so the chat can never make one.
 *
 * Body `{item_key, scope: 'sender'|'domain'|'site', reason?: string (300 at most)}`, strict.
 * 200 `{ok, action_id, undo_until, item_key, rule: {key, kind, value, revision, line}, message}`.
 * 400 for a task item ("A security flag is never turned into a rule."), a free-mail or own-domain domain scope, or a
 * scope the item does not offer; 404 when the item is gone. Undo goes through /api/home/undo (rule actions, 7 days).
 */

import { NextRequest, NextResponse } from 'next/server';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { prisma } from '@/lib/db/prisma';
import { requireHomeUser } from '@/lib/home/gate';
import { ruleBodySchema, saveNotEmergencyRule } from '@/lib/home/emergency/store';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireHomeUser();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError('The request body must be JSON.', 400);
    }
    const parsed = ruleBodySchema.parse(body);
    const result = await saveNotEmergencyRule(prisma, auth.userId, parsed, new Date());
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleApiError(error);
  }
}
