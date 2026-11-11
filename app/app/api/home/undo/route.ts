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
import { RULE_ACTION } from '@/lib/home/emergency/copy';
import { undoNotEmergencyRule } from '@/lib/home/emergency/store';
import { getHomeAction } from '@/lib/home/state';
import { cancelOwedSend, OWED_SEND_ACTION } from '@/lib/home/owed/send';

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

    const now = new Date();
    // Slice 6a: a saved rule has its own undo (it retracts the Decision, compare and set). Browser session only: this route
    // refuses an API key already, and the chat's home op goes through runHomeUndo, which refuses a rule action.
    const row = await getHomeAction(prisma, auth.userId, parsed.action_id);
    if (row?.action === RULE_ACTION) {
      const undone = await undoNotEmergencyRule(prisma, auth.userId, parsed.action_id, now);
      return NextResponse.json({ ok: true, action_id: parsed.action_id, item_key: undone.item_key }, { headers: { 'Cache-Control': 'no-store' } });
    }
    // Slice 4b: a press on "Send the draft" is undone here only (it cancels the held outbox row, compare and set). runHomeUndo
    // refuses it for every other caller, the chat included.
    if (row?.action === OWED_SEND_ACTION) {
      const cancelled = await prisma.$transaction((tx) => cancelOwedSend(tx, auth.userId, parsed.action_id, now));
      return NextResponse.json(cancelled, { headers: { 'Cache-Control': 'no-store' } });
    }
    // Slice 9a: `wrong` ("This was wrong") is allowed only on a line the sent-mail reconciler wrote; runHomeUndo refuses it on any other row.
    const result = await runHomeUndo(prisma, auth.userId, parsed.action_id, now, { wrong: parsed.wrong === true });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleApiError(error);
  }
}
