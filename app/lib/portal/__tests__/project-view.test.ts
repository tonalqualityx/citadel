import { describe, it, expect } from 'vitest';
import {
  buildPhaseList,
  classifyResourceLink,
  computeProgress,
  currentPhaseName,
  isAwaitingClient,
  latestClientComment,
  reviewLink,
  toClientLinks,
  toClientRequest,
  toClientTask,
  type ViewTask,
} from '../project-view';

const task = (over: Partial<ViewTask> & { id: string }): ViewTask => ({
  title: `Task ${over.id}`,
  status: 'in_progress',
  requested_by_contact_id: 'c1',
  ...over,
});

describe('computeProgress', () => {
  it('counts done over total and excludes abandoned work', () => {
    const tasks = [
      task({ id: '1', status: 'done' }),
      task({ id: '2', status: 'in_progress' }),
      task({ id: '3', status: 'abandoned' }),
      task({ id: '4', status: 'not_started' }),
    ];
    expect(computeProgress(tasks)).toEqual({ done: 1, total: 3 });
  });

  it('does not count staged, unapproved work as done', () => {
    const staged = task({ id: '1', status: 'done', staging_preview_url: 'https://p.example', approved: false });
    expect(isAwaitingClient(staged)).toBe(true);
    expect(computeProgress([staged])).toEqual({ done: 0, total: 1 });
  });

  it('counts a client-approved task as done', () => {
    const t = task({ id: '1', status: 'in_progress', client_approved_at: new Date() });
    expect(computeProgress([t])).toEqual({ done: 1, total: 1 });
  });
});

describe('buildPhaseList', () => {
  const phases = [
    { id: 'p3', name: 'Launch', sort_order: 3 },
    { id: 'p1', name: 'Design', sort_order: 1 },
    { id: 'p2', name: 'Build', sort_order: 2 },
    { id: 'px', name: 'Internal QA', sort_order: 4 },
  ];
  const tasks = [
    task({ id: '1', status: 'done', phase_id: 'p1' }),
    task({ id: '2', status: 'in_progress', phase_id: 'p2' }),
    task({ id: '3', status: 'not_started', phase_id: 'p3' }),
  ];

  it('orders by sort_order, marks done, current and upcoming, and hides phases with no visible task', () => {
    const list = buildPhaseList(phases, tasks);
    expect(list.map((p) => [p.name, p.state])).toEqual([
      ['Design', 'done'],
      ['Build', 'current'],
      ['Launch', 'upcoming'],
    ]);
    expect(currentPhaseName(list)).toBe('Build');
  });

  it('reports the last phase when everything is done and null with no phases', () => {
    const done = tasks.map((t) => ({ ...t, status: 'done' }));
    expect(currentPhaseName(buildPhaseList(phases, done))).toBe('Launch');
    expect(currentPhaseName([])).toBeNull();
  });
});

describe('toClientTask', () => {
  it('returns only client-safe fields', () => {
    const row = {
      ...task({ id: '1', status: 'blocked' }),
      estimated_minutes: 90,
      assignee_id: 'u1',
      tags: ['bast-doable'],
    } as ViewTask;
    const out = toClientTask(row, 'Build');
    expect(Object.keys(out).sort()).toEqual(['awaiting_you', 'completed_at', 'id', 'is_done', 'phase', 'status_label', 'title']);
    expect(out.status_label).toBe('In progress');
  });
});

describe('client comments and requests', () => {
  it('never returns an internal comment', () => {
    const comments = [
      { content: 'Internal: Bast ran the thing', created_at: '2026-10-21T10:00:00Z', is_internal: true },
      { content: 'Which logo should we use?', created_at: '2026-10-20T10:00:00Z', is_internal: false },
    ];
    expect(latestClientComment(comments)?.content).toBe('Which logo should we use?');
    expect(toClientRequest({ id: 't', title: 'Logo', comments }).question).toBe('Which logo should we use?');
  });

  it('returns a null question when only internal comments exist', () => {
    const out = toClientRequest({ id: 't', title: 'Logo', comments: [{ content: 'x', created_at: '2026-10-21T10:00:00Z', is_internal: true }] });
    expect(out).toEqual({ task_id: 't', title: 'Logo', question: null, asked_at: null });
  });
});

describe('links', () => {
  it('shows only links marked for the client and only http(s)', () => {
    const links = toClientLinks([
      { name: 'Figma', url: 'https://figma.com/x', icon: 'figma' },
      { name: 'Review site copy', url: 'https://review.example/p', icon: null },
      { name: 'Files', url: 'https://drive.example/u', icon: 'upload' },
      { name: 'Review bad', url: 'javascript:alert(1)', icon: 'review' },
    ]);
    expect(links.map((l) => [l.name, l.kind])).toEqual([
      ['Review site copy', 'review'],
      ['Files', 'upload'],
    ]);
    expect(reviewLink(links)).toBe('https://review.example/p');
    expect(classifyResourceLink({ name: 'GitHub', url: 'https://github.com/x', icon: 'github' })).toBeNull();
  });
});
