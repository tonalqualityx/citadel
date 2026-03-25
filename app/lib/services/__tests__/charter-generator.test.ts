import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Prisma
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    charterGenerationLog: {
      findUnique: vi.fn(),
    },
  },
}));

import {
  getCharterPeriodString,
  getCharterPeriodEndDate,
  isCharterTaskDue,
} from '../charter-generator';
import { prisma } from '@/lib/db/prisma';
import type { Mock } from 'vitest';

const mockLogFindUnique = prisma.charterGenerationLog.findUnique as Mock;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getCharterPeriodString', () => {
  it('returns weekly period string with ISO week number', () => {
    // 2026-01-05 is a Monday in week 2
    const result = getCharterPeriodString(new Date(2026, 0, 5), 'weekly');
    expect(result).toMatch(/^2026-W\d{2}$/);
  });

  it('returns monthly period string', () => {
    const result = getCharterPeriodString(new Date(2026, 2, 15), 'monthly');
    expect(result).toBe('2026-03');
  });

  it('returns monthly period string with zero-padded month', () => {
    const result = getCharterPeriodString(new Date(2026, 0, 10), 'monthly');
    expect(result).toBe('2026-01');
  });

  it('returns quarterly period string for Q1', () => {
    const result = getCharterPeriodString(new Date(2026, 1, 15), 'quarterly');
    expect(result).toBe('2026-Q1');
  });

  it('returns quarterly period string for Q2', () => {
    const result = getCharterPeriodString(new Date(2026, 4, 15), 'quarterly');
    expect(result).toBe('2026-Q2');
  });

  it('returns quarterly period string for Q3', () => {
    const result = getCharterPeriodString(new Date(2026, 7, 15), 'quarterly');
    expect(result).toBe('2026-Q3');
  });

  it('returns quarterly period string for Q4', () => {
    const result = getCharterPeriodString(new Date(2026, 10, 15), 'quarterly');
    expect(result).toBe('2026-Q4');
  });

  it('returns semi-annual period string for H1', () => {
    const result = getCharterPeriodString(new Date(2026, 3, 15), 'semi_annually');
    expect(result).toBe('2026-H1');
  });

  it('returns semi-annual period string for H2', () => {
    const result = getCharterPeriodString(new Date(2026, 8, 15), 'semi_annually');
    expect(result).toBe('2026-H2');
  });

  it('returns annual period string', () => {
    const result = getCharterPeriodString(new Date(2026, 5, 15), 'annually');
    expect(result).toBe('2026');
  });
});

describe('getCharterPeriodEndDate', () => {
  it('returns end of month for monthly period', () => {
    const result = getCharterPeriodEndDate('2026-03', 'monthly');
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(2); // March (0-indexed)
    expect(result.getDate()).toBe(31);
    expect(result.getHours()).toBe(23);
    expect(result.getMinutes()).toBe(59);
  });

  it('returns end of February correctly', () => {
    const result = getCharterPeriodEndDate('2026-02', 'monthly');
    expect(result.getDate()).toBe(28);
  });

  it('returns end of February for leap year', () => {
    const result = getCharterPeriodEndDate('2028-02', 'monthly');
    expect(result.getDate()).toBe(29);
  });

  it('returns end of quarter for Q1', () => {
    const result = getCharterPeriodEndDate('2026-Q1', 'quarterly');
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(2); // March
    expect(result.getDate()).toBe(31);
  });

  it('returns end of quarter for Q2', () => {
    const result = getCharterPeriodEndDate('2026-Q2', 'quarterly');
    expect(result.getMonth()).toBe(5); // June
    expect(result.getDate()).toBe(30);
  });

  it('returns end of quarter for Q4', () => {
    const result = getCharterPeriodEndDate('2026-Q4', 'quarterly');
    expect(result.getMonth()).toBe(11); // December
    expect(result.getDate()).toBe(31);
  });

  it('returns end of H1 for semi-annual', () => {
    const result = getCharterPeriodEndDate('2026-H1', 'semi_annually');
    expect(result.getMonth()).toBe(5); // June
    expect(result.getDate()).toBe(30);
  });

  it('returns end of H2 for semi-annual', () => {
    const result = getCharterPeriodEndDate('2026-H2', 'semi_annually');
    expect(result.getMonth()).toBe(11); // December
    expect(result.getDate()).toBe(31);
  });

  it('returns end of year for annual', () => {
    const result = getCharterPeriodEndDate('2026', 'annually');
    expect(result.getMonth()).toBe(11); // December
    expect(result.getDate()).toBe(31);
  });

  it('returns a date within the correct week for weekly period', () => {
    const result = getCharterPeriodEndDate('2026-W10', 'weekly');
    expect(result.getFullYear()).toBe(2026);
    expect(result.getHours()).toBe(23);
    expect(result.getMinutes()).toBe(59);
    // The end date should be a Sunday (day 0)
    expect(result.getDay()).toBe(0);
  });
});

describe('isCharterTaskDue', () => {
  it('returns true when no generation log exists for the current period', async () => {
    mockLogFindUnique.mockResolvedValue(null);

    const result = await isCharterTaskDue('charter-1', 'task-1', 'monthly');

    expect(result).toBe(true);
    expect(mockLogFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          charter_id_scheduled_task_id_period: {
            charter_id: 'charter-1',
            scheduled_task_id: 'task-1',
            period: expect.any(String),
          },
        },
      })
    );
  });

  it('returns false when generation log exists for the current period', async () => {
    mockLogFindUnique.mockResolvedValue({
      id: 'log-1',
      charter_id: 'charter-1',
      scheduled_task_id: 'task-1',
      period: '2026-03',
      tasks_created: 1,
      tasks_abandoned: 0,
    });

    const result = await isCharterTaskDue('charter-1', 'task-1', 'monthly');

    expect(result).toBe(false);
  });

  it('queries with correct period string for weekly cadence', async () => {
    mockLogFindUnique.mockResolvedValue(null);

    await isCharterTaskDue('charter-1', 'task-1', 'weekly');

    const call = mockLogFindUnique.mock.calls[0][0];
    expect(call.where.charter_id_scheduled_task_id_period.period).toMatch(/^\d{4}-W\d{2}$/);
  });

  it('queries with correct period string for quarterly cadence', async () => {
    mockLogFindUnique.mockResolvedValue(null);

    await isCharterTaskDue('charter-1', 'task-1', 'quarterly');

    const call = mockLogFindUnique.mock.calls[0][0];
    expect(call.where.charter_id_scheduled_task_id_period.period).toMatch(/^\d{4}-Q\d$/);
  });
});
