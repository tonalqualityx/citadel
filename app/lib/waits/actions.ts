/**
 * State changes a person or the placement hook can make to a wait: pause, resume, extend,
 * reassign, stand in, resolve. Every one writes a WaitEvent. The sweeper uses the same store.
 */

import { addBusinessDays, businessDaysLate, zonedParts, zonedTimeToUtc } from './business-days';
import { resolveWait, type SweepStore, type WaitEventInput, type WaitRow } from './sweeper';
import { MIKE_USER_ID } from './owner';

/** At most two extensions or 15 business days in total per wait (W6 and W4a agree). */
export const MAX_EXTENSIONS = 2;
export const MAX_EXTENDED_BUSINESS_DAYS = 15;

type Source = WaitEventInput['source'];

interface Common {
  now: Date;
  source: Source;
  actor_user_id?: string | null;
  email_message_id?: string | null;
  event_id?: string | null;
  reason?: string | null;
}

export type ExtendResult =
  | { ok: true; wait: WaitRow; added_business_days: number }
  | { ok: false; code: 'cap' | 'closed' | 'auto_reply_used'; wait: WaitRow };

const CLOSED = ['done', 'expired'];

/** The due time for "until this date": 17:00 Eastern on the next business day after it. */
export function dueAfterDate(until: Date): Date {
  const p = zonedParts(until);
  // Noon Eastern on the named day, so a business day count starts from that day.
  return addBusinessDays(zonedTimeToUtc(p.year, p.month, p.day, 12, 0), 1);
}

export async function extendWait(
  store: SweepStore,
  wait: WaitRow,
  opts: Common & { business_days?: number; until?: Date; auto_reply?: boolean; auto_reply_extensions?: number }
): Promise<ExtendResult> {
  if (CLOSED.includes(wait.state)) return { ok: false, code: 'closed', wait };
  if (opts.auto_reply && (opts.auto_reply_extensions ?? 0) >= 1) {
    return { ok: false, code: 'auto_reply_used', wait };
  }
  const base = wait.due_at.getTime() > opts.now.getTime() ? wait.due_at : opts.now;
  let newDue: Date;
  let added: number;
  if (opts.until) {
    newDue = dueAfterDate(opts.until);
    if (newDue.getTime() <= wait.due_at.getTime()) {
      // Already covers the date: nothing to add.
      return { ok: true, wait, added_business_days: 0 };
    }
    added = Math.max(1, businessDaysLate(base, newDue));
  } else {
    added = Math.max(1, Math.floor(opts.business_days ?? 0));
    newDue = addBusinessDays(base, added);
  }

  if (wait.extension_count >= MAX_EXTENSIONS || wait.extended_bd_total + added > MAX_EXTENDED_BUSINESS_DAYS) {
    // The next one becomes needs_human on the owner's role.
    const due = wait.due_at.getTime() > opts.now.getTime() ? wait.due_at : addBusinessDays(opts.now, 1);
    const updated = await store.update(wait.id, {
      state: 'needs_human',
      due_at: due,
      detail: [wait.detail, `Asked for more time again (${opts.reason ?? 'extension'}), past the cap of ${MAX_EXTENSIONS} extensions or ${MAX_EXTENDED_BUSINESS_DAYS} business days. A person decides.`]
        .filter(Boolean)
        .join('\n\n'),
    });
    await store.addEvent({
      wait_id: wait.id,
      kind: 'state_changed',
      from_state: wait.state,
      to_state: 'needs_human',
      reason: `Extension cap reached (${wait.extension_count} extensions, ${wait.extended_bd_total} business days so far).`,
      source: opts.source,
      actor_user_id: opts.actor_user_id ?? null,
      email_message_id: opts.email_message_id ?? null,
      event_id: opts.event_id ?? null,
    });
    return { ok: false, code: 'cap', wait: updated };
  }

  const updated = await store.update(wait.id, {
    due_at: newDue,
    extended_bd_total: wait.extended_bd_total + added,
    extension_count: wait.extension_count + 1,
    nag_level: 0,
    last_nag_at: null,
    fired_at: null,
    claimed_at: null,
  });
  await store.addEvent({
    wait_id: wait.id,
    kind: 'extended',
    from_due_at: wait.due_at,
    to_due_at: newDue,
    reason: `${opts.auto_reply ? 'auto-reply: ' : ''}${opts.reason ?? 'extended'} (+${added} business days)`,
    source: opts.source,
    actor_user_id: opts.actor_user_id ?? null,
    email_message_id: opts.email_message_id ?? null,
    event_id: opts.event_id ?? null,
  });
  return { ok: true, wait: updated, added_business_days: added };
}

/** Freeze the clock. The wait resumes with the time it had left. */
export async function pauseWait(store: SweepStore, wait: WaitRow, opts: Common & { until: Date }): Promise<WaitRow> {
  const remaining = Math.max(0, wait.due_at.getTime() - opts.now.getTime());
  const updated = await store.update(wait.id, {
    state: 'paused',
    paused_until: opts.until,
    paused_remaining_ms: BigInt(remaining) as unknown as WaitRow['paused_remaining_ms'],
    claimed_at: null,
  });
  await store.addEvent({
    wait_id: wait.id,
    kind: 'paused',
    from_state: wait.state,
    to_state: 'paused',
    from_due_at: wait.due_at,
    reason: opts.reason ?? `Paused until ${opts.until.toISOString()}.`,
    source: opts.source,
    actor_user_id: opts.actor_user_id ?? null,
    event_id: opts.event_id ?? null,
  });
  return updated;
}

