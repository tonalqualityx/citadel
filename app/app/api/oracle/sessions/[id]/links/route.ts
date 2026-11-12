import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { parseTargetKey } from '@/lib/work/keys';
import { SESSION_ID_RE, SESSION_LANES, attachedByFor, requireWorkCaller } from '@/lib/work/route-auth';
import { saveSessionLink } from '@/lib/work/sessions-store';

/**
 * Work stage E: POST /api/oracle/sessions/:id/links, attach a session (by its external id) to the work its folder belongs to.
 *
 * Body (strict): {target_key | propose: true, cwd, basis?, repo_remote?, client_id?, label?, one_deliverable?}.
 *  - target_key (project:<id> or task:<id>): attach there. A finished project or task is refused (409 target_finished).
 *  - propose: true: Citadel works out the candidates from the cwd (plan_folder, site repo, Wright client folder, a folder choice the
 *    owner made before). A clear match attaches quietly with a Handled line and Undo; anything else is ONE question for the session
 *    (one question row per session) with a link on each candidate. A session that works in a second project gets its own link: the
 *    folder is judged on its own.
 * `basis` is the machine's own note and is not trusted. 200 {result: attached | already | proposed | dismissed | none | skipped, ...}
 * (the same answer as POST /api/work/attach). The oracle lane, and the owner's session. Never closes, deletes or sends anything.
 */
const bodySchema = z
  .object({
    target_key: z.string().refine((k) => parseTargetKey(k) !== null, 'A target key is project:<id> or task:<id>').optional(),
    propose: z.literal(true).optional(),
    cwd: z.string().max(1000).nullable().optional(),
    basis: z.string().max(40).nullable().optional(),
    repo_remote: z.string().max(500).nullable().optional(),
    client_id: z.string().uuid().nullable().optional(),
    label: z.string().max(300).nullable().optional(),
    one_deliverable: z.boolean().optional(),
  })
  .strict()
  .refine((b) => (b.target_key !== undefined) !== (b.propose === true), { message: 'Send target_key, or propose: true, not both and not neither.' });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireWorkCaller(auth, SESSION_LANES);
    const { id } = await params;
    if (!SESSION_ID_RE.test(id)) throw new ApiError('Not found', 404, 'not_found');
    const body = bodySchema.parse(await request.json());
    const out = await saveSessionLink(prisma, { ref: id, ...body, attached_by: attachedByFor(auth) });
    return NextResponse.json(out);
  } catch (error) {
    return handleApiError(error);
  }
}
