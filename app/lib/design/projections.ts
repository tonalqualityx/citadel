/**
 * Designer Portal: what leaves the server (design 7.1, 7.2, 10.3, the lethal-trifecta note in 10.2).
 *
 * Every projection is an explicit allowlist: a field reaches the browser only if it is named here. A designer
 * never sees billing, time entries, rates, estimates, assignees, client records or client contacts (D1, D10,
 * 10.3); the drawer also drops the task description (7.1). `FORBIDDEN_PROJECTION_KEYS` lists the names that
 * must never appear at any depth, and `findForbiddenKeys()` lets route tests prove it.
 */
import { toUsd, type DesignActor } from './helpers';
import type { DrawerData, DrawerRow, DrawerSessionRow } from './access';
import { normalizeMainRole, parsePrecheck, type ConfirmationShown, type MainRole, type PolicyCode, type Precheck } from './publish-policy';

export const WORKER_ONLINE_WINDOW_MS = 30_000;
export const SESSION_STALE_MS = 120_000;
export const FEED_POLL_ACTIVE_MS = 1500;
export const FEED_POLL_IDLE_MS = 5000;

/** Names that must never appear in any design projection, at any depth. */
export const FORBIDDEN_PROJECTION_KEYS = [
  // estimates
  'estimated_minutes', 'energy_estimate', 'mystery_factor', 'battery_impact', 'budget_hours',
  // billing and rates
  'billing_type', 'billing_target', 'billing_amount', 'is_billable', 'is_retainer', 'is_retainer_work', 'is_support',
  'invoiced', 'invoiced_at', 'invoiced_by_id', 'hourly_rate', 'rate', 'budget_amount', 'retainer_hours', 'waive_overage',
  // time
  'time_entries', 'time_entry', 'timer_entry_id', 'timer_presence_at', 'duration', 'duration_minutes',
  // people and clients
  'assignee', 'assignee_id', 'reviewer_id', 'client', 'client_id', 'client_contact', 'contacts', 'requested_by_contact',
  'requested_by_contact_id', 'approved_by_contact_id', 'email', 'phone', 'portal_token',
  // staff-only task fields
  'review_requirements', 'notes',
  // secrets and box internals
  'confirmation_token_hash', 'password_hash', 'staging_auth_password', 'worktree_path', 'sdk_session_id', 'storage_key',
  // no copy or code policy (Mike's ruling)
  'policy', 'copy_words', 'copy_pages',
] as const;

