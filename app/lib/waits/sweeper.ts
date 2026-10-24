/**
 * The wait sweeper (specs/citadel-shape-SPEC.md section 2.7). One pass, every 15 minutes:
 *
 *   resume paused waits -> release waits whose switch is on -> expire waits whose subject is
 *   gone -> claim and fire each due `waiting` wait -> run the visibility ladder for Mike's
 *   waits.
 *
 * Idempotent by construction: a wait is claimed with a conditional update on `claimed_at`, the
 * next step is created under the key `<wait id>:next`, and a wait that has fired never fires
 * again. Three firing errors turn the wait `needs_human` on Mike with the error in `detail`.
 * `dryRun` reports what would happen and writes nothing.
 *
 * Phase 1 sends nothing: a `send` firing only stamps `fired_at` for the machine-side outbox
 * (phase 2), and every template that sends is disabled, so none can be open yet.
 *
 * The sweeper talks to a `SweepStore` so the whole pass is unit-tested against memory; the
 * Prisma implementation is lib/waits/prisma-store.ts.
 */

import type { Wait } from '@prisma/client';
import {
  addBusinessDays,
  businessDaysLate,
  isWithinSendWindow,
  sameZonedDay,
} from './business-days';
import { MIKE_USER_ID, resolveOwner, type OwnerLookups, type ResolvedOwner } from './owner';
import {
  buildNextStepData,
  buildWaitData,
  getTemplate,
  guardPasses,
  type GuardValues,
  type WaitActionName,
} from './templates';

export const MAX_FIRE_ERRORS = 3;
/** A claim older than this is a crashed pass and may be taken over. */
export const CLAIM_STALE_MS = 10 * 60 * 1000;
export const OPEN_STATES = ['waiting', 'needs_human', 'blocked_by_switch', 'paused'] as const;
/** Resolutions that start the next step of a chain. */
export const ADVANCING_RESOLUTIONS = ['approved', 'proceeded_on_silence', 'sent', 'completed', 'booked', 'signed'] as const;

export type WaitRow = Wait;
export type WaitData = ReturnType<typeof buildWaitData>;

export interface TaskSpec {
  title: string;
  description: string;
  assignee_id: string;
  client_id: string | null;
  project_id: string | null;
  site_id: string | null;
  charter_id: string | null;
  accord_id: string | null;
  due_date: Date;
  tags: string[];
  /** Idempotency: the store returns the existing task when one carries this reference. */
  source_ref: string;
}

export interface WaitEventInput {
  wait_id: string;
  kind: string;
  from_due_at?: Date | null;
  to_due_at?: Date | null;
  from_state?: string | null;
  to_state?: string | null;
  reason?: string | null;
  source: 'sweeper' | 'placement' | 'ritual' | 'user' | 'ooo' | 'api';
  actor_user_id?: string | null;
  email_message_id?: string | null;
  event_id?: string | null;
}

export interface SweepStore {
  listPausedDue(now: Date): Promise<WaitRow[]>;
  listBlockedBySwitch(): Promise<WaitRow[]>;
  /** Every wait in a state of OPEN_STATES. */
  listOpen(): Promise<WaitRow[]>;
  /** Conditional claim. Null when another pass holds it or it has fired. */
  claim(id: string, now: Date, staleBefore: Date): Promise<WaitRow | null>;
  update(id: string, data: Partial<WaitRow>): Promise<WaitRow>;
  /** Inserts under a unique idempotency key. Returns the existing row on a repeat, with `created: false`. */
  insertIdempotent(data: WaitData): Promise<{ wait: WaitRow; created: boolean }>;
  addEvent(event: WaitEventInput): Promise<void>;
  countEvents(waitId: string, kind: string): Promise<number>;
  /** 'gone' = expire; 'task_done' = the task it points at is finished. */
  subjectState(wait: WaitRow): Promise<'gone' | 'task_done' | null>;
  /** False when the template's precondition says do not fire. */
  preconditionMet(wait: WaitRow, precondition: 'no_charter' | 'no_plan' | 'portal_answered' | 'portal_untouched'): Promise<boolean>;
  createTask(spec: TaskSpec): Promise<string>;
  guardValues(wait: WaitRow): Promise<GuardValues>;
  /** Runs fn with a store whose writes commit or roll back together. */
  transaction<T>(fn: (tx: SweepStore) => Promise<T>): Promise<T>;
  /** The newest event of a kind on a wait, or null. */
  lastEvent(waitId: string, kind: string): Promise<WaitEventInput | null>;
  /** One wait by id, or null. Used to open the step after a draft task is done. */
  getWait(id: string): Promise<WaitRow | null>;
}

