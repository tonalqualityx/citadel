import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import type { DrawerData, DrawerSite, DrawerTask } from '../access';
import { workerLive } from '../projections';
import {
  FEED_POLL_ACTIVE_MS,
  FEED_POLL_IDLE_MS,
  findForbiddenKeys,
  projectChange,
  projectDrawer,
  groupEntry,
  type DrawerTaskView,
  type SessionChip,
  projectFeed,
  projectPin,
  latestLibIndex,
  projectPublishPage,
  projectSession,
  projectSessionListItem,
  projectSessionTask,
  sessionChip,
  workerView,
  type PublishRowForProjection,
  type SessionRowForProjection,
} from '../projections';

const NOW = new Date('2026-10-29T12:00:00Z');
const DESIGNER = 'd0000000-0000-4000-8000-000000000001';
const OTHER = 'd0000000-0000-4000-8000-000000000002';
const sorted = (o: object) => Object.keys(o).sort();

// Staff-only fields smuggled into every input: a projection must drop them all.
const LEAK = {
  estimated_minutes: 90, energy_estimate: 5, mystery_factor: 'average', battery_impact: 'high_drain', is_billable: true,
  billing_amount: '500.00', billing_target: '400', invoiced: false, hourly_rate: '150', rate: 150, budget_hours: '10',
  assignee_id: 'x', client_id: 'x', client: { name: 'Client Co', email: 'owner@client.test' }, requested_by_contact_id: 'x',
  time_entries: [{ duration: 30 }], timer_entry_id: 'x', review_requirements: ['qa'], notes: 'staff only',
  worktree_path: '/home/mike/x', sdk_session_id: 'sdk', confirmation_token_hash: 'f'.repeat(64), policy: { copy_words: 9 },
};

function site(over: Partial<DrawerSite> = {}): DrawerSite {
  return { id: 'site-1', name: 'VCDP', site_type: 'eleventy', design_portal_enabled: true, is_deleted: false, ...over };
}

function dtask(id: string, over: Partial<DrawerTask> = {}): DrawerTask {
  const t: DrawerTask = {
    id,
    title: `Task ${id}`,
    status: 'not_started',
    is_deleted: false,
    sort_order: 0,
    phase: null,
    project_phase: { id: 'ph-design', name: 'Design', sort_order: 2 },
    site_id: null,
    site: null,
    project_id: 'proj-1',
    project: { id: 'proj-1', name: 'VCDP rebuild', status: 'in_progress', is_deleted: false, site_id: 'site-1', site: site() },
    claim_holder: null,
    lease_until: null,
    ...over,
  };
  return { ...LEAK, ...t } as DrawerTask;
}

function sessionRow(over: Partial<SessionRowForProjection> = {}): SessionRowForProjection {
  const s: SessionRowForProjection = {
    id: 'sess-1', task_id: 'task-1', site_id: 'site-1', project_id: 'proj-1', designer_id: DESIGNER, status: 'awaiting_input',
    branch: 'design/a1b2c3d4', preview_alias: 'design-a1b2c3d4', preview_url: 'https://design-a1b2c3d4.vcdp.pages.dev',
    preview_sha: 'abc', base_sha: 'base', head_sha: 'abc',
    live_text: null, live_action: null, last_seq: 7, last_heartbeat_at: NOW, last_turn_at: NOW, lib_index: { hero: { pages: ['/'], count: 1 } },
    diff_summary: { files_changed: 1 }, diff_asset_id: null, publish_requested_at: null, last_publish_id: null,
    publish_precheck: { head_sha: 'abc', gates_ok: true, gates: [], files_changed: ['src/index.njk'], pages_affected: ['/'], copy_words: 5, touches_code: [] },
    created_at: NOW, updated_at: NOW, closed_at: null, ...over,
  };
  return { ...LEAK, ...s } as SessionRowForProjection;
}

