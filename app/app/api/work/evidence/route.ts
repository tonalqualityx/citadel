import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { EVIDENCE_BATCH_MAX, EVIDENCE_KINDS, recordEvidence } from '@/lib/work/evidence';
import { WORK_KINDS, parseTargetKey } from '@/lib/work/keys';
import { EVIDENCE_LANES, requireWorkCaller } from '@/lib/work/route-auth';

/**
 * Work stage D: POST /api/work/evidence, what a source saw about a piece of work. Written by code paths only (the courier and the send door,
 * receipts, the classifier, calendar sync, the reconciler, the session close pass, the worker ledger).
 *
 * Body (strict): {items: [{kind, ref, at, line, href?, source, target_key? | from: {kind, ref}}]}, at most 100. Each item names where it
 * belongs (target_key) or the source it came from (its active links are the targets). One line of plain words, at most 300 characters;
 * no mail text. Idempotent: the same fact twice is one row. 200 {written, duplicates, unattached}. The bast, courier, porter and oracle
 * lanes, and the owner's session. Nothing here changes a task, a project or a link.
 */
const itemSchema = z
  .object({
    kind: z.enum(EVIDENCE_KINDS),
    ref: z.string().min(1).max(300),
    at: z.string().datetime(),
    line: z.string().min(1).max(300),
    href: z.string().max(1000).nullable().optional(),
    source: z.string().min(1).max(30),
    target_key: z.string().refine((k) => parseTargetKey(k) !== null, 'A target key is project:<id> or task:<id>').optional(),
    from: z.object({ kind: z.enum(WORK_KINDS), ref: z.string().min(1).max(300) }).strict().optional(),
  })
  .strict()
  .refine((i) => (i.target_key !== undefined) !== (i.from !== undefined), { message: 'Send target_key or from, not both and not neither.' });

const bodySchema = z.object({ items: z.array(itemSchema).min(1).max(EVIDENCE_BATCH_MAX) }).strict();

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireWorkCaller(auth, EVIDENCE_LANES);
    const body = bodySchema.parse(await request.json());
    const out = await recordEvidence(prisma, body.items.map((i) => ({ ...i, at: new Date(i.at), from: i.from ?? null, target_key: i.target_key ?? null })));
    return NextResponse.json(out);
  } catch (error) {
    return handleApiError(error);
  }
}