export async function resumeWait(store: SweepStore, wait: WaitRow, opts: Common): Promise<WaitRow> {
  const left = wait.paused_remaining_ms != null ? Number(wait.paused_remaining_ms) : 0;
  const due = new Date(opts.now.getTime() + Math.max(0, left));
  const updated = await store.update(wait.id, { state: 'waiting', paused_until: null, paused_remaining_ms: null, due_at: due });
  await store.addEvent({
    wait_id: wait.id,
    kind: 'resumed',
    from_state: 'paused',
    to_state: 'waiting',
    from_due_at: wait.due_at,
    to_due_at: due,
    reason: opts.reason ?? 'Resumed early.',
    source: opts.source,
    actor_user_id: opts.actor_user_id ?? null,
    event_id: opts.event_id ?? null,
  });
  return updated;
}

/** Re-date a wait to an explicit time, with a reason (the ritual's "re-date with a reason"). */
export async function redateWait(store: SweepStore, wait: WaitRow, opts: Common & { due_at: Date }): Promise<WaitRow> {
  const updated = await store.update(wait.id, { due_at: opts.due_at, nag_level: 0, last_nag_at: null, fired_at: null, claimed_at: null });
  await store.addEvent({
    wait_id: wait.id,
    kind: 'extended',
    from_due_at: wait.due_at,
    to_due_at: opts.due_at,
    reason: opts.reason ?? 're-dated',
    source: opts.source,
    actor_user_id: opts.actor_user_id ?? null,
    event_id: opts.event_id ?? null,
  });
  return updated;
}

export async function reassignWait(
  store: SweepStore,
  wait: WaitRow,
  opts: Common & { owner_user_id?: string | null; owner_function_id?: string | null }
): Promise<WaitRow> {
  const data: Partial<WaitRow> = { escalated_to_user_id: null };
  if (opts.owner_user_id !== undefined) data.owner_user_id = opts.owner_user_id;
  if (opts.owner_function_id !== undefined) data.owner_function_id = opts.owner_function_id;
  const updated = await store.update(wait.id, data);
  await store.addEvent({
    wait_id: wait.id,
    kind: 'reassigned',
    reason: opts.reason ?? `Reassigned to ${opts.owner_user_id ?? opts.owner_function_id ?? 'nobody (Mike)'}.`,
    source: opts.source,
    actor_user_id: opts.actor_user_id ?? null,
    event_id: opts.event_id ?? null,
  });
  return updated;
}

/** Hand a wait to a stand-in while its owner is away. The owner stays recorded; the due date holds. */
export async function standInWait(store: SweepStore, wait: WaitRow, opts: Common & { stand_in_user_id: string | null }): Promise<WaitRow> {
  const updated = await store.update(wait.id, { stand_in_user_id: opts.stand_in_user_id });
  await store.addEvent({
    wait_id: wait.id,
    kind: 'stand_in',
    reason: opts.reason ?? (opts.stand_in_user_id ? `Stand-in ${opts.stand_in_user_id}.` : 'Stand-in cleared.'),
    source: opts.source,
    actor_user_id: opts.actor_user_id ?? null,
    event_id: opts.event_id ?? null,
  });
  return updated;
}

export async function needsHuman(
  store: SweepStore,
  wait: WaitRow,
  opts: Common & { note?: string | null; owner_user_id?: string | null }
): Promise<WaitRow> {
  const soon = addBusinessDays(opts.now, 1);
  const due = wait.due_at.getTime() < soon.getTime() && wait.due_at.getTime() > opts.now.getTime() ? wait.due_at : soon;
  const updated = await store.update(wait.id, {
    state: 'needs_human',
    due_at: due,
    owner_user_id: opts.owner_user_id ?? wait.owner_user_id,
    detail: [wait.detail, opts.note].filter(Boolean).join('\n\n') || null,
    claimed_at: null,
  });
  await store.addEvent({
    wait_id: wait.id,
    kind: 'state_changed',
    from_state: wait.state,
    to_state: 'needs_human',
    reason: opts.reason ?? opts.note ?? 'A person must decide.',
    source: opts.source,
    actor_user_id: opts.actor_user_id ?? null,
    email_message_id: opts.email_message_id ?? null,
    event_id: opts.event_id ?? null,
  });
  return updated;
}

export async function resolveByPerson(
  store: SweepStore,
  wait: WaitRow,
  resolution: string,
  opts: Common
): Promise<WaitRow> {
  return resolveWait(store, wait, resolution, {
    now: opts.now,
    actor_user_id: opts.actor_user_id ?? null,
    source: opts.source,
    reason: opts.reason ?? null,
    event_id: opts.event_id ?? null,
    email_message_id: opts.email_message_id ?? null,
  });
}

export { MIKE_USER_ID };
