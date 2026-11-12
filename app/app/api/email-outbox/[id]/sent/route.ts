import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { writeReceipt } from '@/lib/portal/receipts'; // Fleet item 5
import { recordChatSend } from '@/lib/portal/chat/outbox-guard';
import { OWED_REPLY_KIND, parseGovern } from '@/lib/sends/govern';
import { owedThreadKey } from '@/lib/sends/owed-reply';
import { markOwedThreadSent } from '@/lib/home/owed/rows';
import { recordSendWork } from '@/lib/work/evidence-writers'; // Work stage D

const sentSchema = z.object({
  message_id: z.string().min(1).max(255).nullable().optional(),
  rfc_message_id: z.string().min(1).max(255).nullable().optional(),
  gmail_thread_id: z.string().min(1).max(64).nullable().optional(),
});

const SCRUBBED = '[sent; body removed]';

// POST: the drain records a delivered message. Idempotent (an already-sent row returns 200).
// The body is scrubbed so a single-use login link does not stay at rest after delivery.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;

    const existing = await prisma.emailOutbox.findUnique({ where: { id }, select: { id: true, sent_at: true, message_id: true, kind: true, task_id: true, govern: true, subject: true } });
    if (!existing) throw new ApiError('Outbox row not found', 404);
    if (existing.sent_at) {
      return NextResponse.json({ id, sent_at: existing.sent_at, message_id: existing.message_id });
    }

    const body = await request.json().catch(() => ({}));
    const data = sentSchema.parse(body);

    const updated = await prisma.emailOutbox.update({
      where: { id },
      data: {
        sent_at: new Date(),
        message_id: data.message_id ?? null,
        rfc_message_id: data.rfc_message_id ?? null,
        gmail_thread_id: data.gmail_thread_id ?? null,
        last_error: null,
        text: SCRUBBED,
        html: null,
      },
    });
    if (existing.kind === 'portal_chat' && existing.task_id) {
      await recordChatSend(existing.task_id, data.message_id ?? null, data.gmail_thread_id ?? null);
    }
    if (existing.kind === OWED_REPLY_KIND) {
      // Home Slice 4b: the home screen's line turns from "Sending" to "Sent" by itself (it reads this row); the thread's owed row stops being a draft.
      const g = parseGovern(existing.govern);
      if (g?.intent === 'owed_reply') {
        await markOwedThreadSent(prisma, g.user_id, owedThreadKey(g)).catch((e: unknown) => console.error('owed sent mark failed', e));
      }
    }
    if (existing.task_id) {
      // Fleet item 5: a delivered mail is a step in the task's trail. The receipt never fails the sent call.
      await writeReceipt({
        task_id: existing.task_id, step: 'send', outbox_ids: [id],
        message_ids: [data.message_id, data.rfc_message_id].filter((m): m is string => Boolean(m)),
        actor_user_id: auth.userId,
      }).catch((e: unknown) => console.error('send receipt failed', e));
    }
    if (existing.task_id && updated.sent_at) {
      // Work stage D: the send attaches to the task it names and is recorded as evidence (best effort; it never fails the sent call).
      // TODO(stage-c): the send door (lib/sends/lanes.ts) and POST /api/sends/record replace this hook; until Stage C is merged this is the only place a send is seen.
      await recordSendWork(prisma, { outbox_id: id, task_id: existing.task_id, subject: existing.subject, sent_at: updated.sent_at });
    }
    return NextResponse.json({ id, sent_at: updated.sent_at, message_id: updated.message_id });
  } catch (error) {
    return handleApiError(error);
  }
}
