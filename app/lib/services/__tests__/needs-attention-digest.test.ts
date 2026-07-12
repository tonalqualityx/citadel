import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Prisma and the email service before importing the module under test.
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: { findMany: vi.fn() },
    article: { findMany: vi.fn() },
  },
}));
vi.mock('@/lib/services/email', () => ({
  sendEmail: vi.fn(),
}));
// The digest fires client review reminders as a side effect — stubbed here; the actual sending
// behavior (throttle, OFF-by-default, recipient resolution) is covered in its own test file.
vi.mock('@/lib/services/client-review-reminders', () => ({
  sendClientReviewReminders: vi.fn().mockResolvedValue({ sent: 0, skipped: 0 }),
}));

import { prisma } from '@/lib/db/prisma';
import { sendEmail } from '@/lib/services/email';
import { sendClientReviewReminders } from '@/lib/services/client-review-reminders';
import {
  gatherNeedsAttention,
  buildDigestEmail,
  sendNeedsAttentionDigest,
  STALE_IN_PROGRESS_DAYS,
  STALE_CLIENT_REVIEW_DAYS,
} from '../needs-attention-digest';
import type { Mock } from 'vitest';

const mockTaskFindMany = prisma.task.findMany as Mock;
const mockArticleFindMany = prisma.article.findMany as Mock;
const mockSendEmail = sendEmail as Mock;
const mockSendReminders = sendClientReviewReminders as Mock;

let now: Date;

function task(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: overrides.id ?? 'id-1',
    title: overrides.title ?? 'A task',
    priority: overrides.priority ?? 2,
    status: overrides.status ?? 'not_started',
    created_at: overrides.created_at ?? new Date('2026-06-01T00:00:00Z'),
    updated_at: overrides.updated_at ?? new Date('2026-06-01T00:00:00Z'),
    ...overrides,
  };
}

function blocker(status: string, approved: boolean, orderingOnly: boolean | null = false) {
  return {
    status,
    approved,
    project: orderingOnly === null ? null : { dependencies_ordering_only: orderingOnly },
  };
}

/**
 * Route prisma.task.findMany calls to the right bucket result by inspecting the where
 * clause (mirrors the four queries in gatherNeedsAttention).
 */
function wireTaskQueries(opts: {
  needsMike?: unknown[];
  awaiting?: unknown[];
  blocked?: unknown[];
  inProgress?: unknown[];
}) {
  mockTaskFindMany.mockImplementation((args: { where: Record<string, unknown> }) => {
    const where = args.where as { tags?: { has?: string }; status?: unknown };
    if (where.tags?.has === 'needs-mike') return Promise.resolve(opts.needsMike ?? []);
    if (where.tags?.has === 'awaiting-clarification') return Promise.resolve(opts.awaiting ?? []);
    if (where.status === 'blocked') return Promise.resolve(opts.blocked ?? []);
    if (where.status === 'in_progress') return Promise.resolve(opts.inProgress ?? []);
    return Promise.resolve([]);
  });
}

/**
 * Route prisma.article.findMany calls to the right bucket result by inspecting the where
 * clause (mirrors the two article queries in gatherNeedsAttention: the in_review query and
 * the approved/scheduled query that feeds approvedUnscheduled + pastDueUnpublished).
 */
