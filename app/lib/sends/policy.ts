/**
 * The mode switches around recheckSend (Fleet item 4): AppSettings.send_recheck_mode (off | shadow |
 * enforce, default enforce) and send_recheck_heuristics (shadow | enforce, default shadow). Every
 * decision is logged as one JSON line; every real drop leaves one internal comment on the governing task
 * (at most one per task per intent per day).
 */
import { prisma } from '@/lib/db/prisma';
import { BAST_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { governTaskId, type Govern } from './govern';
import { recheckSend, type Severity } from './recheck';

export type RecheckMode = 'off' | 'shadow' | 'enforce';

export interface SendDecision {
  ok: boolean;
  reason?: string;
  severity?: Severity;
  mode: RecheckMode;
  /** Shadow only: what enforce would have done. */
  would_drop?: { reason: string; severity: Severity };
}

export async function recheckSettings(): Promise<{ mode: RecheckMode; heuristics: 'shadow' | 'enforce' }> {
  const s = await prisma.appSettings.findUnique({ where: { id: 'singleton' }, select: { send_recheck_mode: true, send_recheck_heuristics: true } });
  const mode = s?.send_recheck_mode === 'off' || s?.send_recheck_mode === 'shadow' ? s.send_recheck_mode : 'enforce';
  const heuristics = s?.send_recheck_heuristics === 'enforce' ? 'enforce' : 'shadow';
  return { mode, heuristics };
}

export const dropCommentPrefix = (intent: string) => `Send dropped (${intent})`;

/** One internal comment per task per intent per UTC day. Never throws. */
async function noteDrop(govern: Govern, reason: string, ref: string | null): Promise<void> {
  try {
    const taskId = governTaskId(govern);
    if (!taskId) return;
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const prefix = dropCommentPrefix(govern.intent);
    const existing = await prisma.comment.findFirst({ where: { task_id: taskId, is_internal: true, created_at: { gte: dayStart }, content: { startsWith: prefix } }, select: { id: true } });
    if (existing) return;
    await prisma.comment.create({
      data: {
        task_id: taskId,
        user_id: BAST_USER_ID,
        is_internal: true,
        client_visible: false,
        content: `${prefix}: the send was checked against the task just before it went out and held back (${reason}).${ref ? ` Reference: ${ref}.` : ''} Nothing reached the client.`,
      },
    });
  } catch (error) {
    console.error('send recheck: could not write the drop comment', error);
  }
}

/** Run the recheck under the current mode and log the decision. `ref` is an outbox or approval id for the log. */
export async function decideSend(govern: Govern, ref: string | null = null, opts: { probe?: boolean } = {}): Promise<SendDecision> {
  const { mode, heuristics } = await recheckSettings();
  if (mode === 'off') return { ok: true, mode };
  const r = await recheckSend(govern);
  let decision: SendDecision;
  if (r.ok) {
    decision = { ok: true, mode };
  } else {
    const enforced = mode === 'enforce' && (r.severity === 'definitive' || heuristics === 'enforce');
    decision = enforced
      ? { ok: false, reason: r.reason, severity: r.severity, mode }
      : { ok: true, mode, would_drop: { reason: r.reason, severity: r.severity } };
  }
  console.log(JSON.stringify({ event: 'send_recheck', intent: govern.intent, ref, mode, ok: decision.ok, reason: decision.reason ?? decision.would_drop?.reason ?? null, severity: decision.severity ?? decision.would_drop?.severity ?? null, shadow: Boolean(decision.would_drop) }));
  if (!decision.ok && decision.reason && !opts.probe) await noteDrop(govern, decision.reason, ref);
  return decision;
}
