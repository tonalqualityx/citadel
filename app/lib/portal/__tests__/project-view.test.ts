import { describe, it, expect } from 'vitest';
import {
  buildPhaseList,
  classifyResourceLink,
  computeProgress,
  currentPhaseName,
  isAwaitingClient,
  isTaskDone,
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
    const staged = task({ id: '1', status: 'review', staging_preview_url: 'https://p.example', approved: false });
    expect(isAwaitingClient(staged)).toBe(true);
    expect(computeProgress([staged])).toEqual({ done: 0, total: 1 });
  });

  it('a done task with a leftover preview is finished, not awaiting the client', () => {
    const stale = task({ id: '1', status: 'done', staging_preview_url: 'https://p.example', approved: false });
    expect(isAwaitingClient(stale)).toBe(false);
    expect(computeProgress([stale])).toEqual({ done: 1, total: 1 });
  });

  it('shows an approved-then-abandoned task as Closed, not done, and leaves it out of the counts', () => {
    const t = task({ id: '1', status: 'abandoned', client_approved_at: new Date() });
    expect(isTaskDone(t)).toBe(false);
    expect(toClientTask(t)).toMatchObject({ status_label: 'Closed', is_done: false });
    expect(computeProgress([t])).toEqual({ done: 0, total: 0 });
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
  const staff = { name: 'Sabeen Khan', email: 'sabeen@becomeindelible.com' };
  const q = (over: Partial<Parameters<typeof latestClientComment>[0] extends (infer C)[] | undefined ? C : never> = {}) => ({
    content: 'Which logo do you prefer?',
    created_at: '2026-10-20T10:00:00Z',
    is_internal: false,
    client_question: true,
    user: staff,
    ...over,
  });

  it('shows only a flagged, client-visible question from a team member', () => {
    expect(latestClientComment([q()])?.content).toBe('Which logo do you prefer?');
    expect(toClientRequest({ id: 't', title: 'Logo', comments: [q()] }).question).toBe('Which logo do you prefer?');
  });

  it('never returns an internal note, an unflagged comment, or a worker comment', () => {
    expect(latestClientComment([q({ is_internal: true })])).toBeNull();
    expect(latestClientComment([q({ client_question: false })])).toBeNull();
    expect(latestClientComment([q({ client_question: undefined })])).toBeNull();
    expect(latestClientComment([q({ user: { name: 'Bast', email: 'bast@becomeindelible.com' } })])).toBeNull();
    expect(latestClientComment([q({ user: { name: 'Worker', email: 'bast-worker@becomeindelible.com' } })])).toBeNull();
  });

  it('hides a comment that names Bast or its own author', () => {
    expect(latestClientComment([q({ content: 'Bast could not decide, which logo?' })])).toBeNull();
    expect(latestClientComment([q({ content: 'Which logo? Thanks, Sabeen' })])).toBeNull();
    expect(latestClientComment([q({ content: 'Sabeen Khan asks which logo' })])).toBeNull();
    // "Bast" is matched as a word; Sebastian passes, as an author name or in the text.
    expect(latestClientComment([q({ content: 'Sebastian asked which logo you prefer?' })])?.content).toBeTruthy();
    expect(latestClientComment([q({ user: { name: 'Sebastian Cruz', email: 'sc@x.example' }, content: 'Which logo?' })])?.content).toBe('Which logo?');
    expect(latestClientComment([q({ user: { name: 'Sebastian Cruz', email: 'bast@x.example' } })])).toBeNull();
    // Bare first name: capitalised and mid-sentence is hidden, sentence-start is not.
    const will = { name: 'Will Parker', email: 'w@x.example' };
    expect(latestClientComment([q({ user: will, content: 'Will you send the logo files?' })])?.content).toBeTruthy();
    expect(latestClientComment([q({ user: will, content: 'We need them soon. Will you send the logo files?' })])?.content).toBeTruthy();
    expect(latestClientComment([q({ user: will, content: 'Which logo? Thanks, Will' })])).toBeNull();
    expect(latestClientComment([q({ content: 'Which logo? Thanks, Sabeen' })])).toBeNull();
    expect(latestClientComment([q({ content: 'Which logo? thanks, sabeen' })])?.content).toBeTruthy();
    // A different word that merely contains the name letters is fine.
    expect(latestClientComment([q({ content: 'Which logo works for the Sabeenish look?' })])?.content).toBeTruthy();
  });

  it('takes the newest qualifying comment and falls back to null', () => {
    const older = q({ content: 'Older question?', created_at: '2026-10-10T10:00:00Z' });
    const newest = q({ content: 'Newest question?', created_at: '2026-10-21T10:00:00Z' });
    const hidden = q({ content: 'Bast note', created_at: '2026-10-22T10:00:00Z' });
    expect(latestClientComment([older, hidden, newest])?.content).toBe('Newest question?');
    expect(toClientRequest({ id: 't', title: 'Logo', comments: [hidden] })).toEqual({ task_id: 't', title: 'Logo', question: null, asked_at: null });
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

  it('matches the whole first word, never a prefix', () => {
    for (const name of ['Reviews scraper (GitHub)', 'Uploads (Drive working)', 'Reviewer notes', 'Uploader tool', 'Preview site']) {
      expect(classifyResourceLink({ name, url: 'https://x.example/a', icon: null })).toBeNull();
    }
    expect(classifyResourceLink({ name: 'Review: site copy', url: 'https://x.example/a', icon: null })).toBe('review');
    expect(classifyResourceLink({ name: 'upload your files', url: 'https://x.example/a', icon: null })).toBe('upload');
    expect(classifyResourceLink({ name: 'Anything', url: 'https://x.example/a', icon: 'Review' })).toBe('review');
  });
});