const SESSION_KEYS = [
  'base_sha', 'branch', 'closed_at', 'created_at', 'designer_id', 'diff_asset_id', 'diff_summary', 'head_sha', 'id',
  'last_heartbeat_at', 'last_publish_id', 'last_seq', 'last_turn_at', 'lib_index', 'live_action', 'live_text', 'preview_alias', 'preview_sha',
  'preview_url', 'project_id', 'publish_precheck', 'publish_requested_at', 'site_id', 'stale', 'status', 'task_id', 'track', 'updated_at',
];

describe('drawer projection', () => {
  const data: DrawerData = {
    rows: [
      { task: dtask('t-b', { project_phase: { id: 'ph-build', name: 'Build', sort_order: 3 } }), site: site(), available: true },
      { task: dtask('t-a'), site: site(), available: true },
      { task: dtask('t-c', { project_phase: null, phase: null }), site: site(), available: true },
      { task: dtask('t-d', { project_id: 'proj-2', project: { id: 'proj-2', name: 'Another', status: 'ready', is_deleted: false, site_id: 'site-2', site: site({ id: 'site-2', name: 'Other' }) } }), site: site({ id: 'site-2', name: 'Other' }), available: false },
    ],
    sessionsByTask: new Map([
      ['t-a', { id: 'sess-mine', task_id: 't-a', designer_id: DESIGNER, status: 'awaiting_input', publish_requested_at: null, last_publish_id: 'pub-1', created_at: NOW }],
      ['t-b', { id: 'sess-theirs', task_id: 't-b', designer_id: OTHER, status: 'active', publish_requested_at: null, last_publish_id: 'pub-2', created_at: NOW }],
    ]),
    trackStageByTask: new Map<string, string>(),
    publishedAt: new Map([['pub-1', NOW], ['pub-2', NOW]]),
    worker: { last_heartbeat_at: new Date(NOW.getTime() - 10_000), paused: false },
  };

  it('groups by project then phase, with exact keys and no forbidden field anywhere', () => {
    const out = projectDrawer(data, { userId: DESIGNER, role: 'designer' }, NOW);
    expect(findForbiddenKeys(out)).toEqual([]);
    expect(sorted(out)).toEqual(['projects', 'worker']);
    expect(out.worker).toEqual({ online: true, paused: false });
    expect(out.projects.map((p) => p.name)).toEqual(['Another', 'VCDP rebuild']);
    const vcdp = out.projects[1];
    expect(sorted(vcdp)).toEqual(['entry', 'id', 'name', 'open_tasks', 'phases', 'site', 'track_stage']);
    expect(vcdp.open_tasks).toBe(3);
    expect(vcdp.track_stage).toBeNull();
    expect(sorted(vcdp.entry)).toEqual(['action', 'chip', 'reason', 'session_id', 'task_id']);
    expect(vcdp.site).toEqual({ id: 'site-1', name: 'VCDP', available: true });
    expect(out.projects[0].site.available).toBe(false);
    expect(vcdp.phases.map((p) => p.name)).toEqual(['Design', 'Build', null]);
    for (const p of vcdp.phases) for (const t of p.tasks) expect(sorted(t)).toEqual(['id', 'phase', 'session', 'status', 'title', 'track_stage']);
  });

  it("her own session shows its id and publish date; another designer's shows only that it is taken", () => {
    const out = projectDrawer(data, { userId: DESIGNER, role: 'designer' }, NOW);
    const tasks = out.projects[1].phases.flatMap((p) => p.tasks);
    const mine = tasks.find((t) => t.id === 't-a')!.session!;
    const theirs = tasks.find((t) => t.id === 't-b')!.session!;
    expect(sorted(mine)).toEqual(['chip', 'id', 'mine', 'published_at', 'status']);
    expect(mine).toEqual({ id: 'sess-mine', status: 'awaiting_input', mine: true, chip: 'awaiting_you', published_at: NOW });
    expect(theirs).toEqual({ id: null, status: 'active', mine: false, chip: 'active', published_at: null });
    expect(tasks.find((t) => t.id === 't-c')!.session).toBeNull();
  });

  it('admin sees every session id', () => {
    const out = projectDrawer(data, { userId: 'admin-1', role: 'admin' }, NOW);
    const theirs = out.projects[1].phases.flatMap((p) => p.tasks).find((t) => t.id === 't-b')!.session!;
    expect(theirs.id).toBe('sess-theirs');
  });

  it('tech sees every session id, as admin and pm do', () => {
    const out = projectDrawer(data, { userId: 'tech-1', role: 'tech' }, NOW);
    const theirs = out.projects[1].phases.flatMap((p) => p.tasks).find((t) => t.id === 't-b')!.session!;
    expect(theirs).toMatchObject({ id: 'sess-theirs', mine: true });
  });

  it('v2: a stage task carries its track stage, every other task null; a stage task shows the track session chip', () => {
    const withTrack: DrawerData = {
      ...data,
      trackStageByTask: new Map([['t-a', 'refine']]),
      sessionsByTask: new Map([['t-a', { id: 'sess-track', task_id: 't-other', designer_id: DESIGNER, status: 'awaiting_input', publish_requested_at: null, last_publish_id: null, created_at: NOW }]]),
    };
    const tasks = projectDrawer(withTrack, { userId: DESIGNER, role: 'designer' }, NOW).projects[1].phases.flatMap((p) => p.tasks);
    expect(tasks.find((t) => t.id === 't-a')!.track_stage).toBe('refine');
    expect(tasks.find((t) => t.id === 't-a')!.session).toMatchObject({ id: 'sess-track', mine: true, chip: 'awaiting_you' });
    for (const t of tasks.filter((x) => x.id !== 't-a')) expect(t.track_stage).toBeNull();
    expect(findForbiddenKeys(projectDrawer(withTrack, { userId: DESIGNER, role: 'designer' }, NOW))).toEqual([]);
  });

  it('worker offline after 30 s, paused passes through', () => {
    expect(workerView({ last_heartbeat_at: new Date(NOW.getTime() - 31_000), paused: true }, NOW)).toEqual({ online: false, paused: true });
    expect(workerView(null, NOW)).toEqual({ online: false, paused: false });
  });

  it.each([
    ['publishing', null, 'publishing'],
    ['closed', null, 'closed'],
    ['abandoned', null, 'closed'],
    ['awaiting_input', NOW, 'publish_requested'],
    ['awaiting_input', null, 'awaiting_you'],
    ['paused_budget', null, 'awaiting_you'],
    ['stopped', null, 'stopped'],
    ['active', null, 'active'],
    ['pending', null, 'active'],
  ] as const)('chip for %s (requested %s) = %s', (status, requested, chip) => {
    expect(sessionChip({ status, publish_requested_at: requested })).toBe(chip);
  });
});