function wireArticleQueries(opts: { review?: unknown[]; approvedScheduled?: unknown[] }) {
  mockArticleFindMany.mockImplementation((args: { where: Record<string, unknown> }) => {
    const status = args.where.status as unknown;
    if (status === 'in_review') return Promise.resolve(opts.review ?? []);
    if (status && typeof status === 'object' && 'in' in (status as object)) {
      return Promise.resolve(opts.approvedScheduled ?? []);
    }
    return Promise.resolve([]);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  now = new Date('2026-06-21T12:00:00Z');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
  wireArticleQueries({});
});

afterEach(() => {
  vi.useRealTimers();
});

describe('gatherNeedsAttention — buckets', () => {
  it('populates needs-mike and awaiting-clarification from tags', async () => {
    wireTaskQueries({
      needsMike: [task({ id: 'a', title: 'Escalated thing' })],
      awaiting: [task({ id: 'b', title: 'Need an answer' })],
    });

    const data = await gatherNeedsAttention();

    expect(data.needsMike.map((t) => t.id)).toEqual(['a']);
    expect(data.needsMike[0].reason).toBe('Tagged needs-mike');
    expect(data.needsMike[0].url).toContain('/tasks/a');
    expect(data.awaitingClarification.map((t) => t.id)).toEqual(['b']);
  });

  it('surfaces blocked tasks whose blockers are all satisfied, hides those still blocked', async () => {
    wireTaskQueries({
      blocked: [
        task({ id: 'ready', status: 'blocked', blocked_by: [blocker('done', true)] }),
        task({ id: 'stillblocked', status: 'blocked', blocked_by: [blocker('in_progress', false)] }),
        task({ id: 'noblockers', status: 'blocked', blocked_by: [] }),
      ],
    });

    const data = await gatherNeedsAttention();
    const ids = data.stuck.map((t) => t.id);

    expect(ids).toContain('ready');
    expect(ids).toContain('noblockers'); // .every([]) === true
    expect(ids).not.toContain('stillblocked');
    expect(data.stuck.find((t) => t.id === 'ready')?.reason).toMatch(/Blocked/);
  });

  it('queries in_progress tasks with a staleness cutoff', async () => {
    wireTaskQueries({ inProgress: [task({ id: 'stale', status: 'in_progress' })] });

    const data = await gatherNeedsAttention();

    expect(data.stuck.map((t) => t.id)).toContain('stale');
    expect(data.stuck.find((t) => t.id === 'stale')?.reason).toContain(`${STALE_IN_PROGRESS_DAYS}`);

    // The in_progress query must restrict by updated_at < (now - STALE_IN_PROGRESS_DAYS).
    const inProgressCall = mockTaskFindMany.mock.calls.find(
      ([a]) => (a.where as { status?: string }).status === 'in_progress'
    );
    expect(inProgressCall).toBeDefined();
    const where = inProgressCall![0].where as { updated_at: { lt: Date } };
    const expectedCutoff = new Date(now.getTime() - STALE_IN_PROGRESS_DAYS * 24 * 60 * 60 * 1000);
    expect(where.updated_at.lt.getTime()).toBe(expectedCutoff.getTime());
  });

  it('dedups: a task tagged both needs-mike and awaiting appears once (in needs-mike)', async () => {
    const shared = task({ id: 'dup', title: 'Both tags' });
    wireTaskQueries({ needsMike: [shared], awaiting: [shared] });

    const data = await gatherNeedsAttention();

    expect(data.needsMike.map((t) => t.id)).toEqual(['dup']);
    expect(data.awaitingClarification.map((t) => t.id)).toEqual([]);
  });

  it('ranks by priority (1 highest) then oldest first', async () => {
    wireTaskQueries({
      needsMike: [
        task({ id: 'low', priority: 3, created_at: new Date('2026-06-01T00:00:00Z') }),
        task({ id: 'high', priority: 1, created_at: new Date('2026-06-10T00:00:00Z') }),
        task({ id: 'mid-old', priority: 2, created_at: new Date('2026-05-01T00:00:00Z') }),
        task({ id: 'mid-new', priority: 2, created_at: new Date('2026-06-05T00:00:00Z') }),
      ],
    });

    const data = await gatherNeedsAttention();
    expect(data.needsMike.map((t) => t.id)).toEqual(['high', 'mid-old', 'mid-new', 'low']);
  });

  it('maps articles in_review to digest items with run links', async () => {
    wireArticleQueries({
      review: [{ id: 'art1', title: 'Draft post', run_id: 'run9', created_at: new Date(), updated_at: now }],
    });
    wireTaskQueries({});

    const data = await gatherNeedsAttention();
    expect(data.articlesAwaitingReview).toEqual([
      { id: 'art1', title: 'Draft post', url: expect.stringContaining('/troubador/runs/run9') },
    ]);
  });

  it('populates approvedUnscheduled for approved articles with no publish date', async () => {
    wireArticleQueries({
      approvedScheduled: [
        { id: 'ap1', title: 'Ready to go', run_id: 'run1', status: 'approved', scheduled_date: null, published_url: null },
        { id: 'ap2', title: 'Already dated', run_id: 'run2', status: 'approved', scheduled_date: new Date('2026-07-01T00:00:00Z'), published_url: null },
      ],
    });
    wireTaskQueries({});

    const data = await gatherNeedsAttention();
    expect(data.approvedUnscheduled.map((a) => a.id)).toEqual(['ap1']);
    expect(data.approvedUnscheduled[0].reason).toBe('Approved — no publish date');
  });

  it('populates pastDueUnpublished for approved/scheduled articles whose date has passed and remain unpublished', async () => {
    wireArticleQueries({
      approvedScheduled: [
        { id: 'pd1', title: 'Overdue', run_id: 'run1', status: 'scheduled', scheduled_date: new Date('2026-06-01T00:00:00Z'), published_url: null },
        { id: 'pd2', title: 'Not due yet', run_id: 'run2', status: 'scheduled', scheduled_date: new Date('2026-07-01T00:00:00Z'), published_url: null },
        { id: 'pd3', title: 'Already published', run_id: 'run3', status: 'scheduled', scheduled_date: new Date('2026-06-01T00:00:00Z'), published_url: 'https://x.com/post' },
      ],
    });
    wireTaskQueries({});

    const data = await gatherNeedsAttention();
    expect(data.pastDueUnpublished.map((a) => a.id)).toEqual(['pd1']);
    expect(data.pastDueUnpublished[0].reason).toBe('Publish date passed');
  });

  it('populates staleClientReview only past STALE_CLIENT_REVIEW_DAYS, with a day count in the reason', async () => {
    wireArticleQueries({
      review: [
        { id: 'fresh', title: 'Just submitted', run_id: 'run1', created_at: new Date(), updated_at: new Date('2026-06-20T12:00:00Z') },
        { id: 'stale', title: 'Sitting a while', run_id: 'run2', created_at: new Date(), updated_at: new Date('2026-06-10T12:00:00Z') },
      ],
    });
    wireTaskQueries({});

    const data = await gatherNeedsAttention();
    expect(data.staleClientReview.map((a) => a.id)).toEqual(['stale']);
    expect(data.staleClientReview[0].reason).toBe(`Waiting on client 11 days`);
    expect(STALE_CLIENT_REVIEW_DAYS).toBe(5);
    // staleClientReview is a subset of articlesAwaitingReview — both articles still show there.
    expect(data.articlesAwaitingReview.map((a) => a.id).sort()).toEqual(['fresh', 'stale']);
  });
});

describe('buildDigestEmail', () => {
  const empty = {
    needsMike: [],
    awaitingClarification: [],
    stuck: [],
    articlesAwaitingReview: [],
    approvedUnscheduled: [],
    pastDueUnpublished: [],
    staleClientReview: [],
  };

  it('empty state: still produces a clear "nothing needs you" email', () => {
    const { subject, text, html } = buildDigestEmail(empty);
    expect(subject).toMatch(/nothing needs you/i);
    expect(text).toMatch(/all clear/i);
    expect(html).toContain('Nothing needs you');
  });

  it('non-empty: counts in subject, sections rendered, titles escaped', () => {
    const { subject, html, text } = buildDigestEmail({
      ...empty,
      needsMike: [{ id: 'a', title: 'Fix <b>thing</b>', priority: 1, status: 'not_started', reason: 'Tagged needs-mike', url: 'http://x/tasks/a' }],
      stuck: [{ id: 's', title: 'Stuck one', priority: 2, status: 'blocked', reason: 'Blocked, but all blockers are done', url: 'http://x/tasks/s' }],
      articlesAwaitingReview: [{ id: 'art', title: 'A post', url: 'http://x/troubador/runs/r' }],
    });

    expect(subject).toContain('3 items');
    expect(html).toContain('Needs you');
    expect(html).toContain('Stuck / stalled');
    expect(html).toContain('Articles awaiting review');
    expect(html).toContain('Fix &lt;b&gt;thing&lt;/b&gt;'); // escaped
    expect(text).toContain('Fix <b>thing</b>');
  });

  it('singular subject when exactly one item', () => {
    const { subject } = buildDigestEmail({
      ...empty,
      needsMike: [{ id: 'a', title: 'One', priority: 1, status: 'not_started', reason: 'Tagged needs-mike', url: 'http://x/tasks/a' }],
    });
    expect(subject).toContain('1 item');
    expect(subject).not.toContain('1 items');
  });

  it('renders approvedUnscheduled, pastDueUnpublished, and staleClientReview sections with reasons', () => {
    const { subject, html, text } = buildDigestEmail({
      ...empty,
      approvedUnscheduled: [
        { id: 'a1', title: 'No date yet', url: 'http://x/troubador/runs/r1', reason: 'Approved — no publish date' },
      ],
      pastDueUnpublished: [
        { id: 'a2', title: 'Overdue post', url: 'http://x/troubador/runs/r2', reason: 'Publish date passed' },
      ],
      staleClientReview: [
        { id: 'a3', title: 'Client sitting on it', url: 'http://x/troubador/runs/r3', reason: 'Waiting on client 7 days' },
      ],
    });

    expect(subject).toContain('3 items');
    expect(html).toContain('Approved — no publish date (1)');
    expect(html).toContain('Publish date passed (1)');
    expect(html).toContain('Waiting on client review (1)');
    expect(html).toContain('Waiting on client 7 days');
    expect(text).toContain('No date yet — Approved — no publish date');
    expect(text).toContain('Overdue post — Publish date passed');
    expect(text).toContain('Client sitting on it — Waiting on client 7 days');
  });

  it('omits a reason line for articlesAwaitingReview items (none set)', () => {
    const { html, text } = buildDigestEmail({
      ...empty,
      articlesAwaitingReview: [{ id: 'art', title: 'Plain review item', url: 'http://x/troubador/runs/r' }],
    });
    expect(html).not.toContain('undefined');
    expect(text).toContain('Plain review item\n');
  });
});

describe('sendNeedsAttentionDigest', () => {
  it('always sends and returns a summary, even when empty', async () => {
    wireTaskQueries({});
    mockArticleFindMany.mockResolvedValue([]);

    const summary = await sendNeedsAttentionDigest();

    expect(mockSendEmail).toHaveBeenCalledOnce();
    expect(summary.total).toBe(0);
    expect(summary.recipient).toBe('mike@becomeindelible.com');
    const sent = mockSendEmail.mock.calls[0][0];
    expect(sent.to).toBe('mike@becomeindelible.com');
    expect(sent.subject).toMatch(/nothing needs you/i);
  });

  it('reports counts per bucket', async () => {
    wireTaskQueries({
      needsMike: [task({ id: 'n1' }), task({ id: 'n2' })],
      awaiting: [task({ id: 'aw' })],
    });

    const summary = await sendNeedsAttentionDigest();
    expect(summary.counts.needsMike).toBe(2);
    expect(summary.counts.awaitingClarification).toBe(1);
    expect(summary.total).toBe(3);
  });

  it('honors DIGEST_RECIPIENT override', async () => {
    const prev = process.env.DIGEST_RECIPIENT;
    process.env.DIGEST_RECIPIENT = 'someone@else.com';
    wireTaskQueries({});

    const summary = await sendNeedsAttentionDigest();
    expect(summary.recipient).toBe('someone@else.com');

    if (prev === undefined) delete process.env.DIGEST_RECIPIENT;
    else process.env.DIGEST_RECIPIENT = prev;
  });

  it('triggers client review reminders for staleClientReview article ids', async () => {
    wireTaskQueries({});
    wireArticleQueries({
      review: [
        { id: 'stale1', title: 'Old one', run_id: 'run1', created_at: new Date(), updated_at: new Date('2026-06-01T00:00:00Z') },
      ],
    });

    await sendNeedsAttentionDigest();
    expect(mockSendReminders).toHaveBeenCalledWith(['stale1']);
  });

  it('does not call reminders when nothing is stale', async () => {
    wireTaskQueries({});
    wireArticleQueries({});

    await sendNeedsAttentionDigest();
    expect(mockSendReminders).not.toHaveBeenCalled();
  });

  it('never breaks the digest send when reminders throw', async () => {
    wireTaskQueries({});
    wireArticleQueries({
      review: [
        { id: 'stale1', title: 'Old one', run_id: 'run1', created_at: new Date(), updated_at: new Date('2026-06-01T00:00:00Z') },
      ],
    });
    mockSendReminders.mockRejectedValueOnce(new Error('smtp down'));

    const summary = await sendNeedsAttentionDigest();
    expect(mockSendEmail).toHaveBeenCalledOnce();
    expect(summary.counts.staleClientReview).toBe(1);
  });
});
