/**
 * Test support: an in-memory SweepStore/EventsStore with the same contract as the Prisma one,
 * including the conditional claim and the unique idempotency key. Not imported by production code.
 */
import type { SweepStore, WaitRow, WaitData, WaitEventInput, TaskSpec } from './sweeper';
import type { EventsStore, EventTarget } from './events';
import type { GuardValues } from './templates';

export class MemStore implements SweepStore, EventsStore {
  waits = new Map<string, WaitRow>();
  events: WaitEventInput[] = [];
  tasks: TaskSpec[] = [];
  seq = 0;
  subject: Record<string, 'gone' | 'task_done' | null> = {};
  guards: GuardValues = {};
  preconditionOk = true;
  failCreateTask = false;
  /** Test hook: runs inside claim() before the conditional check, to land a write between list and claim. */
  beforeClaim: ((w: WaitRow) => void) | null = null;
  taskRefs = new Map<string, string>();

  add(data: WaitData, extra: Partial<WaitRow> = {}): WaitRow {
    const id = `00000000-0000-4000-8000-${String(++this.seq).padStart(12, '0')}`;
    const row = {
      id,
      kind: data.kind,
      template_key: data.template_key,
      step: data.step,
      title: data.title,
      detail: data.detail,
      owner_function_id: data.owner_function_id,
      owner_user_id: data.owner_user_id,
      owner_contact_id: data.owner_contact_id,
      stand_in_user_id: null,
      escalated_to_user_id: null,
      client_id: data.client_id,
      accord_id: data.accord_id,
      project_id: data.project_id,
      charter_id: data.charter_id,
      site_id: data.site_id,
      task_id: data.task_id,
      arc_id: data.arc_id,
      approval_request_id: data.approval_request_id,
      email_thread_id: data.email_thread_id,
      email_account: data.email_account,
      started_at: data.started_at,
      duration_value: data.duration_value,
      duration_unit: data.duration_unit,
      due_at: data.due_at,
      extended_bd_total: 0,
      extension_count: 0,
      blocks_client: data.blocks_client,
      client_waiting_since: data.client_waiting_since,
      state: 'waiting',
      paused_until: null,
      paused_remaining_ms: null,
      switch_key: null,
      terminal_action: data.terminal_action,
      action_payload: data.action_payload,
      claimed_at: null,
      fired_at: null,
      sent_at: null,
      sent_message_id: null,
      fire_error: null,
      fire_error_count: 0,
      nag_level: 0,
      last_nag_at: null,
      created_by_id: null,
      created_by_automation: data.created_by_automation,
      idempotency_key: data.idempotency_key,
      mike_only: data.mike_only ?? null,
      resolved_at: null,
      resolved_by_id: null,
      resolution: null,
      created_at: new Date(),
      updated_at: new Date(),
      ...extra,
    } as unknown as WaitRow;
    this.waits.set(id, row);
    return row;
  }
  get(id: string) {
    return this.waits.get(id)!;
  }
  all() {
    return [...this.waits.values()];
  }
  async listPausedDue(now: Date) {
    return this.all().filter((w) => w.state === 'paused' && w.paused_until && w.paused_until <= now);
  }
  async listBlockedBySwitch() {
    return this.all().filter((w) => w.state === 'blocked_by_switch' && w.switch_key);
  }
  async listOpen() {
    return this.all().filter((w) => ['waiting', 'needs_human', 'blocked_by_switch', 'paused'].includes(w.state));
  }
  async claim(id: string, now: Date, staleBefore: Date) {
    const w = this.waits.get(id);
    if (w && this.beforeClaim) this.beforeClaim(w);
    if (!w || w.state !== 'waiting' || w.fired_at) return null;
    if (w.due_at.getTime() > now.getTime()) return null;
    if (w.claimed_at && w.claimed_at >= staleBefore) return null;
    w.claimed_at = now;
    return { ...w };
  }
  async update(id: string, data: Partial<WaitRow>) {
    const w = this.waits.get(id)!;
    Object.assign(w, data);
    return { ...w };
  }
  async insertIdempotent(data: WaitData) {
    if (data.idempotency_key) {
      const hit = this.all().find((w) => w.idempotency_key === data.idempotency_key);
      if (hit) return { wait: hit, created: false };
    }
    return { wait: this.add(data), created: true };
  }
  async addEvent(e: WaitEventInput) {
    if (e.event_id && this.events.some((x) => x.event_id === e.event_id)) {
      throw Object.assign(new Error('Unique constraint failed on event_id'), { code: 'P2002' });
    }
    this.events.push(e);
  }
  async countEvents(waitId: string, kind: string) {
    return this.events.filter((e) => e.wait_id === waitId && e.kind === kind).length;
  }
  async subjectState(w: WaitRow) {
    return this.subject[w.id] ?? null;
  }
  async preconditionMet() {
    return this.preconditionOk;
  }
  async createTask(spec: TaskSpec) {
    if (this.failCreateTask) throw new Error('task api down');
    const hit = this.taskRefs.get(spec.source_ref);
    if (hit) return hit;
    this.tasks.push(spec);
    const id = `t${this.tasks.length}`;
    this.taskRefs.set(spec.source_ref, id);
    return id;
  }
  async guardValues() {
    return this.guards;
  }
  async eventSeenForWait(eventId: string, waitId: string) {
    return this.events.some((e) => e.event_id === `${eventId}:${waitId}`);
  }
  /** Commit-or-roll-back, like the Postgres transaction. */
  private txTail: Promise<unknown> = Promise.resolve();
  transaction<T>(fn: (tx: SweepStore) => Promise<T>): Promise<T> {
    // Serialized, like row locks on the same wait: the second copy of an event sees the first's marker.
    const run = this.txTail.then(() => this.runTx(fn));
    this.txTail = run.catch(() => undefined);
    return run;
  }
  private async runTx<T>(fn: (tx: SweepStore) => Promise<T>): Promise<T> {
    const waits = new Map([...this.waits].map(([k, v]) => [k, { ...v }]));
    const events = [...this.events];
    try {
      return await fn(this);
    } catch (e) {
      this.waits = waits;
      this.events = events;
      throw e;
    }
  }
  async getWait(id: string) {
    return this.waits.get(id) ?? null;
  }
  async lastEvent(waitId: string, kind: string) {
    return [...this.events].reverse().find((e) => e.wait_id === waitId && e.kind === kind) ?? null;
  }
  async findTargets(t: EventTarget) {
    const open = this.all().filter((w) => ['waiting', 'needs_human', 'blocked_by_switch', 'paused'].includes(w.state));
    if (t.wait_id) return open.filter((w) => w.id === t.wait_id);
    return open.filter(
      (w) =>
        (!t.project_id || w.project_id === t.project_id) &&
        (!t.accord_id || w.accord_id === t.accord_id) &&
        (!t.charter_id || w.charter_id === t.charter_id) &&
        (!t.site_id || w.site_id === t.site_id) &&
        (!t.client_id || w.client_id === t.client_id) &&
        (!t.contact_id || w.owner_contact_id === t.contact_id) &&
        (!t.thread_id || w.email_thread_id === t.thread_id) &&
        (!t.wait_kinds?.length || t.wait_kinds.includes(w.kind))
    );
  }
  async countAutoExtensions(waitId: string) {
    return this.events.filter((e) => e.wait_id === waitId && e.kind === 'extended' && (e.reason ?? '').startsWith('auto-reply')).length;
  }
}

