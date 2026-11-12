import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { attachOrPropose } from '@/lib/work/attach-store';
import { WORK_KINDS, parseTargetKey } from '@/lib/work/keys';
import { ATTACH_LANES, attachedByFor, requireWorkCaller } from '@/lib/work/route-auth';

/**
 * Work stage D: POST /api/work/attach, attach a source (an email conversation, a session, a send, a deploy, a commit, a calendar event, a
 * wait, a folder) to a piece of work, or propose it.
 *
 * Body (strict): {kind, ref, label?, target_key? | propose: true, candidates?, client_id?, cwd?, repo_remote?, one_deliverable?}.
 *  - target_key: attach there. Refused (409 already_attached) when the source is on other work, and (409 target_finished) when the
 *    target is a done or cancelled project or a done or abandoned task.
 *  - propose: true: Citadel works out the candidates itself. A clear match (exactly one candidate, basis same_conversation, plan_folder or
 *    prior_choice) attaches quietly with a Handled line and Undo. Anything else is ONE question on the owner's home screen with a link on
 *    each candidate. `candidates` (target keys, live ones only) narrows the choice and always makes a question.
 *    `one_deliverable: true` offers "Just a task" on the question; the default (false) offers only candidates, New project and Not work.
 * 200 {result: attached | already | proposed | dismissed | none | skipped, ...}. skipped means no home owner is on the home view and
 * nothing was written. The owner's session, or the porter, oracle and bast-chat lanes.
 */
const bodySchema = z
  .object({
    kind: z.enum(WORK_KINDS),
    ref: z.string().min(1).max(300),
    label: z.string().max(300).nullable().optional(),
    target_key: z.string().refine((k) => parseTargetKey(k) !== null, 'A target key is project:<id> or task:<id>').optional(),
    propose: z.literal(true).optional(),
    candidates: z.array(z.string().refine((k) => parseTargetKey(k) !== null)).max(8).optional(),
    client_id: z.string().uuid().nullable().optional(),
    cwd: z.string().max(1000).nullable().optional(),
    repo_remote: z.string().max(500).nullable().optional(),
    one_deliverable: z.boolean().optional(),
  })
  .strict()
  .refine((b) => (b.target_key !== undefined) !== (b.propose === true), { message: 'Send target_key, or propose: true, not both and not neither.' });

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireWorkCaller(auth, ATTACH_LANES);
    const body = bodySchema.parse(await request.json());
    const out = await attachOrPropose(prisma, { ...body, attached_by: attachedByFor(auth) });
    return NextResponse.json(out);
  } catch (error) {
    return handleApiError(error);
  }
}
