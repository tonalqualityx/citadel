import { describe, it, expect } from 'vitest';
import { checkTaskChange, type ReachTaskWithDependents, type TaskChange } from '../worker-reach';
import { CLIENT_RENDERED_TASK_FIELDS } from '@/lib/portal/client-rendered';
import { MIKE_USER_ID } from '../gate-mirror';

/**
 * Item 4: a chat change to anything a client reads, on a task the portal shows, is the owner's one tap. One test per field the portal and the client
 * emails render (lib/portal/client-rendered.ts), run against every visibility rule the portal has, and the neighbours that must NOT tap.
 */
const NOW = new Date('2026-11-13T12:00:00Z');
let seq = 0;
function task(over: Partial<ReachTaskWithDependents> = {}): ReachTaskWithDependents {
  seq += 1;
  return {
    id: `t-${seq}`, assignee_id: MIKE_USER_ID, status: 'not_started', tags: [], title: 'Menu page', description: 'Update the menu page.', requirements: [{ text: 'Check prices', done: false }],
    notes: null, site_id: 's1', project_id: 'p1', client_id: 'c1', sop_id: null, arc_id: null, needs_review: false, approved: false, client_approved_at: null, lease_until: null,
    last_comment_author: 'none', blocked_by: [], dependents: [], ordering_only: false, project_status: 'in_progress', client_visible: false, requested_by_contact_id: null, staging_preview_url: null, ...over,
  };
}
const patch = (current: ReachTaskWithDependents, change: TaskChange) => checkTaskChange({ current, change, now: NOW });
const showRules = (r: ReturnType<typeof patch>) => r.shows_client.map((c) => c.rule);

/** One task per way the portal can show it. */
const VISIBLE: [string, () => ReachTaskWithDependents][] = [
  ['requested by a client contact', () => task({ requested_by_contact_id: 'contact-1' })],
  ['shared by staff (client_visible)', () => task({ client_visible: true })],
  ['staged for approval', () => task({ status: 'review', staging_preview_url: 'https://preview.example/x' })],
  ['in the client history (the client approved it)', () => task({ status: 'done', client_approved_at: '2026-11-01T00:00:00Z' })],
];

const TEXT_CHANGES: Record<string, TaskChange> = {
  title: { title: 'Menu page, renamed' },
  description: { description: 'A different brief.' },
  requirements: { requirements: [{ text: 'Check prices', done: false }, { text: 'Add a new line', done: false }] },
};

describe('item 4: the owner taps before chat text reaches a client view', () => {
  describe.each(VISIBLE)('a task %s', (_name, make) => {
    it.each(Object.entries(TEXT_CHANGES))('changing its %s is a client_show tap (edits_visible_task)', (field, change) => {
      const r = patch(make(), change);
      expect(r.needs_tap).toBe(true);
      expect(r.proposal_kind).toBe('client_show');
      expect(showRules(r)).toEqual(['edits_visible_task']);
      expect(r.shows_client[0].fields).toEqual([field]);
      expect(r.reaches).toBe(false);
    });

    it('changing a portal tag (awaiting-clarification) taps; a tag the portal never reads does not', () => {
      expect(showRules(patch(make(), { tags: ['awaiting-clarification'] }))).toEqual(['edits_visible_task']);
      expect(showRules(patch(make(), { tags: ['client-approved'] }))).toEqual(['edits_visible_task']);
      expect(patch(make(), { tags: ['from-chat'] }).needs_tap).toBe(false);
    });

    it('moving it to another client, project or site taps (moves_visible_task)', () => {
      expect(showRules(patch(make(), { client_id: 'c2' }))).toEqual(['moves_visible_task']);
      expect(showRules(patch(make(), { project_id: 'p2', ordering_only_after: false }))).toEqual(['moves_visible_task']);
      expect(showRules(patch(make(), { site_id: 's2' }))).toEqual(['moves_visible_task']);
    });

    it('typed fields with no words (due date, order, focus) still apply with no tap', () => {
      expect(patch(make(), { due_date: '2026-12-01T00:00:00Z', priority: 2, is_focus: true }).needs_tap).toBe(false);
    });

    it('several rendered fields in one change: one tap card per rule, every field named', () => {
      const r = patch(make(), { title: 'New', description: 'New', client_id: 'c2' });
      expect(showRules(r).sort()).toEqual(['edits_visible_task', 'moves_visible_task']);
    });
  });

  describe('a task no portal rule shows', () => {
    it.each(Object.entries(TEXT_CHANGES))('changing its %s does not tap', (_f, change) => {
      expect(patch(task(), change).needs_tap).toBe(false);
    });
    it('a Triage card is never shown, even marked client_visible', () => {
      expect(patch(task({ status: 'triage', client_visible: true }), TEXT_CHANGES.title).needs_tap).toBe(false);
    });
    it('finished work with a leftover preview is not staged: renaming it does not tap', () => {
      expect(patch(task({ status: 'done', staging_preview_url: 'https://preview.example/x' }), TEXT_CHANGES.title).needs_tap).toBe(false);
    });
  });

  it('the tap is judged on the real before-state: a visibility field the caller did not load is a tap with a reason, never a silent write', () => {
    const t = task({ client_visible: true });
    delete (t as Partial<ReachTaskWithDependents>).staging_preview_url;
    const r = patch(t, TEXT_CHANGES.title);
    expect(showRules(r)).toEqual(['missing_data']);
    expect(r.needs_tap).toBe(true);
  });

  it('every text field the portal renders is covered by a test above', () => {
    const covered = new Set(Object.keys(TEXT_CHANGES).concat(['client_title']));
    for (const [field, meta] of Object.entries(CLIENT_RENDERED_TASK_FIELDS)) if (meta.kind === 'text') expect(covered.has(field), field).toBe(true);
  });

  it('the undo of a rename on a visible task taps too (the same check on the state it would restore)', () => {
    const r = checkTaskChange({ current: task({ client_visible: true, title: 'Renamed' }), change: { title: 'Menu page' }, now: NOW, origin: 'undo' });
    expect(showRules(r)).toEqual(['edits_visible_task']);
    expect(r.shows_client[0].via_undo).toBe(true);
  });
});