export interface SweepDeps {
  store: SweepStore;
  owner: OwnerLookups;
  /** Is the named switch ON? Phase 1 has no Switch table, so the default is "off". */
  switchIsOn: (key: string) => Promise<boolean>;
  /** One Slack DM to Mike for a wait three business days late. Returns true when sent. */
  notifyMike?: (wait: WaitRow, resolved: ResolvedOwner) => Promise<boolean>;
  /**
   * Applies a `proceed` effect. Phase 1 applied none. Item 4 of the 10-24 run applies one:
   * `price_review_done` stamps Charter.price_review_done_at (lib/price-review/apply.ts).
   */
  applyProceed?: (wait: WaitRow, effect: string | null) => Promise<void>;
  /**
   * Performs a send for the templates that queue their own mail (keyed by template key). Called
   * only after every switch is on and the send window is open, never on a dry run. It throws when
   * it cannot send, which counts as a firing error. Templates without a handler keep the phase 1
   * behaviour: stamp `fired_at` for the machine-side outbox.
   */
  sendHandlers?: Record<string, (wait: WaitRow, now: Date) => Promise<void>>;
  now?: () => Date;
}

export interface SweepReport {
  dry_run: boolean;
  at: string;
  resumed: string[];
  released: string[];
  expired: string[];
  closed_with_task: string[];
  fired: Array<{ id: string; template_key: string; step: number; action: WaitActionName; note?: string }>;
  held_for_send_window: string[];
  blocked_by_switch: string[];
  skipped_precondition: string[];
  skipped_disabled: string[];
  escalated: Array<{ id: string; stage: string; to: string | null }>;
  nagged: Array<{ id: string; level: number }>;
  /** Waits whose Slack DM was attempted and not delivered this pass. */
  nag_failed: string[];
  needs_human: string[];
  errors: Array<{ id: string; error: string; count: number }>;
  counts: Record<string, number>;
}

function emptyReport(dryRun: boolean, at: Date): SweepReport {
  return {
    dry_run: dryRun,
    at: at.toISOString(),
    resumed: [],
    released: [],
    expired: [],
    closed_with_task: [],
    fired: [],
    held_for_send_window: [],
    blocked_by_switch: [],
    skipped_precondition: [],
    skipped_disabled: [],
    escalated: [],
    nagged: [],
    nag_failed: [],
    needs_human: [],
    errors: [],
    counts: {},
  };
}

function payloadOf(wait: WaitRow): Record<string, unknown> {
  return wait.action_payload && typeof wait.action_payload === 'object'
    ? (wait.action_payload as Record<string, unknown>)
    : {};
}

/**
 * The action that runs now. It comes from the TEMPLATE's step, never from the wait's own
 * columns or payload, so a row written with a smuggled action cannot send, proceed or publish.
 * A failing guard swaps in the step's fallback. `send` additionally requires template.sends.
 * Anything the template does not name for this step is `escalate`, which only climbs in visibility.
 */
export function effectiveAction(wait: WaitRow, guards: GuardValues): WaitActionName {
  const template = getTemplate(wait.template_key);
  const step = template?.steps[wait.step - 1];
  if (!template || !step) return 'escalate';
  let action: WaitActionName = step.action;
  if (step.guard && step.fallback && !guardPasses(step.guard, guards)) action = step.fallback;
  if (action === 'send' && !template.sends) return 'escalate';
  return action;
}

function ownerInput(wait: WaitRow) {
  return {
    owner_user_id: wait.owner_user_id,
    owner_function_id: wait.owner_function_id,
    owner_contact_id: wait.owner_contact_id,
    stand_in_user_id: wait.stand_in_user_id,
    escalated_to_user_id: wait.escalated_to_user_id,
    project_id: wait.project_id,
    charter_id: wait.charter_id,
    client_id: wait.client_id,
    accord_id: wait.accord_id,
    action_payload: wait.action_payload,
  };
}

