import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { readSlots } from '@/lib/portal/chat/slots';

// GET /api/tasks/:id/chat (portal phase C; staff)
// The chat on a task: state, the drafted handoff reply, jobs, runs, tool calls (arguments and totals),
// and cost. Nothing the client cannot see is hidden from staff, and nothing here is sent anywhere.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth();
    const id = z.string().uuid().safeParse((await params).id);
    if (!id.success) throw new ApiError('Not found', 404);
    const convo = await prisma.chatConversation.findUnique({ where: { task_id: id.data } });
    if (!convo) throw new ApiError('Not found', 404);
    const [jobs, calls, note, atts] = await Promise.all([
      prisma.engineJob.findMany({ where: { conversation_id: convo.id }, orderBy: { queued_at: 'asc' }, include: { runs: { orderBy: { attempt: 'asc' } } } }),
      prisma.engineToolCall.findMany({ where: { conversation_id: convo.id }, orderBy: { created_at: 'asc' }, select: { id: true, job_id: true, tool: true, args: true, row_count: true, latency_ms: true, error: true, result: true, created_at: true } }),
      prisma.comment.findFirst({ where: { task_id: id.data, is_internal: true, chat_meta: { path: ['handoff'], equals: true } }, orderBy: { created_at: 'desc' }, select: { id: true, content: true, created_at: true } }),
      prisma.portalAttachment.findMany({ where: { conversation_id: convo.id, is_deleted: false }, select: { id: true, filename: true, content_type: true, size_bytes: true } }),
    ]);
    const cost = jobs.reduce((sum, j) => sum + j.runs.reduce((s, r) => s + Number(r.cost_usd), 0), 0);
    return NextResponse.json({
      state: convo.state,
      mode: convo.mode,
      summary_version: convo.summary_version,
      slots: readSlots(convo.slots),
      open_ask: convo.open_ask,
      handoff_note: note,
      attachments: atts.map((a) => ({ id: a.id, name: a.filename, type: a.content_type, size: a.size_bytes, url: `/api/attachments/${a.id}` })),
      jobs: jobs.map((j) => ({
        id: j.id, type: j.type, status: j.status, attempts: j.attempts, queued_at: j.queued_at, finished_at: j.finished_at, gate_result: j.gate_result, action_errors: j.action_errors, error: j.error,
        runs: j.runs.map((r) => ({ id: r.id, attempt: r.attempt, model: r.model, cost_usd: Number(r.cost_usd), duration_ms: r.duration_ms, num_turns: r.num_turns, is_error: r.is_error, rejected_text: r.rejected_text })),
      })),
      tool_calls: calls.map((c) => ({ ...c, result: undefined, totals: (c.result as { totals?: unknown } | null)?.totals ?? null, label: (c.result as { label?: unknown } | null)?.label ?? null })),
      cost_usd: Number(cost.toFixed(6)),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