/** Every path in `value` whose key is forbidden (empty = clean). */
export function findForbiddenKeys(value: unknown, path = '$'): string[] {
  const forbidden = new Set<string>(FORBIDDEN_PROJECTION_KEYS);
  const hits: string[] = [];
  const walk = (v: unknown, p: string) => {
    if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${p}[${i}]`));
    } else if (v && typeof v === 'object' && !(v instanceof Date)) {
      for (const [k, x] of Object.entries(v)) {
        if (forbidden.has(k)) hits.push(`${p}.${k}`);
        walk(x, `${p}.${k}`);
      }
    }
  };
  walk(value, path);
  return hits;
}

/** A Decimal-like money value as a number (4 places, like the column). */
function money4(value: number | string | { toString(): string } | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === 'number' ? value : Number(value.toString());
  return Number.isFinite(n) ? Math.round(n * 10000) / 10000 : 0;
}

// ---------------------------------------------------------------------------------------------------------
// Worker state
// ---------------------------------------------------------------------------------------------------------

export interface WorkerView {
  online: boolean;
  paused: boolean;
}

export function workerView(state: { last_heartbeat_at: Date | null; paused: boolean } | null, now: Date = new Date()): WorkerView {
  const beat = state?.last_heartbeat_at;
  return { online: !!beat && now.getTime() - beat.getTime() <= WORKER_ONLINE_WINDOW_MS, paused: !!state?.paused };
}

// ---------------------------------------------------------------------------------------------------------
// Drawer (GET /api/design/tasks)
// ---------------------------------------------------------------------------------------------------------

export type SessionChip = 'active' | 'awaiting_you' | 'paused_budget' | 'stopped' | 'publishing' | 'publish_requested' | 'closed';

export function sessionChip(s: Pick<DrawerSessionRow, 'status' | 'publish_requested_at'>): SessionChip {
  switch (s.status) {
    case 'publishing':
      return 'publishing';
    case 'closed':
    case 'abandoned':
      return 'closed';
    default:
      if (s.publish_requested_at) return 'publish_requested';
      if (s.status === 'awaiting_input') return 'awaiting_you';
      if (s.status === 'paused_budget') return 'paused_budget';
      if (s.status === 'stopped') return 'stopped';
      return 'active';
  }
}

export interface DrawerSessionView {
  /** null when the session belongs to another designer: she sees only that the task is taken. */
  id: string | null;
  status: string;
  mine: boolean;
  chip: SessionChip;
  published_at: Date | null;
}

export interface DrawerTaskView {
  id: string;
  title: string;
  status: string;
  phase: string | null;
  session: DrawerSessionView | null;
}

export interface DrawerResponse {
  projects: Array<{
    id: string;
    name: string;
    site: { id: string; name: string; available: boolean };
    phases: Array<{ name: string | null; tasks: DrawerTaskView[] }>;
  }>;
  worker: WorkerView;
}

function drawerSession(s: DrawerSessionRow | undefined, actor: Pick<DesignActor, 'userId' | 'role'>, publishedAt: Map<string, Date | null>): DrawerSessionView | null {
  if (!s) return null;
  const mine = actor.role === 'admin' || actor.role === 'pm' || s.designer_id === actor.userId;
  return {
    id: mine ? s.id : null,
    status: s.status,
    mine,
    chip: sessionChip(s),
    published_at: mine && s.last_publish_id ? publishedAt.get(s.last_publish_id) ?? null : null,
  };
}

/**
 * Group by project then phase. A project whose tasks name different sites is split into one group per site
 * (the response carries one site per group). Phases keep their sort order; tasks with no phase come last.
 */
export function projectDrawer(data: DrawerData, actor: Pick<DesignActor, 'userId' | 'role'>, now: Date = new Date()): DrawerResponse {
  type Group = { id: string; name: string; site: { id: string; name: string; available: boolean }; phases: Map<string, { name: string | null; order: number; tasks: DrawerTaskView[] }> };
  const groups = new Map<string, Group>();
  const rows: DrawerRow[] = data.rows;
  for (const { task, site, available } of rows) {
    const project = task.project!;
    const key = `${project.id}:${site.id}`;
    let g = groups.get(key);
    if (!g) {
      g = { id: project.id, name: project.name, site: { id: site.id, name: site.name, available }, phases: new Map() };
      groups.set(key, g);
    }
    const phaseName = task.project_phase?.name ?? task.phase ?? null;
    const phaseKey = task.project_phase?.id ?? `legacy:${phaseName ?? ''}`;
    const order = task.project_phase ? task.project_phase.sort_order : Number.MAX_SAFE_INTEGER;
    let ph = g.phases.get(phaseKey);
    if (!ph) {
      ph = { name: phaseName, order, tasks: [] };
      g.phases.set(phaseKey, ph);
    }
    ph.tasks.push({
      id: task.id,
      title: task.title,
      status: task.status,
      phase: phaseName,
      session: drawerSession(data.sessionsByTask.get(task.id), actor, data.publishedAt),
    });
  }
  const projects = [...groups.values()]
    .sort((a, b) => a.name.localeCompare(b.name) || a.site.name.localeCompare(b.site.name))
    .map((g) => ({
      id: g.id,
      name: g.name,
      site: g.site,
      phases: [...g.phases.values()]
        .sort((a, b) => a.order - b.order || (a.name ?? '￿').localeCompare(b.name ?? '￿'))
        .map((p) => ({ name: p.name, tasks: p.tasks })),
    }));
  return { projects, worker: workerView(data.worker, now) };
}

// ---------------------------------------------------------------------------------------------------------
// Session (GET /api/design/sessions/:id) and the "my sessions" list
// ---------------------------------------------------------------------------------------------------------

type Money = number | string | { toString(): string };

export interface SessionRowForProjection {
  id: string;
  task_id: string;
  site_id: string;
  project_id: string | null;
  designer_id: string;
  status: string;
  branch: string;
  preview_alias: string;
  preview_url: string | null;
  preview_sha: string | null;
  base_sha: string | null;
  head_sha: string | null;
  cost_usd: Money;
  budget_usd: Money;
  live_text: string | null;
  live_action: string | null;
  last_seq: number;
  last_heartbeat_at: Date | null;
  last_turn_at: Date | null;
  lib_index: unknown;
  diff_summary: unknown;
  diff_asset_id: string | null;
  publish_requested_at: Date | null;
  last_publish_id: string | null;
  publish_precheck: unknown;
  created_at: Date;
  updated_at: Date;
  closed_at: Date | null;
}

export interface PrecheckView {
  head_sha: string | null;
  gates_ok: boolean | null;
  gates: Precheck['gates'];
  files_changed: string[];
  pages_affected: string[];
}

/** The precheck as the UI may see it: the known keys only (anything else the daemon writes is dropped). */
export function projectPrecheck(raw: unknown): PrecheckView | null {
  const p = parsePrecheck(raw);
  return p ? { head_sha: p.head_sha, gates_ok: p.gates_ok, gates: p.gates, files_changed: p.files_changed, pages_affected: p.pages_affected } : null;
}

/** Stale = a running turn whose heartbeat is older than 2 minutes (computed on read, never stored; D6). */
export function isSessionStale(s: Pick<SessionRowForProjection, 'status' | 'last_heartbeat_at'>, now: Date = new Date()): boolean {
  if (s.status !== 'active') return false;
  return !s.last_heartbeat_at || now.getTime() - s.last_heartbeat_at.getTime() > SESSION_STALE_MS;
}

export function projectSession(s: SessionRowForProjection, now: Date = new Date()) {
  return {
    id: s.id,
    task_id: s.task_id,
    site_id: s.site_id,
    project_id: s.project_id,
    designer_id: s.designer_id,
    status: s.status,
    stale: isSessionStale(s, now),
    branch: s.branch,
    preview_alias: s.preview_alias,
    preview_url: s.preview_url,
    preview_sha: s.preview_sha,
    base_sha: s.base_sha,
    head_sha: s.head_sha,
    cost_usd: money4(s.cost_usd),
    budget_usd: toUsd(s.budget_usd),
    live_text: s.live_text,
    live_action: s.live_action,
    last_seq: s.last_seq,
    last_heartbeat_at: s.last_heartbeat_at,
    last_turn_at: s.last_turn_at,
    lib_index: s.lib_index ?? null,
    diff_summary: s.diff_summary ?? null,
    diff_asset_id: s.diff_asset_id,
    publish_requested_at: s.publish_requested_at,
    last_publish_id: s.last_publish_id,
    publish_precheck: projectPrecheck(s.publish_precheck),
    created_at: s.created_at,
    updated_at: s.updated_at,
    closed_at: s.closed_at,
  };
}

/** The task as the workspace shows it: the task itself (title, description, requirements), nothing staff-only. */
export function projectSessionTask(t: { id: string; title: string; description: string | null; requirements: unknown }) {
  return { id: t.id, title: t.title, description: t.description, requirements: t.requirements ?? null };
}

/** The `lib_index` event payload as the projections read it: {sha, index:{<data_lib>:{pages, sample}}}. */
export interface LibIndexView {
  sha: string | null;
  index: Record<string, { pages: number; sample: string[] }>;
  truncated: boolean;
}

/** Defensive parse of the latest `lib_index` event payload (worker-written, so never trusted). Null when unusable. */
export function latestLibIndex(raw: unknown): LibIndexView | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const idx = r.index;
  if (!idx || typeof idx !== 'object' || Array.isArray(idx)) return null;
  const index: LibIndexView['index'] = {};
  for (const [lib, v] of Object.entries(idx as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue;
    const e = v as Record<string, unknown>;
    if (typeof e.pages !== 'number' || !Number.isFinite(e.pages) || e.pages < 0) continue;
    const sample = Array.isArray(e.sample) ? e.sample.filter((s): s is string => typeof s === 'string').slice(0, 5) : [];
    index[lib] = { pages: Math.trunc(e.pages), sample };
  }
  return { sha: typeof r.sha === 'string' ? r.sha : null, index, truncated: r.truncated === true };
}

/** `{pages, sample}` for a pin's data-lib, or null when the index is missing or has no entry for it. */
export function blastRadiusFor(libIndex: LibIndexView | null | undefined, dataLib: string | null): { pages: number; sample: string[] } | null {
  if (!libIndex || !dataLib) return null;
  const e = Object.prototype.hasOwnProperty.call(libIndex.index, dataLib) ? libIndex.index[dataLib] : undefined;
  return e ? { pages: e.pages, sample: e.sample } : null;
}

export function projectPin(p: {
  id: string; status: string; note: string; page_path: string; data_lib: string | null; lib_stack: string[];
  data_shape: string | null; selector: string; tag: string | null; classes: string[]; text_quote: string | null;
  bbox: unknown; viewport_width: number; viewport_height: number | null; preview_sha: string | null;
  crop_asset_id: string | null; apply_event_seq: number | null; followup_task_id: string | null;
  created_at: Date; updated_at: Date;
}, libIndex?: LibIndexView | null) {
  return {
    id: p.id, status: p.status, note: p.note, page_path: p.page_path, data_lib: p.data_lib, lib_stack: p.lib_stack,
    data_shape: p.data_shape, selector: p.selector, tag: p.tag, classes: p.classes, text_quote: p.text_quote,
    bbox: p.bbox, viewport_width: p.viewport_width, viewport_height: p.viewport_height, preview_sha: p.preview_sha,
    crop_asset_id: p.crop_asset_id, apply_event_seq: p.apply_event_seq, followup_task_id: p.followup_task_id,
    blast_radius: blastRadiusFor(libIndex, p.data_lib),
    created_at: p.created_at, updated_at: p.updated_at,
  };
}

export function projectChange(c: {
  id: string; apply_event_seq: number | null; commit_sha: string; parent_sha: string | null; summary: string;
  files: string[]; data_libs: string[]; pages: string[]; render_count: number | null; pin_ids: string[];
  before_asset_ids: string[]; after_asset_ids: string[]; gates: unknown; is_restore: boolean;
  restored_from: string | null; decision: string; designer_note: string | null; decided_at: Date | null; created_at: Date;
}) {
  return {
    id: c.id, apply_event_seq: c.apply_event_seq, commit_sha: c.commit_sha, parent_sha: c.parent_sha, summary: c.summary,
    files: c.files, data_libs: c.data_libs, pages: c.pages, render_count: c.render_count, pin_ids: c.pin_ids,
    before_asset_ids: c.before_asset_ids, after_asset_ids: c.after_asset_ids, gates: c.gates ?? null,
    is_restore: c.is_restore, restored_from: c.restored_from, decision: c.decision, designer_note: c.designer_note,
    decided_at: c.decided_at, created_at: c.created_at,
  };
}

export function projectSessionListItem(s: {
  id: string; status: string; cost_usd: Money; budget_usd: Money; updated_at: Date;
  task: { id: string; title: string }; site: { name: string };
  last_publish: { id: string; status: string; finished_at: Date | null } | null;
}) {
  return {
    id: s.id,
    task: { id: s.task.id, title: s.task.title },
    site: { name: s.site.name },
    status: s.status,
    last_publish: s.last_publish ? { id: s.last_publish.id, status: s.last_publish.status, finished_at: s.last_publish.finished_at } : null,
    cost_usd: money4(s.cost_usd),
    budget_usd: toUsd(s.budget_usd),
    updated_at: s.updated_at,
  };
}

// ---------------------------------------------------------------------------------------------------------
// Feed (GET /api/design/sessions/:id/feed)
// ---------------------------------------------------------------------------------------------------------

export function projectFeedEvent(e: { seq: number; role: string; kind: string; payload: unknown; created_at: Date }) {
  return { seq: e.seq, role: e.role, kind: e.kind, payload: e.payload, created_at: e.created_at };
}

export interface FeedPublishView {
  can_publish: boolean;
  reason?: PolicyCode;
  main_role: MainRole;
  precheck: PrecheckView | null;
  running_publish_id?: string;
}

export interface FeedInput {
  session: SessionRowForProjection;
  events: ReadonlyArray<{ seq: number; role: string; kind: string; payload: unknown; created_at: Date }>;
  /** canPublish()'s verdict for this caller and session. */
  publishDecision: { ok: true } | { ok: false; code: PolicyCode };
  mainRole: unknown;
  runningPublishId?: string | null;
  /** D10: only `running` and `elapsed_s` ever leave the server. */
  timer?: { running: boolean; elapsed_s: number } | null;
  /** A designer event not yet delivered to the worker (keeps the fast poll). */
  hasUndelivered?: boolean;
  /** sha of the latest lib_index event (null/absent = none yet); lets the UI tell a stale blast radius. */
  libIndexSha?: string | null;
  now?: Date;
}

export function projectFeed(input: FeedInput) {
  const { session: s } = input;
  const publish: FeedPublishView = {
    can_publish: input.publishDecision.ok,
    ...(input.publishDecision.ok ? {} : { reason: input.publishDecision.code }),
    main_role: normalizeMainRole(input.mainRole),
    precheck: projectPrecheck(s.publish_precheck),
    ...(input.runningPublishId ? { running_publish_id: input.runningPublishId } : {}),
  };
  const fast = s.status === 'active' || s.status === 'pending' || !!input.hasUndelivered;
  return {
    events: input.events.map(projectFeedEvent),
    live: { text: s.live_text, action: s.live_action },
    status: s.status,
    stale: isSessionStale(s, input.now),
    publish,
    timer: { running: !!input.timer?.running, elapsed_s: Math.max(0, Math.floor(input.timer?.elapsed_s ?? 0)) },
    cost_usd: money4(s.cost_usd),
    budget_usd: toUsd(s.budget_usd),
    preview_url: s.preview_url,
    preview_sha: s.preview_sha,
    head_sha: s.head_sha,
    lib_index_sha: input.libIndexSha ?? null,
    last_heartbeat_at: s.last_heartbeat_at,
    next_poll_ms: fast ? FEED_POLL_ACTIVE_MS : FEED_POLL_IDLE_MS,
  };
}

// ---------------------------------------------------------------------------------------------------------
// Publish page (GET /api/design/publishes/:id)
// ---------------------------------------------------------------------------------------------------------

const CONFIRMATION_KEYS: ReadonlyArray<keyof ConfirmationShown> = [
  'target_label', 'target_words', 'heading', 'button_label', 'tone', 'live_url', 'main_role', 'main_branch',
  'type_to_confirm', 'head_sha', 'diff_summary', 'files_changed', 'pages_affected', 'gates', 'cost_usd',
];

/** The stored confirmation, known keys only (older rows may carry fields the ruling dropped, e.g. copy_words). */
export function projectConfirmationShown(raw: unknown): Partial<ConfirmationShown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of CONFIRMATION_KEYS) if (k in r) out[k] = r[k];
  return out as Partial<ConfirmationShown>;
}

export interface PublishRowForProjection {
  id: string; session_id: string; site_id: string; task_id: string; kind: string; rolls_back_id: string | null;
  actor_id: string; actor_role: string; publish_mode: string; main_role: string; site_designer_publish: boolean;
  confirmation_shown: unknown; confirmation_typed: string | null; confirm_requested_at: Date | null; confirmed_at: Date | null;
  status: string; head_sha: string | null; from_main_sha: string | null; result_sha: string | null; deploy_id: string | null;
  deploy_url: string | null; alias_url: string | null; gates: unknown; diff_summary: unknown; change_ids: string[];
  cost_usd: Money | null; error: string | null; notified_at: Date | null; rolled_back_at: Date | null;
  rolled_back_by_id: string | null; created_at: Date; started_at: Date | null; finished_at: Date | null;
}

export function projectPublish(p: PublishRowForProjection) {
  return {
    id: p.id, session_id: p.session_id, site_id: p.site_id, task_id: p.task_id, kind: p.kind, rolls_back_id: p.rolls_back_id,
    actor_id: p.actor_id, actor_role: p.actor_role, publish_mode: p.publish_mode, main_role: p.main_role,
    site_designer_publish: p.site_designer_publish, confirmation_shown: projectConfirmationShown(p.confirmation_shown),
    confirmation_typed: p.confirmation_typed, confirm_requested_at: p.confirm_requested_at, confirmed_at: p.confirmed_at,
    status: p.status, head_sha: p.head_sha, from_main_sha: p.from_main_sha, result_sha: p.result_sha, deploy_id: p.deploy_id,
    deploy_url: p.deploy_url, alias_url: p.alias_url, gates: p.gates ?? null, diff_summary: p.diff_summary ?? null,
    change_ids: p.change_ids, cost_usd: p.cost_usd === null ? null : money4(p.cost_usd), error: p.error,
    notified_at: p.notified_at, rolled_back_at: p.rolled_back_at, rolled_back_by_id: p.rolled_back_by_id,
    created_at: p.created_at, started_at: p.started_at, finished_at: p.finished_at,
  };
}

export function projectPublishPage(input: {
  publish: PublishRowForProjection;
  session: { id: string; task: { id: string; title: string }; designer: { name: string } };
  changes: ReadonlyArray<{ id: string; summary: string; data_libs: string[]; pages: string[]; before_asset_ids: string[]; after_asset_ids: string[]; decision: string }>;
  rollback: { ok: true } | { ok: false; code: PolicyCode };
}) {
  return {
    publish: projectPublish(input.publish),
    session: {
      id: input.session.id,
      task: { id: input.session.task.id, title: input.session.task.title },
      designer: { name: input.session.designer.name },
    },
    changes: input.changes.map((c) => ({
      id: c.id, summary: c.summary, data_libs: c.data_libs, pages: c.pages,
      before_asset_ids: c.before_asset_ids, after_asset_ids: c.after_asset_ids, decision: c.decision,
    })),
    can_rollback: input.rollback.ok,
    ...(input.rollback.ok ? {} : { rollback_reason: input.rollback.code }),
  };
}
