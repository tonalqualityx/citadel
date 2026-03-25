import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Prisma
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    salesAutomationRule: {
      findMany: vi.fn(),
    },
    salesAutomationLog: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    accord: {
      findUniqueOrThrow: vi.fn(),
      findMany: vi.fn(),
    },
    task: {
      create: vi.fn(),
    },
  },
}));

import { fireStatusChangeRules, evaluateTimeBasedRules } from '../sales-automation';
import { prisma } from '@/lib/db/prisma';
import type { Mock } from 'vitest';

const mockRuleFindMany = prisma.salesAutomationRule.findMany as Mock;
const mockLogFindUnique = prisma.salesAutomationLog.findUnique as Mock;
const mockLogCreate = prisma.salesAutomationLog.create as Mock;
const mockAccordFindUniqueOrThrow = prisma.accord.findUniqueOrThrow as Mock;
const mockAccordFindMany = prisma.accord.findMany as Mock;
const mockTaskCreate = prisma.task.create as Mock;

const mockRule = {
  id: 'rule-1',
  name: 'Follow up after meeting',
  trigger_type: 'status_change',
  trigger_status: 'meeting',
  trigger_from_status: null,
  time_threshold_hours: null,
  action_type: 'create_task',
  task_template: {
    title: 'Follow up with {accord_name}',
    description: 'Send a recap email for {accord_name}',
    priority: 2,
    due_offset_hours: 24,
  },
  assignee_rule: 'accord_owner',
  assignee_user_id: null,
  assignee_user: null,
  is_active: true,
  sort_order: 0,
};

const mockAccord = {
  id: 'accord-1',
  name: 'Acme Website Redesign',
  owner_id: 'user-owner',
  status: 'meeting',
  entered_current_status_at: new Date('2026-03-01'),
  meeting_accords: [
    {
      meeting: {
        attendees: [
          { user_id: 'user-attendee-1' },
          { user_id: 'user-attendee-2' },
        ],
      },
    },
  ],
};

describe('fireStatusChangeRules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTaskCreate.mockResolvedValue({ id: 'task-new' });
    mockLogCreate.mockResolvedValue({});
  });

  it('finds matching rules and creates tasks', async () => {
    mockRuleFindMany.mockResolvedValue([mockRule]);
    mockAccordFindUniqueOrThrow.mockResolvedValue(mockAccord);
    mockLogFindUnique.mockResolvedValue(null);

    const results = await fireStatusChangeRules('accord-1', 'meeting' as any);

    expect(results).toHaveLength(1);
    expect(results[0].skipped).toBe(false);
    expect(results[0].taskIds).toHaveLength(1);

    expect(mockRuleFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          trigger_type: 'status_change',
          trigger_status: 'meeting',
          is_active: true,
        },
      })
    );

    expect(mockTaskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: 'Follow up with Acme Website Redesign',
          description: 'Send a recap email for Acme Website Redesign',
          assignee_id: 'user-owner',
          accord_id: 'accord-1',
          priority: 2,
          status: 'not_started',
        }),
      })
    );
  });

  it('logs execution after creating tasks', async () => {
    mockRuleFindMany.mockResolvedValue([mockRule]);
    mockAccordFindUniqueOrThrow.mockResolvedValue(mockAccord);
    mockLogFindUnique.mockResolvedValue(null);

    await fireStatusChangeRules('accord-1', 'meeting' as any);

    expect(mockLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          rule_id: 'rule-1',
          accord_id: 'accord-1',
          task_id: 'task-new',
        }),
      })
    );
  });

  it('skips already-fired rules (idempotency)', async () => {
    mockRuleFindMany.mockResolvedValue([mockRule]);
    mockAccordFindUniqueOrThrow.mockResolvedValue(mockAccord);
    mockLogFindUnique.mockResolvedValue({ id: 'log-existing' });

    const results = await fireStatusChangeRules('accord-1', 'meeting' as any);

    expect(results).toHaveLength(1);
    expect(results[0].skipped).toBe(true);
    expect(results[0].skipReason).toBe('already fired (log exists)');
    expect(mockTaskCreate).not.toHaveBeenCalled();
  });

  it('skips rule when from_status does not match', async () => {
    const ruleWithFromStatus = {
      ...mockRule,
      trigger_from_status: 'lead',
    };
    mockRuleFindMany.mockResolvedValue([ruleWithFromStatus]);
    mockAccordFindUniqueOrThrow.mockResolvedValue(mockAccord);

    const results = await fireStatusChangeRules('accord-1', 'meeting' as any, 'proposal' as any);

    expect(results).toHaveLength(1);
    expect(results[0].skipped).toBe(true);
    expect(results[0].skipReason).toContain('from_status mismatch');
    expect(mockTaskCreate).not.toHaveBeenCalled();
  });

  it('returns empty array when no rules match', async () => {
    mockRuleFindMany.mockResolvedValue([]);

    const results = await fireStatusChangeRules('accord-1', 'meeting' as any);

    expect(results).toEqual([]);
    expect(mockAccordFindUniqueOrThrow).not.toHaveBeenCalled();
  });
});

