import { describe, it, expect } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import {
  DOX_PROJECT_HEADER,
  doxProjectOf,
  guardDoxComment,
  guardDoxProjectPatch,
  guardDoxTaskCreate,
  guardDoxTaskPatch,
  guardDoxWaitCreate,
  guardDoxWaitPatch,
  isDoxLane,
  mayReadSnapshot,
} from '../guard';
import { authorLabel, isDoxLaneValue } from '../identity';

const P = '7f1c0000-0000-4000-8000-000000000001';
const OTHER = '7f1c0000-0000-4000-8000-000000000002';
const DOX = { lane: 'dox' };
const BAST = { lane: 'bast' };
const hdr = (p?: string): Pick<Headers, 'get'> => ({ get: (n: string) => (n.toLowerCase() === DOX_PROJECT_HEADER && p ? p : null) });
const code = (fn: () => unknown): string | null => {
  try {
    fn();
    return null;
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).statusCode).toBe(403);
    return (e as ApiError).code ?? null;
  }
};
const task = (over: Partial<{ status: string; project_id: string | null; tags: string[] }> = {}) => ({ status: 'not_started', project_id: P as string | null, tags: ['x'] as string[], ...over });

describe('Dox identity', () => {
  it('shows Dox as the author of the Dox lane and the user name for anyone else', () => {
    expect(authorLabel('dox', 'Bast')).toBe('Dox');
    expect(authorLabel('bast', 'Bast')).toBe('Bast');
    expect(authorLabel(null, 'Sabeen')).toBe('Sabeen');
    expect(authorLabel(null, null)).toBe('Unknown');
    expect(isDoxLaneValue('bast,dox')).toBe(true);
    expect(isDoxLaneValue('doxx')).toBe(false);
  });
});

describe('Dox guard: every function is a no-op for another caller', () => {
  it('returns bodies untouched and never throws for non-Dox lanes', () => {
    const body = { title: 'x', status: 'triage', anything: 1 };
    expect(guardDoxTaskCreate(BAST, hdr(), body)).toBe(body);
    expect(guardDoxTaskPatch(BAST, hdr(), body, task())).toBe(body);
    expect(() => guardDoxProjectPatch({}, hdr(), { status: 'cancelled' }, { id: P, status: 'x', open_task_count: 0, total_task_count: 0 })).not.toThrow();
    expect(() => guardDoxWaitCreate(BAST, { template_key: 'charter.price_review' })).not.toThrow();
    expect(guardDoxComment(BAST, { client_visible: true })).toBeNull();
    expect(isDoxLane(BAST)).toBe(false);
  });
});

describe('Dox guard: creating tasks', () => {
  it('needs the project header, the same project in the body, and only status not_started', () => {
    expect(code(() => guardDoxTaskCreate(DOX, hdr(), { title: 'a', project_id: P }))).toBe('dox_no_project');
    expect(code(() => guardDoxTaskCreate(DOX, hdr(P), { title: 'a', project_id: OTHER }))).toBe('dox_outside_project');
    expect(code(() => guardDoxTaskCreate(DOX, hdr(P), { title: 'a' }))).toBe('dox_outside_project');
    expect(code(() => guardDoxTaskCreate(DOX, hdr(P), { title: 'a', project_id: P, status: 'triage' }))).toBe('dox_status_closed');
    expect(code(() => guardDoxTaskCreate(DOX, hdr(P), { title: 'a', project_id: P, status: 'done' }))).toBe('dox_status_closed');
    expect(code(() => guardDoxTaskCreate(DOX, hdr(P), { title: 'a', project_id: P, client_visible: true }))).toBe('dox_field_closed');
    expect(code(() => guardDoxTaskCreate(DOX, hdr(P), { title: 'a', project_id: P, billing_target: 'x' }))).toBe('dox_field_closed');
  });
  it('lets a setup task through, forced to not_started', () => {
    const out = guardDoxTaskCreate(DOX, hdr(P), { title: 'a', project_id: P, assignee_id: 'u', due_date: '2026-11-20T12:00:00Z', phase_id: 'ph', blocked_by_ids: { connect: ['t'] } });
    expect(out.status).toBe('not_started');
    expect(out.project_id).toBe(P);
  });
});

