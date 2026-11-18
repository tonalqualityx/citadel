import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/services/activity', () => ({ logUpdate: vi.fn(async () => undefined) }));

import { logUpdate } from '@/lib/services/activity';
import { BAST_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { runApproveSweep, skipReason, looksLikeSecurity, normalizeNames, sweepLine, isClientFacingTag, type SweepRow, type SweepDb } from '../approve-sweep';
import { textRefusal } from '../summaries';

const NOW = new Date('2026-11-18T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const HUMAN = '3ecfb7be-20bb-43cb-9b4d-31c44337dc81';
const OWNER = HUMAN;

const row = (over: Partial<SweepRow> = {}): SweepRow => ({
  id: 't1',
  title: 'Write the report',
  assignee_id: BAST_USER_ID,
  tags: [],
  completed_at: daysAgo(5),
  updated_at: daysAgo(5),
  client_approved_at: null,
  staging_preview_url: null,
  requested_by_contact_id: null,
  client_id: null,
  client_visible: false,
  comments: [{ user_id: BAST_USER_ID }],
  project: { id: 'p1', name: 'Internal tools' },
  ...over,
});

function fakeDb(rows: SweepRow[]) {
  const findMany = vi.fn(async () => rows);
  const updateMany = vi.fn(async () => ({ count: 1 }));
  const client = { findMany: vi.fn(async () => [{ name: 'Trinity Industries, Inc.' }]) };
  const project = { findMany: vi.fn(async () => [{ name: 'Stronghold Stuff website and store' }]) };
  return { db: { task: { findMany, updateMany }, client, project } as unknown as SweepDb, findMany, updateMany };
}

beforeEach(() => vi.clearAllMocks());

describe('skipReason', () => {
  it('qualifies a bot task finished 5 days ago with only bot comments', () => {
    expect(skipReason(row(), NOW)).toBeNull();
  });
  it('skips a task finished 2 days ago', () => {
    expect(skipReason(row({ completed_at: daysAgo(2), updated_at: daysAgo(2) }), NOW)).toBe('too_recent');
  });
  it('uses updated_at when completed_at is null', () => {
    expect(skipReason(row({ completed_at: null, updated_at: daysAgo(1) }), NOW)).toBe('too_recent');
    expect(skipReason(row({ completed_at: null, updated_at: daysAgo(6) }), NOW)).toBeNull();
  });
  it('skips a human-assigned task and an unassigned one', () => {
    expect(skipReason(row({ assignee_id: HUMAN }), NOW)).toBe('not_bot_assignee');
    expect(skipReason(row({ assignee_id: null }), NOW)).toBe('not_bot_assignee');
  });
  it('skips a task with a human comment, and a client contact comment (no user)', () => {
    expect(skipReason(row({ comments: [{ user_id: BAST_USER_ID }, { user_id: HUMAN }] }), NOW)).toBe('human_comment');
    expect(skipReason(row({ comments: [{ user_id: null }] }), NOW)).toBe('human_comment');
  });
  it('skips client facing tags, client- prefixed tags and client approval signals', () => {
    expect(skipReason(row({ tags: ['staged'] }), NOW)).toBe('client_facing');
    expect(skipReason(row({ tags: ['kind:content', 'client-approved'] }), NOW)).toBe('client_facing');
    expect(skipReason(row({ tags: ['client-acme'] }), NOW)).toBe('client_facing');
    expect(skipReason(row({ tags: ['needs-mike'] }), NOW)).toBe('client_facing');
    expect(skipReason(row({ staging_preview_url: 'https://x.test' }), NOW)).toBe('client_facing');
    expect(skipReason(row({ requested_by_contact_id: 'c1' }), NOW)).toBe('client_facing');
    expect(skipReason(row({ client_id: 'c1' }), NOW)).toBe('client_facing');
    expect(skipReason(row({ client_visible: true }), NOW)).toBe('client_facing');
    expect(skipReason(row({ project: { id: 'p', name: 'P', client_id: 'c1' } }), NOW)).toBe('client_facing');
    expect(isClientFacingTag('bast-doable')).toBe(false);
  });
});

describe('security hard exclusion', () => {
  it('excludes the Saiph advisory case that must never regress, checked before anything else', () => {
    const saiph = row({ title: 'Saiph: a high security advisory could not be filed (follow-redirects)', tags: ['job-watch', 'job-watch:saiph-stack-watch'] });
    expect(skipReason(saiph, NOW)).toBe('security');
    expect(skipReason({ ...saiph, assignee_id: HUMAN, completed_at: daysAgo(0) }, NOW)).toBe('security');
  });
  it('matches tags and titles case-insensitively', () => {
    for (const tag of ['Security', 'CVE-2026-1', 'sign-in-alert', 'canary', 'job-watch:saiph-stack-watch', 'Backdoor']) expect(looksLikeSecurity('Plain', [tag])).toBe(true);
    for (const title of ['Possible COMPROMISE on site', 'Fix CVE-2026-1234', 'Rotate the Secret Key', 'Unauthorized login', 'AWS Access Key', 'Credential reset', 'A data BREACH', 'Malware scan']) expect(looksLikeSecurity(title, [])).toBe(true);
  });
  it('does not flag ordinary tasks', () => {
    expect(looksLikeSecurity('Write the report', ['bast-doable', 'job-watch'])).toBe(false);
  });
});

describe('client name fallback', () => {
  const names = normalizeNames(['Trinity Industries, Inc.', 'Stronghold Stuff website and store', 'AB']);
  it('skips a task with no client and no project whose title carries a client or project name', () => {
    expect(skipReason(row({ project: null, title: 'Stronghold Stuff website and store: fix home' }), NOW, names)).toBe('client_name');
    expect(skipReason(row({ project: null, title: 'Stronghold Stuff: apply round comments on home' }), NOW, names)).toBe('client_name');
    expect(skipReason(row({ project: null, title: 'Email to trinity industries about hosting' }), NOW, names)).toBe('client_name');
  });
  it('does not skip an unrelated title, and ignores names too short to compare', () => {
    expect(skipReason(row({ project: null, title: 'Stopped: Sent-mail reconciler' }), NOW, names)).toBeNull();
    expect(names.some((n) => n.trim().length < 3)).toBe(false);
  });
  it('matches whole words only', () => {
    expect(skipReason(row({ project: null, title: 'Trinityx industriesy' }), NOW, names)).toBeNull();
  });
  it('only runs for tasks with no client and no project', () => {
    expect(skipReason(row({ project: null, title: 'Trinity Industries, Inc. thing' }), NOW, names)).toBe('client_name');
    expect(skipReason(row({ project: null, title: 'Trinity Industries, Inc. thing', client_id: 'c1' }), NOW, names)).toBe('client_facing');
  });
});

describe('runApproveSweep', () => {
  const rows = [
    row({ id: 'ok' }),
    row({ id: 'recent', completed_at: daysAgo(2), updated_at: daysAgo(2) }),
    row({ id: 'human', assignee_id: HUMAN }),
    row({ id: 'commented', comments: [{ user_id: HUMAN }] }),
    row({ id: 'client', tags: ['staged'] }),
  ];

  it('approves only the qualifying task, writes the approval and logs it as the sweep', async () => {
    const { db, updateMany } = fakeDb(rows);
    const r = await runApproveSweep(db, OWNER, NOW, { dryRun: false });
    expect(r.approved.map((i) => i.task_id)).toEqual(['ok']);
    expect(r.skipped).toEqual({ security: 0, too_recent: 1, not_bot_assignee: 1, human_comment: 1, client_facing: 1, client_name: 0 });
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'ok', approved: false, status: 'done', is_deleted: false },
      data: { approved: true, approved_at: NOW, approved_by_id: BAST_USER_ID },
    });
    expect(logUpdate).toHaveBeenCalledWith(BAST_USER_ID, 'task', 'ok', 'Write the report', {
      approved: { from: false, to: true },
      approval_source: { from: null, to: 'auto-approve-sweep' },
    });
    expect(r.line).toBe(sweepLine(1));
  });

  it('excludes a security task and a name-matched orphan in a run, and reports how many names it compared', async () => {
    const { db, updateMany } = fakeDb([
      row({ id: 'sec', title: 'Saiph: a high security advisory', tags: ['job-watch:saiph-stack-watch'], project: null }),
      row({ id: 'orphan', title: 'Stronghold Stuff website and store: apply comments', project: null }),
      row({ id: 'fine', title: 'Stopped: Sent-mail reconciler', project: null }),
    ]);
    const r = await runApproveSweep(db, OWNER, NOW, { dryRun: true });
    expect(r.approved.map((i) => i.task_id)).toEqual(['fine']);
    expect(r.skipped.security).toBe(1);
    expect(r.skipped.client_name).toBe(1);
    expect(r.names_compared).toBeGreaterThan(0);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('dry run writes nothing and lists everything it would approve', async () => {
    const { db, updateMany } = fakeDb([row({ id: 'a', title: 'A' }), row({ id: 'b', title: 'B' }), ...rows.slice(1)]);
    const r = await runApproveSweep(db, OWNER, NOW, { dryRun: true });
    expect(r.dry_run).toBe(true);
    expect(r.approved.map((i) => i.title)).toEqual(['A', 'B']);
    expect(updateMany).not.toHaveBeenCalled();
    expect(logUpdate).not.toHaveBeenCalled();
  });

  it('leaves a task alone when someone changed it before the write', async () => {
    const { db, updateMany } = fakeDb([row()]);
    updateMany.mockResolvedValueOnce({ count: 0 });
    const r = await runApproveSweep(db, OWNER, NOW, { dryRun: false });
    expect(r.approved).toEqual([]);
    expect(r.raced).toBe(1);
    expect(logUpdate).not.toHaveBeenCalled();
    expect(r.line).toBeNull();
  });

  it('starts from the review fold rule', async () => {
    const { db, findMany } = fakeDb([]);
    await runApproveSweep(db, OWNER, NOW, { dryRun: true });
    const where = (findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where;
    expect(where).toMatchObject({ is_deleted: false, status: 'done', needs_review: true, approved: false, OR: [{ reviewer_id: null }, { reviewer_id: OWNER }] });
  });
});

describe('sweepLine', () => {
  it('is null for none, plain for some, and passes the house text rules', () => {
    expect(sweepLine(0)).toBeNull();
    for (const n of [1, 12]) expect(textRefusal(sweepLine(n) as string, 60)).toBeNull();
    expect(sweepLine(1)).toContain('Signed off 1 piece of finished work ');
    expect(sweepLine(12)).toContain('Signed off 12 pieces of finished work');
  });
});
