/**
 * Inbound placement events (the W6 contract, specs/citadel-shape-SPEC.md 2.8 and
 * specs/inbound-placement-SPEC.md section 9). One endpoint, four kinds:
 *
 *   place        attach the thread and chain to a wait
 *   stop         the client answered, booked, signed or decided: close the clock
 *   extend       out of office, need more time, or a named day: move the date
 *   needs_human  the machine cannot tell: a person decides
 *
 * Idempotent on `event_id`: a replay changes nothing. Extensions stop at two per wait or 15
 * business days in total; the next one becomes needs_human. An auto-reply extends each wait once.
 * Phase 1 only acts on waits that exist; opening review waits from the placement side is phase 2.
 */

import { z } from 'zod';
import {
  extendWait,
  needsHuman,
  resolveByPerson,
} from './actions';
import { getTemplate } from './templates';
import type { SweepStore, WaitRow } from './sweeper';

export const EVENT_KINDS = ['place', 'stop', 'extend', 'needs_human'] as const;

const uuid = z.string().uuid();

export const eventSchema = z.object({
  event_id: z.string().min(1).max(200),
  kind: z.enum(EVENT_KINDS),
  at: z.string().datetime({ offset: true }).optional(),
  source: z.union([z.string().max(500), z.record(z.string(), z.unknown())]).optional(),
  chain: z
    .object({
      kind: z.enum(['accord', 'project', 'charter', 'site', 'client', 'none']),
      id: uuid.nullable().optional(),
      client_id: uuid.nullable().optional(),
    })
    .optional(),
  target: z
    .union([
      uuid,
      z.object({ wait_id: uuid }),
      z.object({
        wait_kinds: z.array(z.enum(['approval', 'clock', 'handoff', 'meeting', 'external', 'switch'])).max(6).optional(),
        contact_id: uuid.optional(),
        thread_id: z.string().max(255).optional(),
        template_key: z.string().max(80).optional(),
      }),
    ])
    .optional(),
  payload: z
    .object({
      reason: z.string().max(80).optional(),
      mode: z.enum(['days', 'until']).optional(),
      business_days: z.number().int().min(1).max(15).optional(),
      until: z.string().datetime({ offset: true }).optional(),
      auto_reply: z.boolean().optional(),
      quote: z.string().max(2000).optional(),
      question: z.string().max(2000).optional(),
      candidates: z.array(z.unknown()).max(20).optional(),
      suggestion: z.string().max(2000).optional(),
      owner_role: z.string().max(40).optional(),
      owner_user_id: uuid.optional(),
      thread_id: z.string().max(255).optional(),
      account: z.string().max(255).optional(),
      email_message_id: z.string().max(255).optional(),
    })
    .optional(),
});

export type WaitEventPayload = z.infer<typeof eventSchema>;

export interface EventTarget {
  wait_id?: string;
  project_id?: string;
  accord_id?: string;
  charter_id?: string;
  site_id?: string;
  client_id?: string;
  contact_id?: string;
  thread_id?: string;
  wait_kinds?: string[];
  template_key?: string;
}

export interface EventsStore extends SweepStore {
  /** Has this exact (event, wait) pair been applied? Exact match on `${event_id}:${wait_id}`. */
  eventSeenForWait(eventId: string, waitId: string): Promise<boolean>;
  /** Open waits matching the target. */
  findTargets(target: EventTarget): Promise<WaitRow[]>;
  /** Prior auto-reply extensions on one wait. */
  countAutoExtensions(waitId: string): Promise<number>;
}

export interface EventResult {
  event_id: string;
  duplicate: boolean;
  matched: number;
  applied: Array<{ wait_id: string; action: string; detail?: string }>;
}

const STOP_RESOLUTIONS: Record<string, string> = {
  reply: 'stopped_by_reply',
  question: 'stopped_by_reply',
  booking: 'booked',
  signature: 'signed',
  approval: 'approved',
  decline: 'declined',
  changes: 'changes_requested',
};

export function targetFromEvent(ev: WaitEventPayload): EventTarget {
  const t: EventTarget = {};
  const target = ev.target;
  if (typeof target === 'string') t.wait_id = target;
  else if (target && 'wait_id' in target) t.wait_id = target.wait_id;
  else if (target) {
    t.wait_kinds = target.wait_kinds;
    t.contact_id = target.contact_id;
    t.thread_id = target.thread_id;
    t.template_key = target.template_key;
  }
  if (!t.wait_id) {
    const c = ev.chain;
    if (c?.id) {
      if (c.kind === 'accord') t.accord_id = c.id;
      if (c.kind === 'project') t.project_id = c.id;
      if (c.kind === 'charter') t.charter_id = c.id;
      if (c.kind === 'site') t.site_id = c.id;
      if (c.kind === 'client') t.client_id = c.id;
    } else if (c?.client_id) {
      t.client_id = c.client_id;
    }
    // For `place` the thread is what gets attached, never what selects.
    if (ev.kind !== 'place' && !t.thread_id && ev.payload?.thread_id) t.thread_id = ev.payload.thread_id;
  }
  return t;
}

/** Stored as the marker row's event_id; unique, so a concurrent replay cannot apply twice. */
export const eventKey = (eventId: string, waitId: string) => `${eventId}:${waitId}`;

const isUniqueViolation = (e: unknown) => !!e && typeof e === 'object' && (e as { code?: string }).code === 'P2002';