describe('session projections', () => {
  it('session: key snapshot, no forbidden field, precheck reduced to known keys, money as numbers', () => {
    const out = projectSession(sessionRow(), NOW);
    expect(sorted(out)).toEqual(SESSION_KEYS);
    expect(findForbiddenKeys(out)).toEqual([]);
    expect(out.publish_precheck).toEqual({ head_sha: 'abc', gates_ok: true, gates: [], files_changed: ['src/index.njk'], pages_affected: ['/'] });
    expect(out).not.toHaveProperty('cost_usd');
    expect(out).not.toHaveProperty('budget_usd');
    expect(out.stale).toBe(false);
  });
  it('v2: track is null for an untracked session and carries the track view for a tracked one', () => {
    expect(projectSession(sessionRow(), NOW).track).toBeNull();
    const track = { id: 'trk-1', stage: 'home_build', busy: true, busy_line: 'Bast is building the home page', preview_alias: 'design-t-abcdefghijklmnop', preview_url: null, finish: null };
    const out = projectSession(sessionRow({ track }), NOW);
    expect(sorted(out)).toEqual(SESSION_KEYS);
    expect(out.track).toEqual(track);
    expect(sorted(out.track!)).toEqual(['busy', 'busy_line', 'finish', 'id', 'preview_alias', 'preview_url', 'stage']);
    expect(findForbiddenKeys(out)).toEqual([]);
  });
  it('stale: an active session whose heartbeat is older than 2 minutes', () => {
    expect(projectSession(sessionRow({ status: 'active', last_heartbeat_at: new Date(NOW.getTime() - 121_000) }), NOW).stale).toBe(true);
    expect(projectSession(sessionRow({ status: 'awaiting_input', last_heartbeat_at: null }), NOW).stale).toBe(false);
  });
  it('task: title, description and requirements only', () => {
    const out = projectSessionTask({ id: 't', title: 'T', description: 'd', requirements: [{ text: 'r' }], ...LEAK } as never);
    expect(sorted(out)).toEqual(['description', 'id', 'requirements', 'title']);
  });
  it('list item', () => {
    const out = projectSessionListItem({
      ...LEAK, id: 's', status: 'closed', updated_at: NOW,
      task: { id: 't', title: 'T', ...LEAK } as never, site: { name: 'VCDP', ...LEAK } as never,
      last_publish: { id: 'p', status: 'published', finished_at: NOW, ...LEAK } as never,
    } as never);
    expect(sorted(out)).toEqual(['id', 'last_publish', 'site', 'status', 'task', 'track_stage', 'updated_at']);
    expect(findForbiddenKeys(out)).toEqual([]);
    expect(sorted(out.last_publish!)).toEqual(['finished_at', 'id', 'status']);
  });
  it('v2: list item carries the track stage, null when untracked', () => {
    const base = { id: 's', status: 'closed', updated_at: NOW, task: { id: 't', title: 'T' }, site: { name: 'VCDP' }, last_publish: null };
    expect(projectSessionListItem(base).track_stage).toBeNull();
    expect(projectSessionListItem({ ...base, track_stage: 'review' }).track_stage).toBe('review');
  });
  it('pin blast_radius: known data_lib gets {pages, sample}, unknown or no index gets null', () => {
    const base = {
      id: 'p', status: 'pending', note: '', page_path: '/', data_lib: 'hero', lib_stack: ['hero'], data_shape: null,
      selector: 'main', tag: 'section', classes: [], text_quote: null, bbox: null, viewport_width: 390,
      viewport_height: 844, preview_sha: 'abc', crop_asset_id: null, apply_event_seq: null, followup_task_id: null, created_at: NOW, updated_at: NOW,
    };
    const li = latestLibIndex({ sha: 'abc1234', index: { hero: { pages: 4, sample: ['/', '/a/', 1, '/b/', '/c/', '/d/', '/e/'] }, junk: 'x', neg: { pages: -1 } } });
    expect(li).toEqual({ sha: 'abc1234', truncated: false, index: { hero: { pages: 4, sample: ['/', '/a/', '/b/', '/c/', '/d/'] } } });
    expect(projectPin(base as never, li).blast_radius).toEqual({ pages: 4, sample: ['/', '/a/', '/b/', '/c/', '/d/'] });
    expect(projectPin({ ...base, data_lib: 'footer' } as never, li).blast_radius).toBeNull();
    expect(projectPin({ ...base, data_lib: 'constructor' } as never, li).blast_radius).toBeNull();
    expect(projectPin({ ...base, data_lib: null } as never, li).blast_radius).toBeNull();
    expect(projectPin(base as never).blast_radius).toBeNull();
    expect(latestLibIndex({ sha: 'x' })).toBeNull();
    expect(latestLibIndex(null)).toBeNull();
    expect(findForbiddenKeys(projectPin(base as never, li))).toEqual([]);
  });
  it('pin and change', () => {
    const pin = projectPin({
      ...LEAK, author_id: 'x', id: 'p', status: 'pending', note: '', page_path: '/', data_lib: 'hero', lib_stack: ['hero'], data_shape: null,
      selector: 'main', tag: 'section', classes: [], text_quote: null, bbox: { x: 0, y: 0, w: 1, h: 1 }, viewport_width: 390,
      viewport_height: 844, preview_sha: 'abc', crop_asset_id: null, apply_event_seq: null, followup_task_id: null, created_at: NOW, updated_at: NOW,
    } as never);
    expect(findForbiddenKeys(pin)).toEqual([]);
    expect(pin).not.toHaveProperty('author_id');
    const change = projectChange({
      ...LEAK, decided_by_id: 'x', id: 'c', apply_event_seq: 1, commit_sha: 'abc', parent_sha: 'base', summary: 's', files: [], data_libs: [],
      pages: [], render_count: null, pin_ids: [], before_asset_ids: [], after_asset_ids: [], gates: null, is_restore: false,
      restored_from: null, decision: 'pending', designer_note: null, decided_at: null, created_at: NOW,
    } as never);
    expect(findForbiddenKeys(change)).toEqual([]);
    expect(change).not.toHaveProperty('decided_by_id');
  });
});