export function resolveWaitOwner(wait: WaitRow, lookups: OwnerLookups): Promise<ResolvedOwner> {
  return resolveOwner(ownerInput(wait), lookups);
}

/**
 * Opens the next step of a chain, if the template has one. Safe to call twice: the key
 * `<wait id>:next` is unique, so the second call returns the first step's row.
 */
export async function spawnNextStep(store: SweepStore, wait: WaitRow, now: Date): Promise<WaitRow | null> {
  const data = buildNextStepData(wait, now);
  if (!data) return null;
  const { wait: next, created } = await store.insertIdempotent(data);
  if (created) {
    await store.addEvent({
      wait_id: next.id,
      kind: 'created',
      to_state: 'waiting',
      to_due_at: next.due_at,
      reason: `Step ${next.step} of ${next.template_key}, opened when step ${wait.step} ended.`,
      source: 'sweeper',
    });
  }
  return next;
}

/**
 * Closes a wait with a resolution and starts the next step when the resolution advances the
 * chain. The one close path used by the API and the sweeper.
 */
export async function resolveWait(
  store: SweepStore,
  wait: WaitRow,
  resolution: string,
  opts: {
    now: Date;
    actor_user_id?: string | null;
    source: WaitEventInput['source'];
    reason?: string | null;
    event_id?: string | null;
    email_message_id?: string | null;
  }
): Promise<WaitRow> {
  const updated = await store.update(wait.id, {
    state: 'done',
    resolved_at: opts.now,
    resolved_by_id: opts.actor_user_id ?? null,
    resolution,
    claimed_at: null,
  });
  await store.addEvent({
    wait_id: wait.id,
    kind: 'state_changed',
    from_state: wait.state,
    to_state: 'done',
    reason: opts.reason ?? `Resolved: ${resolution}.`,
    source: opts.source,
    actor_user_id: opts.actor_user_id ?? null,
    event_id: opts.event_id ?? null,
    email_message_id: opts.email_message_id ?? null,
  });
  if ((ADVANCING_RESOLUTIONS as readonly string[]).includes(resolution)) {
    await spawnNextStep(store, updated, opts.now);
  }
  return updated;
}

/**
 * A handoff wait on a task that a `next_on_task_done` step made has just closed because the task
 * is done: open the step that follows the one that made the task. The handoff names its parent in
 * `from_wait_id`; the link only counts when that parent really created this task, so a hand-opened
 * wait cannot start another wait's chain. Idempotent on `<parent id>:next`.
 */
async function openStepAfterTask(store: SweepStore, handoff: WaitRow, now: Date): Promise<void> {
  const fromId = payloadOf(handoff).from_wait_id;
  if (typeof fromId !== 'string' || !handoff.task_id) return;
  const parent = await store.getWait(fromId);
  if (!parent) return;
  if (payloadOf(parent).created_task_id !== handoff.task_id) return;
  const step = getTemplate(parent.template_key)?.steps[parent.step - 1];
  if (!step?.next_on_task_done) return;
  await spawnNextStep(store, parent, now);
}

/** The switches a send step needs: the template's own, then any extras. */
export function sendSwitchKeys(template: { switch_key?: string; extra_switch_keys?: string[] }): string[] {
  return [...(template.switch_key ? [template.switch_key] : []), ...(template.extra_switch_keys ?? [])];
}

