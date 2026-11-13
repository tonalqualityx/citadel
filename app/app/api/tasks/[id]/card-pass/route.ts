import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { serializePass } from '@/lib/engagement/serialize';
import { isDoxLane, loadCardForPass } from '@/lib/dox/guard';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bodySchema = z.object({ mode: z.enum(['dry', 'live']).optional(), model: z.string().max(80).optional() }).strict();

/**
 * POST /api/tasks/[id]/card-pass: Dox opens a CARD PASS on one released card that has no project (an ad hoc task, a tool, a rule, a question). Passes normally
 * hang off a project's brief, so a card with no project could never be worked; a card pass hangs off the card (EngagementPass.task_id, brief_id null).
 * The Dox lane only. The card must be released from Triage (tag from-triage), assigned to Dox, not_started or in_progress, with no project and not deleted.
 * The pass is live unless `mode: dry` is asked: Mike's release of the card is the yes, so there is no brief whose owner_mode could say otherwise. A dry pass
 * writes nothing (every Dox write to the card checks for a live one). Once the card has a project the project's own brief and pass take over.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    if (!isDoxLane(auth)) throw new ApiError('Only Dox opens a card pass.', 403, 'card_pass_forbidden');
    const { id } = await params;
    if (!UUID.test(id)) throw new ApiError('Bad id', 400);
    const raw = await request.text();
    const body = bodySchema.parse(raw.trim() ? JSON.parse(raw) : {});
    const task = await prisma.task.findFirst({ where: { id, is_deleted: false }, select: { id: true } });
    if (!task) throw new ApiError('Task not found', 404);
    const card = await loadCardForPass(prisma, id);
    if (!card) {
      throw new ApiError('A card pass needs a card released from Triage, assigned to Dox, not finished, with no project. A card with a project is worked through the project\'s brief.', 409, 'card_not_passable');
    }
    const row = await prisma.engagementPass.create({
      data: { brief_id: null, task_id: card.id, mode: body.mode ?? 'live', kind: 'setup', model: body.model ?? null, lane: auth.lane ? auth.lane.slice(0, 40) : null },
    });
    return NextResponse.json(serializePass(row), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
