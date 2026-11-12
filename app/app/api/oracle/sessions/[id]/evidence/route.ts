import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { SESSION_ID_RE, SESSION_LANES, requireWorkCaller } from '@/lib/work/route-auth';
import { SESSION_EVIDENCE_MAX, SESSION_ITEM_KINDS, WINDOW_MAX_DAYS } from '@/lib/work/sessions';
import { recordSessionEvidence } from '@/lib/work/sessions-store';

/**
 * Work stage E: POST /api/oracle/sessions/:id/evidence, what a session did in its window (the close pass: --soft on compact, --final
 * on end or clear).
 *
 * Body (strict): {window: {from, to}, items: [{kind: commit | delivered_file, ref, at, repo? | path?, cwd, subject?}]}, at most 200 items.
 * `subject` (a commit's subject line, at most 300 characters) is an addition to the plan's shape: Citadel matches a commit to a task by
 * the task's short id or a title overlap of 0.5 or more, and needs the subject to do it. An item outside the window, or made outside the
 * folders of the projects the session is linked to, matches nothing. Matching is code only. Strong proof (short id named, or the task
 * names the file) makes one looks-done card per session; medium proof only writes a note on the task; no proof writes nothing. Nothing
 * is closed here. 200 {written, duplicates, outside_window, unmatched, unlinked, proofs: [{task_id, short_id, title, href, strength,
 * decision, security, lines}]}, or {skipped: "home_off"}. The oracle lane, and the owner's session.
 */
const itemSchema = z
  .object({
    kind: z.enum(SESSION_ITEM_KINDS),
    ref: z.string().min(1).max(300),
    at: z.string().datetime({ offset: true }),
    repo: z.string().max(500).nullable().optional(),
    path: z.string().max(1000).nullable().optional(),
    cwd: z.string().min(1).max(1000),
    subject: z.string().max(300).nullable().optional(),
  })
  .strict();

const bodySchema = z
  .object({
    window: z.object({ from: z.string().datetime({ offset: true }), to: z.string().datetime({ offset: true }) }).strict(),
    items: z.array(itemSchema).max(SESSION_EVIDENCE_MAX),
  })
  .strict();

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireWorkCaller(auth, SESSION_LANES);
    const { id } = await params;
    if (!SESSION_ID_RE.test(id)) throw new ApiError('Not found', 404, 'not_found');
    const body = bodySchema.parse(await request.json());
    const from = new Date(body.window.from);
    const to = new Date(body.window.to);
    if (to.getTime() < from.getTime() || to.getTime() - from.getTime() > WINDOW_MAX_DAYS * 86_400_000) throw new ApiError('The window is not a sensible span.', 400, 'bad_window');
    const out = await recordSessionEvidence(prisma, id, { window: { from, to }, items: body.items.map((i) => ({ ...i, at: new Date(i.at) })) }, new Date());
    return NextResponse.json(out);
  } catch (error) {
    return handleApiError(error);
  }
}