describe('evaluateTimeBasedRules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTaskCreate.mockResolvedValue({ id: 'task-new' });
    mockLogCreate.mockResolvedValue({});
  });

  it('evaluates time thresholds and fires matching rules', async () => {
    const timeRule = {
      ...mockRule,
      id: 'rule-time-1',
      trigger_type: 'time_based',
      time_threshold_hours: 48,
      trigger_status: 'meeting',
    };
    mockRuleFindMany.mockResolvedValue([timeRule]);

    // Accord has been in 'meeting' for 72 hours (exceeds 48h threshold)
    const accordInStatus = {
      ...mockAccord,
      entered_current_status_at: new Date(Date.now() - 72 * 60 * 60 * 1000),
    };
    mockAccordFindMany.mockResolvedValue([accordInStatus]);
    mockLogFindUnique.mockResolvedValue(null);

    const summary = await evaluateTimeBasedRules();

    expect(summary.rulesEvaluated).toBe(1);
    expect(summary.accordsChecked).toBe(1);
    expect(summary.tasksFired).toBe(1);
    expect(summary.errors).toHaveLength(0);
    expect(mockTaskCreate).toHaveBeenCalled();
  });

  it('skips accords that have not exceeded threshold', async () => {
    const timeRule = {
      ...mockRule,
      id: 'rule-time-1',
      trigger_type: 'time_based',
      time_threshold_hours: 48,
      trigger_status: 'meeting',
    };
    mockRuleFindMany.mockResolvedValue([timeRule]);

    // Accord has been in 'meeting' for only 12 hours (less than 48h threshold)
    const recentAccord = {
      ...mockAccord,
      entered_current_status_at: new Date(Date.now() - 12 * 60 * 60 * 1000),
    };
    mockAccordFindMany.mockResolvedValue([recentAccord]);

    const summary = await evaluateTimeBasedRules();

    expect(summary.rulesEvaluated).toBe(1);
    expect(summary.accordsChecked).toBe(1);
    expect(summary.tasksFired).toBe(0);
    expect(mockTaskCreate).not.toHaveBeenCalled();
  });

  it('skips non-matching accords (different status)', async () => {
    const timeRule = {
      ...mockRule,
      id: 'rule-time-1',
      trigger_type: 'time_based',
      time_threshold_hours: 24,
      trigger_status: 'proposal',
    };
    mockRuleFindMany.mockResolvedValue([timeRule]);

    // Accord is in 'meeting' status, rule triggers on 'proposal'
    const accordInMeeting = {
      ...mockAccord,
      status: 'meeting',
      entered_current_status_at: new Date(Date.now() - 72 * 60 * 60 * 1000),
    };
    mockAccordFindMany.mockResolvedValue([accordInMeeting]);

    const summary = await evaluateTimeBasedRules();

    expect(summary.tasksFired).toBe(0);
    expect(mockTaskCreate).not.toHaveBeenCalled();
  });

  it('returns empty summary when no active rules', async () => {
    mockRuleFindMany.mockResolvedValue([]);

    const summary = await evaluateTimeBasedRules();

    expect(summary.rulesEvaluated).toBe(0);
    expect(summary.accordsChecked).toBe(0);
    expect(summary.tasksFired).toBe(0);
    expect(summary.errors).toHaveLength(0);
  });

  it('skips already-fired rules via idempotency check', async () => {
    const timeRule = {
      ...mockRule,
      id: 'rule-time-1',
      trigger_type: 'time_based',
      time_threshold_hours: 24,
      trigger_status: 'meeting',
    };
    mockRuleFindMany.mockResolvedValue([timeRule]);

    const accordInStatus = {
      ...mockAccord,
      entered_current_status_at: new Date(Date.now() - 72 * 60 * 60 * 1000),
    };
    mockAccordFindMany.mockResolvedValue([accordInStatus]);
    mockLogFindUnique.mockResolvedValue({ id: 'existing-log' });

    const summary = await evaluateTimeBasedRules();

    expect(summary.tasksFired).toBe(0);
    expect(mockTaskCreate).not.toHaveBeenCalled();
  });
});