describe('feed projection', () => {
  const event = { ...LEAK, author_id: 'x', client_ref: 'r', delivered_at: NOW, seq: 3, role: 'assistant', kind: 'text', payload: { text: 'hi' }, created_at: NOW };

  it('key snapshot, timer reduced to running and elapsed_s, refusal reason carried', () => {
    const out = projectFeed({
      session: sessionRow(),
      events: [event],
      publishDecision: { ok: false, code: 'gates_not_green' },
      mainRole: undefined,
      timer: { running: true, elapsed_s: 61.7, ...{ entry_id: 'te-1', is_billable: false } } as never,
      now: NOW,
    });
    expect(sorted(out)).toEqual([
      'events', 'head_sha', 'last_heartbeat_at', 'lib_index_sha', 'live', 'next_poll_ms', 'preview_sha', 'preview_url', 'publish', 'stale', 'status', 'timer', 'worker_last_heartbeat_at', 'worker_online',
    ]);
    expect(findForbiddenKeys(out)).toEqual([]);
    expect(sorted(out.events[0])).toEqual(['created_at', 'kind', 'payload', 'role', 'seq']);
    expect(out.timer).toEqual({ running: true, elapsed_s: 61 });
    expect(out.publish).toEqual({
      can_publish: false,
      reason: 'gates_not_green',
      main_role: 'production',
      precheck: { head_sha: 'abc', gates_ok: true, gates: [], files_changed: ['src/index.njk'], pages_affected: ['/'] },
    });
    expect(out.next_poll_ms).toBe(FEED_POLL_IDLE_MS);
  });

  it('fast poll while active, pending, or a designer message is undelivered; running publish id', () => {
    const base = { events: [], publishDecision: { ok: true } as const, mainRole: 'client_preview', now: NOW };
    expect(projectFeed({ ...base, session: sessionRow({ status: 'active' }) }).next_poll_ms).toBe(FEED_POLL_ACTIVE_MS);
    expect(projectFeed({ ...base, session: sessionRow({ status: 'pending' }) }).next_poll_ms).toBe(FEED_POLL_ACTIVE_MS);
    expect(projectFeed({ ...base, session: sessionRow(), hasUndelivered: true }).next_poll_ms).toBe(FEED_POLL_ACTIVE_MS);
    const out = projectFeed({ ...base, session: sessionRow({ status: 'publishing' }), runningPublishId: 'pub-9' });
    expect(out.publish).toMatchObject({ can_publish: true, main_role: 'client_preview', running_publish_id: 'pub-9' });
    expect(out.publish).not.toHaveProperty('reason');
    expect(out.timer).toEqual({ running: false, elapsed_s: 0 });
  });
});