async function runPass(deps: SweepDeps, dryRun: boolean): Promise<SweepReport> {
  const now = (deps.now ?? (() => new Date()))();
  const { store } = deps;
  const report = emptyReport(dryRun, now);
  const staleBefore = new Date(now.getTime() - CLAIM_STALE_MS);

  // 1. Resume paused waits whose time has come, with the time they had left.
  for (const w of await store.listPausedDue(now)) {
    report.resumed.push(w.id);
    if (dryRun) continue;
    const left = w.paused_remaining_ms != null ? Number(w.paused_remaining_ms) : 0;
    const due = new Date(now.getTime() + Math.max(0, left));
    // Back to the state it was paused from: a needs_human wait stays needs_human.
    const prior = (await store.lastEvent(w.id, 'paused'))?.from_state;
    const back = prior === 'needs_human' || prior === 'blocked_by_switch' ? prior : 'waiting';
    await store.update(w.id, { state: back, paused_until: null, paused_remaining_ms: null, due_at: due });
    await store.addEvent({
      wait_id: w.id,
      kind: 'resumed',
      from_state: 'paused',
      to_state: back,
      from_due_at: w.due_at,
      to_due_at: due,
      reason: 'Pause ended.',
      source: 'sweeper',
    });
  }

  // 2. Release waits held by a switch that is now on.
  for (const w of await store.listBlockedBySwitch()) {
    if (!w.switch_key || !(await deps.switchIsOn(w.switch_key))) continue;
    report.released.push(w.id);
    if (dryRun) continue;
    await store.update(w.id, { state: 'waiting', switch_key: null });
    await store.addEvent({
      wait_id: w.id,
      kind: 'state_changed',
      from_state: 'blocked_by_switch',
      to_state: 'waiting',
      reason: `Switch ${w.switch_key} is on.`,
      source: 'sweeper',
    });
  }

  // 3. Expire waits whose subject is gone; close waits whose task is finished.
  const open = await store.listOpen();
  const stillOpen: WaitRow[] = [];
  for (const w of open) {
    const subject = await store.subjectState(w);
    if (subject === 'gone') {
      report.expired.push(w.id);
      if (!dryRun) {
        await store.update(w.id, { state: 'expired', resolved_at: now, resolution: 'subject_gone', claimed_at: null });
        await store.addEvent({
          wait_id: w.id,
          kind: 'state_changed',
          from_state: w.state,
          to_state: 'expired',
          reason: 'Its project, accord, charter or task is gone.',
          source: 'sweeper',
        });
      }
      continue;
    }
    if (subject === 'task_done') {
      report.closed_with_task.push(w.id);
      if (!dryRun) {
        await resolveWait(store, w, 'task_done', { now, source: 'sweeper', reason: 'The task it points at is done.' });
        await openStepAfterTask(store, w, now);
      }
      continue;
    }
    stillOpen.push(w);
  }

  // 4. Fire what is due.
  const due = stillOpen.filter((w) => w.state === 'waiting' && !w.fired_at && w.due_at.getTime() <= now.getTime());
  due.sort((a, b) => a.due_at.getTime() - b.due_at.getTime());
  for (const candidate of due) {
    await fireOne(deps, candidate, now, staleBefore, dryRun, report);
  }

  // 5. The visibility ladder for waits that land on Mike.
  const stillCurrent = dryRun ? stillOpen : await store.listOpen();
  for (const w of stillCurrent) {
    if (!['waiting', 'needs_human', 'blocked_by_switch'].includes(w.state)) continue;
    if (w.due_at.getTime() > now.getTime()) continue;
    const resolved = await resolveWaitOwner(w, deps.owner);
    if (resolved.user_id !== MIKE_USER_ID) continue;
    const late = businessDaysLate(w.due_at, now);
    // Only a wait that blocks a client climbs past level 1; Mike's time is the constraint.
    const target = !w.blocks_client ? 1 : late >= 5 ? 3 : late >= 3 ? 2 : 1;
    if (target <= w.nag_level) continue;
    // Climb one rung at a time so Mike gets the one DM before the countdown shows.
    // Rung 2 is the Slack DM. With no notifier configured (WAIT_SLACK_NAG=off) the rung is
    // skipped on purpose. With one, the DM must actually go out before the ladder climbs past
    // it: outside business hours, throttled, or failed all STOP the climb here (level stays
    // where it is) and the next sweep tries again.
    let level = w.nag_level;
    let attemptFailed = false;
    for (let rung = w.nag_level + 1; rung <= target; rung++) {
      if (rung === 2) {
        if (!deps.notifyMike) continue;
        if (!isWithinSendWindow(now)) break;
        // At most one attempt per business day per wait, failed or not.
        if (w.last_nag_at && sameZonedDay(w.last_nag_at, now)) break;
        if (!dryRun) {
          const sent = await deps.notifyMike(w, resolved).catch(() => false);
          if (!sent) {
            attemptFailed = true;
            break;
          }
        }
      }
      level = rung;
    }
    if (attemptFailed) {
      // Record the attempt (so the throttle holds) and any lower rung reached; never level 2 or 3.
      report.nag_failed.push(w.id);
      await store.update(w.id, { nag_level: Math.max(level, w.nag_level), last_nag_at: now });
      await store.addEvent({
        wait_id: w.id,
        kind: 'nagged',
        reason: `Slack DM was not delivered (${late} business days late). Will retry next business day.`,
        source: 'sweeper',
      });
      continue;
    }
    if (level <= w.nag_level) continue;
    report.nagged.push({ id: w.id, level });
    if (dryRun) continue;
    await store.update(w.id, { nag_level: level, last_nag_at: now });
    await store.addEvent({
      wait_id: w.id,
      kind: 'nagged',
      reason: `Visibility level ${level}; ${late} business days late.`,
      source: 'sweeper',
    });
  }

  report.counts = {
    resumed: report.resumed.length,
    released: report.released.length,
    expired: report.expired.length,
    closed_with_task: report.closed_with_task.length,
    due: due.length,
    fired: report.fired.length,
    held_for_send_window: report.held_for_send_window.length,
    blocked_by_switch: report.blocked_by_switch.length,
    skipped_precondition: report.skipped_precondition.length,
    skipped_disabled: report.skipped_disabled.length,
    escalated: report.escalated.length,
    nagged: report.nagged.length,
    nag_failed: report.nag_failed.length,
    needs_human: report.needs_human.length,
    errors: report.errors.length,
  };
  return report;
}