describe('Dox guard: patching tasks', () => {
  it('allows assignee, due date, blockers and phase on a task of its project', () => {
    const out = guardDoxTaskPatch(DOX, hdr(P), { assignee_id: 'u', due_date: '2026-11-20T12:00:00Z', blocked_by_ids: { connect: ['t'] }, phase_id: 'ph' }, task());
    expect(out).toEqual({ assignee_id: 'u', due_date: '2026-11-20T12:00:00Z', blocked_by_ids: { connect: ['t'] }, phase_id: 'ph' });
  });
  it('refuses a task of another project, or a call with no project header', () => {
    expect(code(() => guardDoxTaskPatch(DOX, hdr(OTHER), { assignee_id: 'u' }, task()))).toBe('dox_outside_project');
    expect(code(() => guardDoxTaskPatch(DOX, hdr(), { assignee_id: 'u' }, task()))).toBe('dox_outside_project');
  });
  it('a card with no project is Dox\'s only after release from Triage (from-triage tag)', () => {
    expect(code(() => guardDoxTaskPatch(DOX, hdr(), { assignee_id: 'u' }, task({ project_id: null })))).toBe('dox_outside_project');
    expect(guardDoxTaskPatch(DOX, hdr(), { assignee_id: 'u' }, task({ project_id: null, tags: ['from-triage'] }))).toEqual({ assignee_id: 'u' });
  });
  it('closes every other field', () => {
    for (const k of ['title', 'description', 'approved', 'client_visible', 'is_billable', 'function_id', 'project_id', 'priority', 'tags']) {
      expect(code(() => guardDoxTaskPatch(DOX, hdr(P), { [k]: 'x' }, task())), k).toBe('dox_field_closed');
    }
  });
  it('status: only in_progress back to not_started; never done, never into or out of triage', () => {
    expect(guardDoxTaskPatch(DOX, hdr(P), { status: 'not_started' }, task({ status: 'in_progress' }))).toEqual({ status: 'not_started' });
    expect(code(() => guardDoxTaskPatch(DOX, hdr(P), { status: 'not_started' }, task({ status: 'review' })))).toBe('dox_status_closed');
    expect(code(() => guardDoxTaskPatch(DOX, hdr(P), { status: 'done' }, task({ status: 'in_progress' })))).toBe('dox_status_closed');
    expect(code(() => guardDoxTaskPatch(DOX, hdr(P), { status: 'not_started' }, task({ status: 'triage' })))).toBe('dox_triage_closed');
    expect(code(() => guardDoxTaskPatch(DOX, hdr(P), { status: 'triage' }, task({ status: 'not_started' })))).toBe('dox_status_closed');
  });
  it('tags: removes only cockpit-owned and needs-pm-release; adds nothing on a worked task', () => {
    const out = guardDoxTaskPatch(DOX, hdr(P), { tags_remove: ['cockpit-owned', 'needs-pm-release'] }, task({ tags: ['cockpit-owned', 'needs-pm-release', 'keep'] }));
    expect(out).toEqual({ tags: ['keep'] });
    expect(code(() => guardDoxTaskPatch(DOX, hdr(P), { tags_remove: ['needs-mike'] }, task({ tags: ['needs-mike'] })))).toBe('dox_tag_closed');
    expect(code(() => guardDoxTaskPatch(DOX, hdr(P), { tags_remove: ['security'] }, task({ tags: ['security'] })))).toBe('dox_tag_closed');
    expect(code(() => guardDoxTaskPatch(DOX, hdr(P), { tags_add: ['triage:looks-done'] }, task()))).toBe('dox_tag_closed');
    expect(code(() => guardDoxTaskPatch(DOX, hdr(P), { tags_add: ['needs-mike'] }, task()))).toBe('dox_tag_closed');
  });
  it('a Triage card takes the looks-done tag and nothing else, from any project', () => {
    const t = task({ status: 'triage', project_id: OTHER, tags: ['a'] });
    expect(guardDoxTaskPatch(DOX, hdr(P), { tags_add: ['triage:looks-done'] }, t)).toEqual({ tags: ['a', 'triage:looks-done'] });
    expect(code(() => guardDoxTaskPatch(DOX, hdr(P), { tags_add: ['triage:looks-done'], assignee_id: 'u' }, t))).toBe('dox_triage_closed');
    expect(code(() => guardDoxTaskPatch(DOX, hdr(P), { assignee_id: 'u' }, t))).toBe('dox_triage_closed');
    expect(code(() => guardDoxTaskPatch(DOX, hdr(P), { tags_add: ['other'] }, t))).toBe('dox_triage_closed');
    expect(code(() => guardDoxTaskPatch(DOX, hdr(P), { tags_remove: ['cockpit-owned'] }, t))).toBe('dox_triage_closed');
  });
});