describe('publish page projection', () => {
  const publish: PublishRowForProjection = {
    id: 'pub-1', session_id: 'sess-1', site_id: 'site-1', task_id: 'task-1', kind: 'publish', rolls_back_id: null, actor_id: DESIGNER,
    actor_role: 'designer', publish_mode: 'per_site', main_role: 'client_preview', site_designer_publish: true,
    confirmation_shown: { target_words: 'the client preview at vcdp.pages.dev', main_branch: 'main', copy_words: 120, touches_code: [] },
    confirmation_typed: 'main', confirm_requested_at: NOW, confirmed_at: NOW, status: 'published', head_sha: 'abc', from_main_sha: 'm0',
    result_sha: 'm1', deploy_id: 'd', deploy_url: 'https://x.vcdp.pages.dev', alias_url: 'https://vcdp.pages.dev', gates: [], diff_summary: null,
    change_ids: [], cost_usd: '4.5', error: null, notified_at: null, rolled_back_at: null, rolled_back_by_id: null, created_at: NOW,
    started_at: NOW, finished_at: NOW,
  };
  const leaky = { ...LEAK, confirmation_expires_at: NOW, ...publish } as PublishRowForProjection;

  it('no token hash, no expiry, no copy policy; confirmation reduced to known keys', () => {
    const out = projectPublishPage({
      publish: leaky,
      session: { id: 'sess-1', task: { id: 'task-1', title: 'T', ...LEAK } as never, designer: { name: 'Lisa', email: 'lisa@x.test' } as never },
      changes: [{ ...LEAK, id: 'c', summary: 's', data_libs: [], pages: ['/'], before_asset_ids: [], after_asset_ids: [], decision: 'accepted' } as never],
      actor: { name: 'Mike', email: 'm@x.test' } as never,
      rollback: { ok: false, code: 'not_latest' },
    });
    expect(findForbiddenKeys(out)).toEqual([]);
    expect(sorted(out)).toEqual(['actor', 'can_rollback', 'changes', 'publish', 'rollback_reason', 'session']);
    expect(out.actor).toEqual({ name: 'Mike' });
    expect(out.publish).not.toHaveProperty('confirmation_token_hash');
    expect(out.publish).not.toHaveProperty('confirmation_expires_at');
    expect(out.publish.confirmation_shown).toEqual({ target_words: 'the client preview at vcdp.pages.dev', main_branch: 'main' });
    expect(out.publish.cost_usd).toBe(4.5);
    expect(out.session).toEqual({ id: 'sess-1', task: { id: 'task-1', title: 'T' }, designer: { name: 'Lisa' } });
    expect(sorted(out.changes[0])).toEqual(['after_asset_ids', 'before_asset_ids', 'data_libs', 'decision', 'edit_scope', 'id', 'pages', 'render_count', 'summary']);
    expect(out.can_rollback).toBe(false);
    expect(out.rollback_reason).toBe('not_latest');
  });

  it('can_rollback true carries no reason', () => {
    const out = projectPublishPage({ publish, session: { id: 's', task: { id: 't', title: 'T' }, designer: { name: 'L' } }, actor: { name: '' }, changes: [], rollback: { ok: true } });
    expect(out.can_rollback).toBe(true);
    expect(out).not.toHaveProperty('rollback_reason');
  });
});

