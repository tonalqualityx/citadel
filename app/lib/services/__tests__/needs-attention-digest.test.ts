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

import { prisma } from '@/lib/db/prisma';
import { sendEmail } from '@/lib/services/email';
import {
  gatherNeedsAttention,
  buildDigestEmail,
  sendNeedsAttentionDigest,
  STALE_IN_PROGRESS_DAYS,
} from '../needs-attention-digest';
import type { Mock } from 'vitest';

const mockTaskFindMany = prisma.task.findMany as Mock;
const mockArticleFindMany = prisma.article.findMany as Mock;
const mockSendEmail = sendEmail as Mock;

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

beforeEach(() => {
  vi.clearAllMocks();
  now = new Date('2026-06-21T12:00:00Z');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
  mockArticleFindMany.mockResolvedValue([]);
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
    mockArticleFindMany.mockResolvedValue([
      { id: 'art1', title: 'Draft post', run_id: 'run9', created_at: new Date() },
    ]);
    wireTaskQueries({});

    const data = await gatherNeedsAttention();
    expect(data.articlesAwaitingReview).toEqual([
      { id: 'art1', title: 'Draft post', url: expect.stringContaining('/troubador/runs/run9') },
    ]);
  });
});

describe('buildDigestEmail', () => {
  const empty = { needsMike: [], awaitingClarification: [], stuck: [], articlesAwaitingReview: [] };

  it('empty state: still produces a clear "nothing needs you" email', () => {
    const { subject, text, html } = buildDigestEmail(empty);
    expect(subject).toMatch(/nothing needs you/i);
    expect(text).toMatch(/all clear/i);
    expect(html).toContain('Nothing needs you');
  });

  it('non-empty: counts in subject, sections rendered, titles escaped', () => {
    const { subject, html, text } = buildDigestEmail({
      needsMike: [{ id: 'a', title: 'Fix <b>thing</b>', priority: 1, status: 'not_started', reason: 'Tagged needs-mike', url: 'http://x/tasks/a' }],
      awaitingClarification: [],
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
});