describe('Dox guard: projects', () => {
  const proj = (over: Partial<{ status: string; open_task_count: number; total_task_count: number }> = {}) => ({ id: P, status: 'ready', open_task_count: 0, total_task_count: 3, ...over });
  it('needs the header to name this very project', () => {
    expect(code(() => guardDoxProjectPatch(DOX, hdr(), { target_date: '2026-11-30T12:00:00Z' }, proj()))).toBe('dox_outside_project');
    expect(code(() => guardDoxProjectPatch(DOX, hdr(OTHER), { target_date: '2026-11-30T12:00:00Z' }, proj()))).toBe('dox_outside_project');
  });
  it('allows the dates and ordering-only, nothing else', () => {
    expect(() => guardDoxProjectPatch(DOX, hdr(P), { start_date: '2026-11-10T12:00:00Z', target_date: '2026-11-30T12:00:00Z', dependencies_ordering_only: true }, proj())).not.toThrow();
    for (const k of ['name', 'budget_amount', 'client_id', 'portal_visibility', 'plan_folder', 'is_retainer', 'lock_budget']) {
      expect(code(() => guardDoxProjectPatch(DOX, hdr(P), { [k]: 1 }, proj())), k).toBe('dox_field_closed');
    }
    expect(code(() => guardDoxProjectPatch(DOX, hdr(P), {}, proj()))).toBe('dox_field_closed');
  });
  it('status: ready -> in_progress; close only when every task is done; never queue -> ready, cancel or delete', () => {
    expect(() => guardDoxProjectPatch(DOX, hdr(P), { status: 'in_progress' }, proj())).not.toThrow();
    expect(code(() => guardDoxProjectPatch(DOX, hdr(P), { status: 'in_progress' }, proj({ status: 'queue' })))).toBe('dox_status_closed');
    expect(code(() => guardDoxProjectPatch(DOX, hdr(P), { status: 'ready' }, proj({ status: 'queue' })))).toBe('dox_status_closed');
    expect(() => guardDoxProjectPatch(DOX, hdr(P), { status: 'done' }, proj({ status: 'in_progress' }))).not.toThrow();
    expect(code(() => guardDoxProjectPatch(DOX, hdr(P), { status: 'done' }, proj({ status: 'in_progress', open_task_count: 1 })))).toBe('dox_project_open');
    expect(code(() => guardDoxProjectPatch(DOX, hdr(P), { status: 'done' }, proj({ status: 'in_progress', total_task_count: 0 })))).toBe('dox_project_open');
    expect(code(() => guardDoxProjectPatch(DOX, hdr(P), { status: 'done' }, proj({ status: 'ready' })))).toBe('dox_status_closed');
    expect(code(() => guardDoxProjectPatch(DOX, hdr(P), { status: 'cancelled' }, proj()))).toBe('dox_status_closed');
    expect(code(() => guardDoxProjectPatch(DOX, hdr(P), { status: 'in_progress', target_date: 'x' }, proj()))).toBe('dox_field_closed');
  });
});

describe('Dox guard: waits, comments, snapshot reads', () => {
  it('no price review, and no resolve as sent, signed or approved', () => {
    expect(code(() => guardDoxWaitCreate(DOX, { template_key: 'charter.price_review' }))).toBe('dox_wait_closed');
    expect(() => guardDoxWaitCreate(DOX, { template_key: 'handoff.generic' })).not.toThrow();
    for (const resolution of ['sent', 'signed', 'approved']) expect(code(() => guardDoxWaitPatch(DOX, { action: 'resolve', resolution }))).toBe('dox_wait_closed');
    expect(() => guardDoxWaitPatch(DOX, { action: 'resolve', resolution: 'completed' })).not.toThrow();
    expect(() => guardDoxWaitPatch(DOX, { action: 'redate' })).not.toThrow();
  });
  it('a comment is internal; a client-visible one or a client question is refused', () => {
    expect(guardDoxComment(DOX, {})).toEqual({ is_internal: true });
    expect(code(() => guardDoxComment(DOX, { client_visible: true }))).toBe('dox_client_closed');
    expect(code(() => guardDoxComment(DOX, { client_question: true }))).toBe('dox_client_closed');
  });
  it('the snapshot is for the Dox lane or the owner session, not another key', () => {
    const owner = 'owner-1';
    expect(mayReadSnapshot({ lane: 'dox', via: 'api_key', userId: 'bot', role: 'pm' }, owner)).toBe(true);
    expect(mayReadSnapshot({ via: 'session', userId: owner, role: 'admin' }, owner)).toBe(true);
    expect(mayReadSnapshot({ via: 'session', userId: 'other', role: 'admin' }, owner)).toBe(false);
    expect(mayReadSnapshot({ via: 'api_key', userId: owner, role: 'admin' }, owner)).toBe(false);
    expect(mayReadSnapshot({ lane: 'bast', via: 'api_key', userId: 'bot', role: 'pm' }, owner)).toBe(false);
  });
  it('reads the project header only when it is an id', () => {
    expect(doxProjectOf(hdr(P))).toBe(P);
    expect(doxProjectOf(hdr('not-an-id'))).toBeNull();
    expect(doxProjectOf(hdr())).toBeNull();
  });
});
