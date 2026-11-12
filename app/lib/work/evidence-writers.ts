/**
 * Work stage D: the code paths that write evidence, in one place so each is small and none can fail the thing it watches.
 *
 *   recordSendWork     a delivered mail that names a task: attaches the send to that task and records it as evidence. Called when the courier
 *                      marks a row sent. TODO(stage-c): when Stage C lands, the send door (lib/sends/lanes.ts) and POST /api/sends/record call
 *                      this same function with the lane and the real From and Reply-To, and answered_since reads the same rows.
 *   syncSendEvidence   the same, read from the email_outbox rows already on file (sent, not dropped, naming a task). Idempotent: the nightly
 *                      keeper step and the Thermalnetics walk call it. This is the "read from what exists today" path until Stage C.
 *   recordReceiptEvidence  a task receipt (staged, approved, live) as a deploy, a client_approval or a live row.
 *   recordMeetingEvidence  a calendar event that has ended and is attached to work: meeting_held.
 *   recordMikeQuoteEvidence  the reconciler found his own sent words about a task.
 *
 * Every function is best effort (it swallows and logs): evidence never turns a send, a receipt or a sync into an error. None of them
 * changes a task, a project or the mail; the only rows written are work_link (a send) and work_evidence.
 */

import type { HomeDb } from '@/lib/home/state';
import { displayText } from '@/lib/home/copy';
import { shortDate } from './copy';
import { recordEvidence, type EvidenceItem } from './evidence';
import { attachSource } from './links';
import { targetKeyOf } from './keys';

const safe = async <T>(label: string, fn: () => Promise<T>): Promise<T | null> => {
  try {
    return await fn();
  } catch (e) {
    console.error(`work evidence: ${label} failed`, e);
    return null;
  }
};

export interface SendFacts {
  outbox_id: string;
  task_id: string;
  subject: string | null;
  sent_at: Date;
  /** Reserved for Stage C (the send lane). Not read today. */
  lane?: string | null;
}

export async function recordSendWork(db: HomeDb, s: SendFacts): Promise<void> {
  await safe('send', async () => {
    const target = targetKeyOf('task', s.task_id);
    // A send for a task that is finished or gone attaches nowhere; the receipt on the task already shows it.
    const label = displayText(s.subject ?? '') || 'A message';
    const res = await attachSource(db, { kind: 'send', ref: s.outbox_id, label, target_key: target, attached_by: 'auto', basis: 'outbox_task', now: s.sent_at }).catch(() => null);
    if (!res) return;
    await recordEvidence(db, [{ kind: 'send', ref: s.outbox_id, at: s.sent_at, line: `Bast sent "${label}" on ${shortDate(s.sent_at)}.`, source: 'courier', target_key: target }]);
  });
}

/** The outbox rows on file that name a task and were delivered since `since`: link and evidence, once each. Returns how many it looked at. */
export async function syncSendEvidence(db: HomeDb, since: Date, take = 200): Promise<number> {
  const rows = await db.emailOutbox.findMany({
    where: { task_id: { not: null }, sent_at: { gte: since }, superseded_at: null },
    select: { id: true, task_id: true, subject: true, sent_at: true },
    orderBy: { sent_at: 'asc' },
    take,
  });
  for (const r of rows) if (r.task_id && r.sent_at) await recordSendWork(db, { outbox_id: r.id, task_id: r.task_id, subject: r.subject, sent_at: r.sent_at });
  return rows.length;
}

const RECEIPT_KIND: Record<string, { kind: EvidenceItem['kind']; line: (at: Date, live: string | null) => string } | undefined> = {
  staged: { kind: 'deploy', line: (at) => `A preview was deployed on ${shortDate(at)}.` },
  approved: { kind: 'client_approval', line: (at) => `The client approved it on ${shortDate(at)}.` },
  live: { kind: 'live', line: (at, live) => `It went live on ${shortDate(at)}${live ? `: ${live}` : ''}.` },
};

export async function recordReceiptEvidence(db: HomeDb, r: { id?: string; task_id: string; step: string; deploy_id?: string | null; live_url?: string | null; deploy_url?: string | null; preview_url?: string | null; created_at?: Date }): Promise<void> {
  const map = RECEIPT_KIND[r.step];
  if (!map) return;
  await safe('receipt', async () => {
    const at = r.created_at ?? new Date();
    const href = r.live_url ?? r.deploy_url ?? r.preview_url ?? null;
    await recordEvidence(db, [{ kind: map.kind, ref: r.deploy_id ?? r.id ?? `${r.task_id}:${r.step}`, at, line: map.line(at, r.live_url ?? null), href, source: 'receipts', target_key: targetKeyOf('task', r.task_id) }]);
  });
}

export async function recordMeetingEvidence(db: HomeDb, ev: { event_id: string; title: string; ends_at: Date }, now: Date): Promise<void> {
  if (ev.ends_at.getTime() > now.getTime()) return;
  await safe('meeting', async () => {
    await recordEvidence(db, [{ kind: 'meeting_held', ref: ev.event_id, at: ev.ends_at, line: `The meeting "${displayText(ev.title) || 'Meeting'}" was held on ${shortDate(ev.ends_at)}.`, source: 'calendar', from: { kind: 'calendar', ref: ev.event_id } }]);
  });
}

export async function recordMikeQuoteEvidence(db: HomeDb, q: { task_id: string; message_key: string; at: Date; href?: string | null }): Promise<void> {
  await safe('mike_quote', async () => {
    await recordEvidence(db, [{ kind: 'mike_quote', ref: q.message_key, at: q.at, line: `Your own sent mail of ${shortDate(q.at)} speaks of this work.`, href: q.href ?? null, source: 'reconciler', target_key: targetKeyOf('task', q.task_id) }]);
  });
}