export async function applyWaitEvent(store: EventsStore, input: unknown, now = new Date()): Promise<EventResult> {
  const ev = eventSchema.parse(input);
  const result: EventResult = { event_id: ev.event_id, duplicate: false, matched: 0, applied: [] };

  const target = targetFromEvent(ev);
  const hasSelector = Object.values(target).some((v) => (Array.isArray(v) ? v.length > 0 : !!v));
  // A selector with nothing to select on would match every wait. Refuse it.
  if (!hasSelector) return result;
  // Only an event that names the wait itself may touch a wait whose template has no on_reply
  // rule (Mike's own gates, internal handoffs): a client reply or out-of-office on a client
  // chain must never close or move them.
  const explicit = !!target.wait_id;

  let waits = await store.findTargets(target);
  if (target.wait_kinds?.length) waits = waits.filter((w) => target.wait_kinds!.includes(w.kind));
  if (target.template_key) waits = waits.filter((w) => w.template_key === target.template_key);
  result.matched = waits.length;

  const p = ev.payload ?? {};
  const at = ev.at ? new Date(ev.at) : now;
  const sourceRef = typeof ev.source === 'string' ? ev.source : ev.source ? JSON.stringify(ev.source).slice(0, 300) : null;
  let seen = 0;

  for (const w of waits) {
    if (await store.eventSeenForWait(ev.event_id, w.id)) {
      seen++;
      continue;
    }
    const template = getTemplate(w.template_key);
    if ((ev.kind === 'stop' || ev.kind === 'extend') && !explicit && (!template || template.on_reply === null)) {
      result.applied.push({ wait_id: w.id, action: 'skipped_not_named', detail: 'This wait does not react to replies; only an event naming it can move it.' });
      continue;
    }

    try {
      // The marker event goes in FIRST, in the same transaction as the change. Its unique key is
      // the idempotency lock: a concurrent replay fails here and applies nothing.
      await store.transaction(async (tx) => {
        await tx.addEvent({
          wait_id: w.id,
          kind: 'event_received',
          reason: `${ev.kind} event${sourceRef ? ` (${sourceRef})` : ''}`,
          source: 'placement',
          event_id: eventKey(ev.event_id, w.id),
          email_message_id: p.email_message_id ?? null,
        });
        const base = { now, source: 'placement' as const, event_id: null, email_message_id: p.email_message_id ?? null };

        if (ev.kind === 'place') {
          const data: Partial<WaitRow> = {};
          if (!w.email_thread_id && p.thread_id) data.email_thread_id = p.thread_id;
          if (!w.email_account && p.account) data.email_account = p.account;
          const c = ev.chain;
          if (c?.id) {
            if (c.kind === 'accord' && !w.accord_id) data.accord_id = c.id;
            if (c.kind === 'project' && !w.project_id) data.project_id = c.id;
            if (c.kind === 'charter' && !w.charter_id) data.charter_id = c.id;
            if (c.kind === 'site' && !w.site_id) data.site_id = c.id;
          }
          if (c?.client_id && !w.client_id) data.client_id = c.client_id;
          if (Object.keys(data).length) await tx.update(w.id, data);
          await tx.addEvent({ wait_id: w.id, kind: 'placed', reason: `Placed on its thread${sourceRef ? ` (${sourceRef})` : ''}.`, ...base });
          result.applied.push({ wait_id: w.id, action: 'placed' });
          return;
        }

        if (ev.kind === 'stop') {
          const reason = p.reason ?? 'reply';
          const wantsHuman = (reason === 'reply' || reason === 'question') && template?.on_reply === 'needs_human';
          if (wantsHuman) {
            await needsHuman(tx, w, { ...base, note: `The client wrote back${p.quote ? `: "${p.quote}"` : '.'} A person decides what it changes.`, reason: 'Reply on a review: a person decides.' });
            result.applied.push({ wait_id: w.id, action: 'needs_human' });
          } else {
            await resolveByPerson(tx, w, STOP_RESOLUTIONS[reason] ?? 'stopped_by_reply', { ...base, reason: `Stopped: ${reason}.` });
            result.applied.push({ wait_id: w.id, action: 'stopped', detail: reason });
          }
          return;
        }

        if (ev.kind === 'extend') {
          const auto = !!p.auto_reply;
          const prior = auto ? await store.countAutoExtensions(w.id) : 0;
          const r = await extendWait(tx, w, {
            ...base,
            now: at.getTime() > now.getTime() ? now : at,
            reason: p.reason ?? 'extension',
            business_days: p.mode === 'until' ? undefined : (p.business_days ?? 5),
            until: p.mode === 'until' && p.until ? new Date(p.until) : undefined,
            auto_reply: auto,
            auto_reply_extensions: prior,
          });
          result.applied.push({ wait_id: w.id, action: r.ok ? 'extended' : r.code, detail: r.ok ? `+${r.added_business_days} business days` : undefined });
          return;
        }

        const note = [p.question, p.suggestion ? `Suggestion: ${p.suggestion}` : null].filter(Boolean).join('\n');
        await needsHuman(tx, w, { ...base, note: note || null, owner_user_id: p.owner_user_id ?? null, reason: p.question ?? 'Placement could not decide.' });
        result.applied.push({ wait_id: w.id, action: 'needs_human' });
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        seen++; // a concurrent replay got there first
        continue;
      }
      throw e;
    }
  }
  result.duplicate = waits.length > 0 && seen === waits.length;
  return result;
}
