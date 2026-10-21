import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { requireEngine } from '@/lib/engine/auth';
import { applyResult, completeSchema } from '@/lib/portal/chat/apply';

// POST /api/engine/jobs/:id/complete { result, runs[], canned? } (portal phase C, engine scope)
// The runner's finished work. apply.ts is the only writer: it gates the reply (422 with the rule and
// the text that matched; the runner regenerates once, then posts canned:true), checks provenance,
// then applies the actions. 409 when the job is not live (expired, already done): the result is dropped.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireEngine();
    const id = z.string().uuid().safeParse((await params).id);
    if (!id.success) throw new ApiError('Not found', 404);
    const body = completeSchema.parse(await request.json());
    const out = await applyResult(id.data, body);
    if (out.status === 'expired') return NextResponse.json({ error: 'Job is not live', code: 'expired' }, { status: 409 });
    if (out.status === 'rejected') return NextResponse.json({ error: 'Reply refused by the copy gate', code: 'gate', rule: out.rule, match: out.match }, { status: 422 });
    return NextResponse.json({ applied: true, gate_result: out.gate_result, comment_id: out.comment_id });
  } catch (error) {
    return handleApiError(error);
  }
}
