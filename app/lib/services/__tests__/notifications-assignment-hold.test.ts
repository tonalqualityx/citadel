/**
 * The assignment notice waits until the task is available (task 5ad27fc9). Mike, 2026-11-27: "I should only get the
 * notification when it's available to me. If it's blocked I should not see it until it's unblocked."
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockTaskFindUnique = vi.fn();
const mockTaskUpdate = vi.fn();
const mockTaskFindMany = vi.fn();
const mockTaskUpdateMany = vi.fn();
const mockNotifFind = vi.fn();
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: {
      findUnique: (...a: unknown[]) => mockTaskFindUnique(...a),
      update: (...a: unknown[]) => mockTaskUpdate(...a),
      findMany: (...a: unknown[]) => mockTaskFindMany(...a),
      updateMany: (...a: unknown[]) => mockTaskUpdateMany(...a),
    },
    notification: { findUnique: (...a: unknown[]) => mockNotifFind(...a) },
    userPreference: { findUnique: vi.fn() },
  },
}));

const mockDispatch = vi.fn();
vi.mock('../notification-dispatcher', () => ({
  dispatchNotification: (...a: unknown[]) => mockDispatch(...a),
}));
vi.mock('../notification-triage-guard', () => ({ suppressedForTriage: vi.fn().mockResolvedValue(false) }));

import { notifyTaskAssigned, notifyReleasedAssignees, markAssignmentNoticed } from '../notifications';

const TASK = '11111111-1111-4111-8111-111111111111';
const MIKE = '3ecfb7be-20bb-43cb-9b4d-31c44337dc81';
const SABEEN = 'b565b492-cdea-497b-a13d-85f003916bf9';

function head(status: string) {
  return { title: 'Send the draft', status, is_support: false, project_id: null, project: null };
}
function released(over: Record<string, unknown> = {}) {
  return { id: TASK, title: 'Send the draft', assignee_id: MIKE, assignment_noticed_user_id: null, is_support: false, project_id: null, project: null, ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDispatch.mockResolvedValue({ inApp: { notificationId: 'n1' } });
  mockNotifFind.mockResolvedValue({ id: 'n1' });
  mockTaskUpdate.mockResolvedValue({});
});

describe('notifyTaskAssigned: held while blocked', () => {
  it('a task assigned while blocked (by a task or a question) sends no notice in any channel and records nobody as told', async () => {
    mockTaskFindUnique.mockResolvedValue(head('blocked'));
    await notifyTaskAssigned(TASK, MIKE, 'Bast');
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(mockTaskUpdate).not.toHaveBeenCalled();
  });

  it('an unblocked task notifies at once, as before, and records the assignee as told', async () => {
    mockTaskFindUnique.mockResolvedValue(head('not_started'));
    await notifyTaskAssigned(TASK, MIKE, 'Bast');
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({
      userId: MIKE, type: 'task_assigned', title: 'New quest assigned: Send the draft', entityType: 'task', entityId: TASK,
      bundleKey: `task_assigned_${MIKE}`,
    }));
    expect(mockTaskUpdate).toHaveBeenCalledWith({ where: { id: TASK }, data: { assignment_noticed_user_id: MIKE } });
  });

  it('applies to every assignee, not only Mike', async () => {
    mockTaskFindUnique.mockResolvedValue(head('blocked'));
    await notifyTaskAssigned(TASK, SABEEN, 'Bast');
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('a missing task sends nothing', async () => {
    mockTaskFindUnique.mockResolvedValue(null);
    await notifyTaskAssigned(TASK, MIKE, 'Bast');
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});

describe('notifyReleasedAssignees: the held notice goes once, at release', () => {
  it('when the last blocker clears, the assignee gets the notice once', async () => {
    mockTaskFindMany.mockResolvedValue([released()]);
    mockTaskUpdateMany.mockResolvedValue({ count: 1 });
    const out = await notifyReleasedAssignees([TASK]);
    expect(out).toEqual([TASK]);
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({ userId: MIKE, type: 'task_assigned', entityId: TASK }));
    expect(mockTaskUpdateMany).toHaveBeenCalledWith({
      where: { id: TASK, assignee_id: MIKE, OR: [{ assignment_noticed_user_id: null }, { assignment_noticed_user_id: { not: MIKE } }] },
      data: { assignment_noticed_user_id: MIKE },
    });
  });

  it('only reads workable tasks: a release that lost a race to Triage or a close sends nothing', async () => {
    mockTaskFindMany.mockResolvedValue([]);
    await notifyReleasedAssignees([TASK]);
    expect(mockTaskFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: [TASK] }, is_deleted: false, assignee_id: { not: null }, status: { in: ['not_started', 'in_progress', 'review'] } },
    }));
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('no repeat: an assignee already told (notified at assignment, or by an earlier release) gets nothing', async () => {
    mockTaskFindMany.mockResolvedValue([released({ assignment_noticed_user_id: MIKE })]);
    const out = await notifyReleasedAssignees([TASK]);
    expect(out).toEqual([]);
    expect(mockTaskUpdateMany).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('no repeat under a race: a second release path that loses the claim sends nothing', async () => {
    mockTaskFindMany.mockResolvedValue([released()]);
    mockTaskUpdateMany.mockResolvedValue({ count: 0 });
    const out = await notifyReleasedAssignees([TASK]);
    expect(out).toEqual([]);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('a task reassigned while blocked notifies the new assignee, not the one told before', async () => {
    mockTaskFindMany.mockResolvedValue([released({ assignee_id: SABEEN, assignment_noticed_user_id: MIKE })]);
    mockTaskUpdateMany.mockResolvedValue({ count: 1 });
    await notifyReleasedAssignees([TASK]);
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({ userId: SABEEN }));
  });

  it('two releases in a row send one notice', async () => {
    mockTaskFindMany.mockResolvedValueOnce([released()]).mockResolvedValueOnce([released({ assignment_noticed_user_id: MIKE })]);
    mockTaskUpdateMany.mockResolvedValue({ count: 1 });
    await notifyReleasedAssignees([TASK]);
    await notifyReleasedAssignees([TASK]);
    expect(mockDispatch).toHaveBeenCalledTimes(1);
  });

  it('an empty list reads nothing', async () => {
    expect(await notifyReleasedAssignees([])).toEqual([]);
    expect(mockTaskFindMany).not.toHaveBeenCalled();
  });
});

describe('markAssignmentNoticed', () => {
  it('records a self-assigned person as told', async () => {
    await markAssignmentNoticed(TASK, MIKE);
    expect(mockTaskUpdate).toHaveBeenCalledWith({ where: { id: TASK }, data: { assignment_noticed_user_id: MIKE } });
  });
});