describe('resolveAssignee (tested via fireStatusChangeRules)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTaskCreate.mockResolvedValue({ id: 'task-new' });
    mockLogCreate.mockResolvedValue({});
    mockLogFindUnique.mockResolvedValue(null);
  });

  it('accord_owner returns owner_id', async () => {
    const ownerRule = { ...mockRule, assignee_rule: 'accord_owner' };
    mockRuleFindMany.mockResolvedValue([ownerRule]);
    mockAccordFindUniqueOrThrow.mockResolvedValue(mockAccord);

    await fireStatusChangeRules('accord-1', 'meeting' as any);

    expect(mockTaskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          assignee_id: 'user-owner',
        }),
      })
    );
  });

  it('meeting_attendees returns attendee ids (creates tasks for each)', async () => {
    const attendeeRule = { ...mockRule, assignee_rule: 'meeting_attendees' };
    mockRuleFindMany.mockResolvedValue([attendeeRule]);
    mockAccordFindUniqueOrThrow.mockResolvedValue(mockAccord);

    const results = await fireStatusChangeRules('accord-1', 'meeting' as any);

    expect(results[0].taskIds).toHaveLength(2);
    expect(mockTaskCreate).toHaveBeenCalledTimes(2);

    const firstCallAssignee = (mockTaskCreate.mock.calls[0][0] as any).data.assignee_id;
    const secondCallAssignee = (mockTaskCreate.mock.calls[1][0] as any).data.assignee_id;
    expect([firstCallAssignee, secondCallAssignee]).toEqual(['user-attendee-1', 'user-attendee-2']);
  });

  it('meeting_attendees falls back to owner when no attendees', async () => {
    const attendeeRule = { ...mockRule, assignee_rule: 'meeting_attendees' };
    mockRuleFindMany.mockResolvedValue([attendeeRule]);
    mockAccordFindUniqueOrThrow.mockResolvedValue({
      ...mockAccord,
      meeting_accords: [],
    });

    await fireStatusChangeRules('accord-1', 'meeting' as any);

    expect(mockTaskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          assignee_id: 'user-owner',
        }),
      })
    );
  });

  it('specific_user returns rule assignee_user_id', async () => {
    const specificUserRule = {
      ...mockRule,
      assignee_rule: 'specific_user',
      assignee_user_id: 'user-specific',
      assignee_user: { id: 'user-specific', name: 'Specific User' },
    };
    mockRuleFindMany.mockResolvedValue([specificUserRule]);
    mockAccordFindUniqueOrThrow.mockResolvedValue(mockAccord);

    await fireStatusChangeRules('accord-1', 'meeting' as any);

    expect(mockTaskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          assignee_id: 'user-specific',
        }),
      })
    );
  });
});
