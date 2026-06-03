import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    troubadorSchedule: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    troubadorRun: {
      create: vi.fn(),
    },
  },
}));

vi.mock('../troubador-notifications', () => ({
  notifyTroubadorRunCreated: vi.fn().mockResolvedValue(undefined),
}));

import { prisma } from '@/lib/db/prisma';
import { instantiateDueRuns } from '../troubador-scheduler';

const mockFindMany = prisma.troubadorSchedule.findMany as Mock;
const mockUpdate = prisma.troubadorSchedule.update as Mock;
const mockCreate = prisma.troubadorRun.create as Mock;

const NOW = new Date('2026-06-03T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

// Base schedule: 4 articles, 2/week → coverage 14 days, lead 7 → re-run every 7 days.
function schedule(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sched-1',
    client_id: 'client-1',
    site_id: 'site-1',
    name: 'Acme Content',
    status: 'active',
    is_deleted: false,
    target_article_count: 4,
    publish_per_week: 2,
    lead_time_days: 7,
    overarching_goals: 'Build authority',
    default_assignee_id: 'editor-1',
    allow_concurrent: false,
    start_date: new Date('2026-01-01T00:00:00.000Z'),
    skip_next: false,
    last_run_at: null,
    runs: [],
    client: { id: 'client-1', name: 'Acme' },
    site: { id: 'site-1' },
    ...overrides,
  };
}

describe('instantiateDueRuns', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockResolvedValue({ id: 'run-new' });
    mockUpdate.mockResolvedValue({});
  });

  it('creates a first run when last_run_at is null and start_date has passed', async () => {
    mockFindMany.mockResolvedValue([schedule()]);

    const result = await instantiateDueRuns(NOW);

    expect(result.runs_created).toBe(1);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const created = mockCreate.mock.calls[0][0].data;
    expect(created.client_id).toBe('client-1');
    expect(created.site_id).toBe('site-1');
    expect(created.schedule_id).toBe('sched-1');
    expect(created.stage).toBe('planning');
    expect(created.assignee_id).toBe('editor-1'); // inherits schedule default editor
    expect(created.brief).toBe('Build authority');
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'sched-1' },
      data: { last_run_at: NOW },
    });
  });

  it('skips when now is before start_date', async () => {
    mockFindMany.mockResolvedValue([
      schedule({ start_date: new Date('2026-12-01T00:00:00.000Z') }),
    ]);

    const result = await instantiateDueRuns(NOW);

    expect(result.runs_created).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.details[0].reason).toBe('before start date');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('skips (no stacking) when an open run exists and allow_concurrent is false', async () => {
    mockFindMany.mockResolvedValue([
      schedule({ runs: [{ id: 'r1', stage: 'in_production', created_at: NOW }] }),
    ]);

    const result = await instantiateDueRuns(NOW);

    expect(result.runs_created).toBe(0);
    expect(result.details[0].reason).toBe('prior run still open');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('allows stacking when allow_concurrent is true despite an open run', async () => {
    mockFindMany.mockResolvedValue([
      schedule({
        allow_concurrent: true,
        last_run_at: null,
        runs: [{ id: 'r1', stage: 'in_production', created_at: NOW }],
      }),
    ]);

    const result = await instantiateDueRuns(NOW);

    expect(result.runs_created).toBe(1);
  });

  it('does NOT count done/cancelled runs as open', async () => {
    mockFindMany.mockResolvedValue([
      schedule({
        last_run_at: null,
        runs: [
          { id: 'r1', stage: 'done', created_at: NOW },
          { id: 'r2', stage: 'cancelled', created_at: NOW },
        ],
      }),
    ]);

    const result = await instantiateDueRuns(NOW);

    expect(result.runs_created).toBe(1);
  });

  it('skips when the calendar is still full (lead time not reached)', async () => {
    // coverage 14d, lead 7d → re-run 7d after last run. Last run 3 days ago → not due.
    mockFindMany.mockResolvedValue([
      schedule({ last_run_at: new Date(NOW.getTime() - 3 * DAY) }),
    ]);

    const result = await instantiateDueRuns(NOW);

    expect(result.runs_created).toBe(0);
    expect(result.details[0].reason).toBe('calendar still full');
  });

  it('creates a run when the lead-time window has been reached', async () => {
    // Last run 8 days ago → past the 7-day re-run point → due.
    mockFindMany.mockResolvedValue([
      schedule({ last_run_at: new Date(NOW.getTime() - 8 * DAY) }),
    ]);

    const result = await instantiateDueRuns(NOW);

    expect(result.runs_created).toBe(1);
  });

  it('consumes skip_next without creating a run, advancing last_run_at', async () => {
    mockFindMany.mockResolvedValue([schedule({ skip_next: true })]);

    const result = await instantiateDueRuns(NOW);

    expect(result.runs_created).toBe(0);
    expect(result.details[0].reason).toBe('skip-once');
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'sched-1' },
      data: { skip_next: false, last_run_at: NOW },
    });
  });

  it('creates at most one run per schedule per call (no backfill)', async () => {
    // Last run 100 days ago — many intervals elapsed, but only one run should be created.
    mockFindMany.mockResolvedValue([
      schedule({ last_run_at: new Date(NOW.getTime() - 100 * DAY) }),
    ]);

    const result = await instantiateDueRuns(NOW);

    expect(result.runs_created).toBe(1);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('handles invalid cadence (publish_per_week <= 0) without dividing by zero', async () => {
    // perWeek 0 → coverage defaults to count*7 = 28 days; lead 7 → re-run after 21 days.
    // Last run 10 days ago → not due.
    mockFindMany.mockResolvedValue([
      schedule({ publish_per_week: 0, last_run_at: new Date(NOW.getTime() - 10 * DAY) }),
    ]);

    const result = await instantiateDueRuns(NOW);

    expect(result.runs_created).toBe(0);
    expect(result.details[0].reason).toBe('calendar still full');
  });
});