async function fireOne(
  deps: SweepDeps,
  candidate: WaitRow,
  now: Date,
  staleBefore: Date,
  dryRun: boolean,
  report: SweepReport
): Promise<void> {
  const { store } = deps;
  const template = getTemplate(candidate.template_key);

  // Preview mode: classify without touching anything.
  let wait: WaitRow | null = candidate;
  if (!dryRun) {
    wait = await store.claim(candidate.id, now, staleBefore);
    if (!wait) return; // another pass has it, or it already fired
  }

  try {
    const guards = await store.guardValues(wait);
    const action = effectiveAction(wait, guards);
    const step = template?.steps[wait.step - 1];

    // Phase 1 gate: a registered-but-disabled template never fires.
    if (!template || !template.enabled) {
      report.skipped_disabled.push(wait.id);
      if (!dryRun) await store.update(wait.id, { claimed_at: null });
      return;
    }

    if (template && template.precondition && !(await store.preconditionMet(wait, template.precondition))) {
      report.skipped_precondition.push(wait.id);
      if (!dryRun) {
        await store.update(wait.id, { claimed_at: null });
        await resolveWait(store, wait, 'precondition_not_met', {
          now,
          source: 'sweeper',
          reason: `Precondition ${template.precondition} says not to fire.`,
        });
      }
      return;
    }

    if (action === 'escalate') {
      await escalate(deps, wait, now, dryRun, report);
      return;
    }

    if (action === 'send') {
      // Every switch must be on. The first one that is off holds the send and names itself.
      let switchKey: string | null = null;
      for (const key of sendSwitchKeys(template)) {
        if (!(await deps.switchIsOn(key))) {
          switchKey = key;
          break;
        }
      }
      if (switchKey) {
        report.blocked_by_switch.push(wait.id);
        if (!dryRun) {
          await store.update(wait.id, { state: 'blocked_by_switch', switch_key: switchKey, claimed_at: null });
          await store.addEvent({
            wait_id: wait.id,
            kind: 'state_changed',
            from_state: 'waiting',
            to_state: 'blocked_by_switch',
            reason: `Switch ${switchKey} is off; nothing was sent.`,
            source: 'sweeper',
          });
        }
        return;
      }
      if (!isWithinSendWindow(now)) {
        report.held_for_send_window.push(wait.id);
        if (!dryRun) await store.update(wait.id, { claimed_at: null });
        return;
      }
      report.fired.push({ id: wait.id, template_key: wait.template_key, step: wait.step, action, note: step?.note });
      if (dryRun) return;
      const handler = deps.sendHandlers?.[wait.template_key];
      if (handler) {
        // The template queues its own mail. Dedupe keys make a retry after a partial failure safe.
        await handler(wait, now);
        await store.update(wait.id, { fired_at: now, claimed_at: null });
        await store.addEvent({ wait_id: wait.id, kind: 'fired', reason: step?.note ?? 'Queued in the outbox.', source: 'sweeper' });
        await resolveWait(store, { ...wait, fired_at: now }, 'sent', { now, source: 'sweeper', reason: 'Queued in the outbox.' });
        return;
      }
      // Stamp for the machine-side outbox; the sender confirms with PUT /api/waits/:id/sent.
      // Next step first (idempotent on <id>:next), stamp last, so a failure retries cleanly.
      await spawnNextStep(store, wait, now);
      await store.update(wait.id, { fired_at: now, claimed_at: null });
      await store.addEvent({ wait_id: wait.id, kind: 'fired', reason: step?.note ?? 'Queued for the outbox.', source: 'sweeper' });
      return;
    }

    if (action === 'proceed') {
      report.fired.push({ id: wait.id, template_key: wait.template_key, step: wait.step, action, note: step?.note });
      if (dryRun) return;
      const effect = typeof step?.payload?.effect === 'string' ? (step.payload.effect as string) : null;
      if (deps.applyProceed) await deps.applyProceed(wait, effect);
      await store.update(wait.id, { fired_at: now, claimed_at: null });
      await store.addEvent({
        wait_id: wait.id,
        kind: 'fired',
        reason: effect ? `Proceeded (${effect}).` : 'Proceeded.',
        source: 'sweeper',
      });
      await resolveWait(store, { ...wait, fired_at: now }, 'proceeded_on_silence', {
        now,
        source: 'sweeper',
        reason: step?.note ?? 'Proceeded on silence.',
      });
      return;
    }

    if (action === 'task') {
      report.fired.push({ id: wait.id, template_key: wait.template_key, step: wait.step, action, note: step?.note });
      if (dryRun) return;
      const resolved = await resolveWaitOwner(wait, deps.owner);
      // Idempotent: a retry after a partial failure reuses the task already made. The id is
      // written to the wait right after creation, before anything else can fail, and the
      // store also dedupes on source_ref.
      const stored = payloadOf(wait).created_task_id;
      let taskId = typeof stored === 'string' ? stored : null;
      if (!taskId) {
        taskId = await store.createTask({
          title: wait.title,
          description: [wait.detail, `Opened by the wait record (${wait.template_key}, step ${wait.step}).`].filter(Boolean).join('\n\n'),
          assignee_id: resolved.user_id,
          client_id: wait.client_id,
          project_id: wait.project_id,
          site_id: wait.site_id,
          charter_id: wait.charter_id,
          accord_id: wait.accord_id,
          due_date: addBusinessDays(now, 2),
          tags: ['wait-handoff'],
          source_ref: `${wait.id}:task`,
        });
        await store.update(wait.id, {
          action_payload: { ...payloadOf(wait), created_task_id: taskId } as WaitRow['action_payload'],
        });
      }
      // The task carries its own dated wait, so a task is never a bare state.
      const handoff = buildWaitData(
        {
          template_key: 'handoff.generic',
          title: wait.title,
          started_at: now,
          owner_user_id: resolved.user_id,
          client_id: wait.client_id,
          accord_id: wait.accord_id,
          project_id: wait.project_id,
          charter_id: wait.charter_id,
          site_id: wait.site_id,
          task_id: taskId,
          blocks_client: wait.blocks_client,
          client_waiting_since: wait.client_waiting_since,
          created_by_automation: 'sweeper',
          idempotency_key: `${wait.id}:task`,
          action_payload: { from_wait_id: wait.id },
        },
      );
      const made = await store.insertIdempotent(handoff);
      if (made.created) {
        await store.addEvent({ wait_id: made.wait.id, kind: 'created', to_state: 'waiting', to_due_at: made.wait.due_at, reason: `Handoff on task ${taskId}.`, source: 'sweeper' });
      }
      // fired_at is stamped LAST: until then a failed attempt is still claimable and retries.
      await store.update(wait.id, { fired_at: now, claimed_at: null });
      await store.addEvent({ wait_id: wait.id, kind: 'fired', reason: `Opened task ${taskId} for ${resolved.user_id}.`, source: 'sweeper' });
      await resolveWait(store, { ...wait, fired_at: now }, 'task_created', { now, source: 'sweeper', reason: step?.note ?? 'Opened a task.' });
      return;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const count = (wait.fire_error_count ?? 0) + 1;
    report.errors.push({ id: wait.id, error: message, count });
    if (dryRun) return;
    if (count >= MAX_FIRE_ERRORS) {
      report.needs_human.push(wait.id);
      await store.update(wait.id, {
        state: 'needs_human',
        fire_error: message,
        fire_error_count: count,
        claimed_at: null,
        owner_user_id: MIKE_USER_ID,
        stand_in_user_id: null,
        escalated_to_user_id: null,
        due_at: addBusinessDays(now, 1),
        detail: [wait.detail, `The machine gave up after ${count} tries. Last error: ${message}`].filter(Boolean).join('\n\n'),
      });
      await store.addEvent({
        wait_id: wait.id,
        kind: 'state_changed',
        from_state: 'waiting',
        to_state: 'needs_human',
        reason: `Three firing errors. Last: ${message}`,
        source: 'sweeper',
      });
    } else {
      await store.update(wait.id, { fire_error: message, fire_error_count: count, claimed_at: null });
    }
  }
}

/**
 * The escalate action. For Mike it is visibility only (the ladder in step 5 handles it), so
 * nothing changes here. For anyone else: the role holder's digest, then the PM, then Mike, one
 * step per business day. Nobody is skipped.
 */
async function escalate(deps: SweepDeps, wait: WaitRow, now: Date, dryRun: boolean, report: SweepReport) {
  const { store } = deps;
  const resolved = await resolveWaitOwner(wait, deps.owner);
  const stepDef = getTemplate(wait.template_key)?.steps[wait.step - 1];
  const toMikeNow = stepDef?.payload?.escalate_to === 'mike';

  if (resolved.user_id === MIKE_USER_ID && !toMikeNow) {
    // Visibility only: no state change, nothing to claim.
    if (!dryRun) await store.update(wait.id, { claimed_at: null });
    return;
  }

  const stage = await store.countEvents(wait.id, 'escalated');
  let label: string;
  let target: string | null = null;
  if (toMikeNow || stage >= 2) {
    label = 'mike';
    target = MIKE_USER_ID;
  } else if (stage === 1) {
    label = 'pm';
    const pm = await resolveOwner(
      { ...ownerInput({ ...wait, owner_user_id: null, stand_in_user_id: null, escalated_to_user_id: null, owner_function_id: null }), action_payload: { owner_role: 'pm' } },
      deps.owner
    );
    target = pm.user_id;
  } else {
    label = 'role_holder_digest';
    target = resolved.user_id;
  }
  report.escalated.push({ id: wait.id, stage: label, to: target });
  report.fired.push({ id: wait.id, template_key: wait.template_key, step: wait.step, action: 'escalate', note: label });
  if (dryRun) return;

  const lastStage = label === 'mike';
  await store.update(wait.id, {
    escalated_to_user_id: label === 'role_holder_digest' ? wait.escalated_to_user_id : target,
    // Re-arm one business day out for the next rung; the last rung stops.
    due_at: lastStage ? wait.due_at : addBusinessDays(now, 1),
    fired_at: lastStage ? now : null,
    claimed_at: null,
  });
  await store.addEvent({
    wait_id: wait.id,
    kind: 'escalated',
    from_due_at: wait.due_at,
    to_due_at: lastStage ? wait.due_at : addBusinessDays(now, 1),
    reason: `Escalation stage ${stage + 1}: ${label}${target ? ` (${target})` : ''}.`,
    source: 'sweeper',
  });
}

export function runSweep(deps: SweepDeps, opts: { dryRun?: boolean } = {}): Promise<SweepReport> {
  return runPass(deps, !!opts.dryRun);
}