describe('findForbiddenKeys', () => {
  it('finds nested hits and ignores Dates', () => {
    expect(findForbiddenKeys({ a: [{ b: { hourly_rate: 1 } }], when: NOW })).toEqual(['$.a[0].b.hourly_rate']);
  });
});

describe('workerLive (feed worker_online)', () => {
  const now = new Date('2026-10-28T10:00:30Z');
  it('is online for a heartbeat under 30 s old and not paused', () => {
    expect(workerLive({ last_heartbeat_at: new Date('2026-10-28T10:00:10Z'), paused: false }, now)).toBe(true);
  });
  it('is offline when stale, paused, missing or without state', () => {
    expect(workerLive({ last_heartbeat_at: new Date('2026-10-28T09:59:50Z'), paused: false }, now)).toBe(false);
    expect(workerLive({ last_heartbeat_at: new Date('2026-10-28T10:00:20Z'), paused: true }, now)).toBe(false);
    expect(workerLive({ last_heartbeat_at: null, paused: false }, now)).toBe(false);
    expect(workerLive(null, now)).toBe(false);
  });
});


describe('groupEntry', () => {
  const sess = (id: string | null, mine: boolean, chip: SessionChip = 'active') =>
    ({ id, status: 'active', mine, chip, published_at: null });
  const t = (id: string, session: DrawerTaskView['session'] = null, over: Partial<DrawerTaskView> = {}): DrawerTaskView =>
    ({ id, title: id, status: 'not_started', phase: null, track_stage: null, session, ...over });
  const base = { role: 'designer', available: true };
  const at = (n: number) => new Date(1_700_000_000_000 + n * 1000);
  const own = (...ids: string[]) => new Set(ids);

  it('resume prefers the tracked own session', () => {
    const e = groupEntry({
      ...base,
      tasks: [t('a', sess('new', true), {}), t('b', sess('tracked', true, 'awaiting_you'), { track_stage: 'refine' })],
      createdAt: new Map([['new', at(9)], ['tracked', at(1)]]),
      ownTaskIds: own('a', 'b'),
    });
    expect(e).toEqual({ action: 'resume', session_id: 'tracked', task_id: 'b', reason: null, chip: 'awaiting_you' });
  });
  it('resume picks the newest own session when none is tracked', () => {
    const e = groupEntry({ ...base, tasks: [t('a', sess('old', true)), t('b', sess('new', true, 'stopped'))], createdAt: new Map([['old', at(1)], ['new', at(5)]]), ownTaskIds: own('a', 'b') });
    expect(e).toMatchObject({ action: 'resume', session_id: 'new', task_id: 'b', chip: 'stopped' });
  });
  it('de-duplicates a session shown on two tasks', () => {
    const e = groupEntry({ ...base, tasks: [t('a', sess('s1', true), { track_stage: 'refine' }), t('b', sess('s1', true), { track_stage: 'refine' })], createdAt: new Map([['s1', at(1)]]), ownTaskIds: own('a', 'b') });
    expect(e).toMatchObject({ action: 'resume', session_id: 's1', task_id: 'a' });
  });
  it('ignores a closed own session and a session the caller cannot see', () => {
    const e = groupEntry({ ...base, tasks: [t('a', sess('c', true, 'closed')), t('b', sess(null, false))], ownTaskIds: own('a') });
    expect(e).toMatchObject({ action: 'start', task_id: 'a' });
  });
  it('admin and tech join another person\'s tracked session', () => {
    for (const role of ['admin', 'tech']) {
      const e = groupEntry({ role, available: true, tasks: [t('a'), t('b', sess('theirs', true, 'awaiting_you'), { track_stage: 'refine' })], ownTaskIds: own() });
      expect(e).toEqual({ action: 'join', session_id: 'theirs', task_id: 'b', reason: null, chip: 'awaiting_you' });
    }
  });
  it('admin or tech with another person\'s session on untracked a1 and a free a2 start on a2', () => {
    for (const role of ['admin', 'tech']) {
      const e = groupEntry({ role, available: true, tasks: [t('a1', sess('theirs', true)), t('a2')], ownTaskIds: own() });
      expect(e).toMatchObject({ action: 'start', task_id: 'a2' });
    }
  });
  it('admin with only another person\'s sessions joins the first', () => {
    const e = groupEntry({ role: 'admin', available: true, tasks: [t('a1', sess('x', true)), t('a2', sess('y', true))], ownTaskIds: own() });
    expect(e).toMatchObject({ action: 'join', session_id: 'x', task_id: 'a1' });
  });
  it('a designer with the tracked task held by someone else starts on a free untracked task', () => {
    const e = groupEntry({ ...base, tasks: [t('a'), t('b', sess(null, false, 'awaiting_you'), { track_stage: 'research' })] });
    expect(e).toEqual({ action: 'start', session_id: null, task_id: 'a', reason: null, chip: null });
  });
  it('a designer with everything held gets none and taken', () => {
    const e = groupEntry({ ...base, tasks: [t('a', sess(null, false, 'publishing')), t('b', sess(null, false))] });
    expect(e).toEqual({ action: 'none', session_id: null, task_id: null, reason: 'taken', chip: 'publishing' });
  });
  it('the tracked blocker chip wins when nothing else can be opened', () => {
    const e = groupEntry({ ...base, tasks: [t('a', null, { status: 'done' }), t('b', sess(null, false, 'awaiting_you'), { track_stage: 'research' })] });
    expect(e).toMatchObject({ action: 'none', reason: 'taken', chip: 'awaiting_you' });
  });
  it('nothing can be opened and nobody holds anything is not ready', () => {
    const e = groupEntry({ ...base, tasks: [t('a'), t('b')], unstartable: new Set(['a', 'b']) });
    expect(e).toEqual({ action: 'none', session_id: null, task_id: null, reason: 'not_ready', chip: null });
  });
  it('a pm gets view on a live session, even when the site is not available', () => {
    expect(groupEntry({ role: 'pm', available: false, tasks: [t('a', sess('s1', true))] })).toEqual({ action: 'view', session_id: 's1', task_id: 'a', reason: null, chip: 'active' });
  });
  it('site not available', () => {
    expect(groupEntry({ ...base, available: false, tasks: [t('a')] })).toEqual({ action: 'none', session_id: null, task_id: null, reason: 'unavailable', chip: null });
  });
  it('pm with no live session is read only', () => {
    expect(groupEntry({ role: 'pm', available: true, tasks: [t('a')] })).toMatchObject({ action: 'none', reason: 'read_only' });
    expect(groupEntry({ role: 'pm', available: true, tasks: [t('a', sess('c', true, 'closed'))] })).toMatchObject({ action: 'none', reason: 'read_only' });
  });
  it('starts on the track task first', () => {
    const e = groupEntry({ ...base, tasks: [t('a'), t('b', null, { track_stage: 'research' })] });
    expect(e).toEqual({ action: 'start', session_id: null, task_id: 'b', reason: null, chip: null });
  });
  it('an ended track or a stage task with no track is not started', () => {
    expect(groupEntry({ ...base, tasks: [t('a'), t('b', null, { track_stage: 'done' })] })).toMatchObject({ action: 'start', task_id: 'a' });
    expect(groupEntry({ ...base, tasks: [t('a'), t('b')], unstartable: new Set(['a']) })).toMatchObject({ action: 'start', task_id: 'b' });
  });
  it('an untracked start skips a task someone else holds', () => {
    const e = groupEntry({ ...base, tasks: [t('a', sess(null, false)), t('b')] });
    expect(e).toMatchObject({ action: 'start', task_id: 'b' });
  });
  it('the projection carries entry, open_tasks and track_stage with no forbidden key', () => {
    const task = (id: string, o: object = {}) => ({ task: dtask(id, o), site: site(), available: true });
    const data: DrawerData = {
      rows: [task('x1', { tags: ['design-stage:refine'] }), task('x2')],
      sessionsByTask: new Map([['x1', { id: 'sess-x', task_id: 'x1', designer_id: DESIGNER, status: 'active', publish_requested_at: null, last_publish_id: null, created_at: NOW }]]),
      trackStageByTask: new Map([['x1', 'refine']]),
      publishedAt: new Map(),
      worker: { last_heartbeat_at: NOW, paused: false },
    };
    const out = projectDrawer(data, { userId: DESIGNER, role: 'designer' }, NOW);
    expect(out.projects[0]).toMatchObject({ open_tasks: 2, track_stage: 'refine', entry: { action: 'resume', session_id: 'sess-x', task_id: 'x1', chip: 'active' } });
    expect(JSON.stringify(out.projects[0].entry)).not.toContain('created_at');
    expect(findForbiddenKeys(out)).toEqual([]);
  });
});
