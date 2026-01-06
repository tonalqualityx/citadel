import { describe, it, expect } from 'vitest';
import type {
  DashboardTask,
  DashboardProject,
  TechDashboardData,
  PmDashboardData,
  AdminDashboardData,
  PaginatedList,
} from '../use-dashboard';
import {
  isTechDashboard,
  isPmDashboard,
  isAdminDashboard,
} from '../use-dashboard';

describe('DashboardTask interface', () => {
  it('should accept task with project-based client/site', () => {
    const task: DashboardTask = {
      id: 'task-1',
      title: 'Test Task',
      status: 'todo',
      priority: 1,
      is_focus: false,
      due_date: null,
      energy_estimate: 3,
      mystery_factor: 'some',
      battery_impact: 'average_drain',
      estimated_minutes: 60,
      time_logged_minutes: 30,
      project: {
        id: 'proj-1',
        name: 'Website Project',
        client: { id: 'client-1', name: 'Acme Corp' },
        site: { id: 'site-1', name: 'acme.com' },
      },
    };

    expect(task.project?.client?.name).toBe('Acme Corp');
    expect(task.project?.site?.name).toBe('acme.com');
  });

  it('should accept ad-hoc task with direct client and site', () => {
    const task: DashboardTask = {
      id: 'task-2',
      title: 'Ad-hoc Task',
      status: 'in_progress',
      priority: 2,
      is_focus: true,
      due_date: '2025-01-15',
      energy_estimate: 2,
      mystery_factor: 'none',
      battery_impact: 'high_drain',
      estimated_minutes: 30,
      time_logged_minutes: 15,
      client: { id: 'client-2', name: 'Direct Client' },
      site: { id: 'site-2', name: 'direct-site.com' },
      project: null,
    };

    expect(task.client?.name).toBe('Direct Client');
    expect(task.site?.name).toBe('direct-site.com');
    expect(task.project).toBeNull();
  });

  it('should accept ad-hoc task with only client (no site)', () => {
    const task: DashboardTask = {
      id: 'task-3',
      title: 'Client Only Task',
      status: 'todo',
      priority: 1,
      is_focus: false,
      due_date: null,
      energy_estimate: 1,
      mystery_factor: 'none',
      battery_impact: 'energizing',
      estimated_minutes: 15,
      client: { id: 'client-3', name: 'Client Without Site' },
      project: null,
    };

    expect(task.client?.name).toBe('Client Without Site');
    expect(task.site).toBeUndefined();
  });

  it('should accept task without client, site, or project (true ad-hoc)', () => {
    const task: DashboardTask = {
      id: 'task-4',
      title: 'True Ad-hoc Task',
      status: 'todo',
      priority: 3,
      is_focus: false,
      due_date: null,
      energy_estimate: null,
      mystery_factor: 'none',
      battery_impact: 'average_drain',
      estimated_minutes: null,
      project: null,
    };

    expect(task.client).toBeUndefined();
    expect(task.site).toBeUndefined();
    expect(task.project).toBeNull();
  });

  it('should accept task with all optional fields', () => {
    const task: DashboardTask = {
      id: 'task-5',
      title: 'Full Task',
      status: 'done',
      priority: 1,
      is_focus: true,
      due_date: '2025-02-01',
      energy_estimate: 5,
      mystery_factor: 'lots',
      battery_impact: 'high_drain',
      estimated_minutes: 240,
      time_logged_minutes: 300,
      needs_review: true,
      approved: false,
      assignee: { id: 'user-1', name: 'John Doe' },
      client: { id: 'client-1', name: 'Test Client' },
      site: { id: 'site-1', name: 'test.com' },
      project: {
        id: 'proj-1',
        name: 'Test Project',
        status: 'in_progress',
        client: { id: 'client-1', name: 'Test Client' },
        site: { id: 'site-1', name: 'test.com' },
      },
      updated_at: '2025-01-05T12:00:00Z',
    };

    expect(task.needs_review).toBe(true);
    expect(task.approved).toBe(false);
    expect(task.assignee?.name).toBe('John Doe');
    expect(task.updated_at).toBe('2025-01-05T12:00:00Z');
  });
});

describe('Dashboard type guards', () => {
  const baseData = {
    activeTimer: null,
    recentTimeEntries: [],
  };

  const techData: TechDashboardData = {
    ...baseData,
    role: 'tech',
    myTasks: { items: [], total: 0, hasMore: false },
    upcomingTasks: [],
    blockedTasks: [],
    inProgressTasks: [],
    timeThisWeekMinutes: 0,
    timeTodayMinutes: 0,
  };

  const pmData: PmDashboardData = {
    ...baseData,
    role: 'pm',
    focusTasks: { items: [], total: 0, hasMore: false },
    awaitingReview: { items: [], total: 0, hasMore: false },
    unassignedTasks: { items: [], total: 0, hasMore: false },
    myTasks: { items: [], total: 0, hasMore: false },
    myProjects: [],
    retainerAlerts: [],
    recentCompletions: [],
  };

  const adminData: AdminDashboardData = {
    ...pmData,
    role: 'admin',
    allActiveProjects: [],
    teamUtilization: [],
    systemStats: {
      activeProjectCount: 0,
      openTaskCount: 0,
      activeUserCount: 0,
      totalTimeThisMonthMinutes: 0,
    },
  };

  describe('isTechDashboard', () => {
    it('should return true for tech dashboard', () => {
      expect(isTechDashboard(techData)).toBe(true);
    });

    it('should return false for PM dashboard', () => {
      expect(isTechDashboard(pmData)).toBe(false);
    });

    it('should return false for admin dashboard', () => {
      expect(isTechDashboard(adminData)).toBe(false);
    });
  });

  describe('isPmDashboard', () => {
    it('should return true for PM dashboard', () => {
      expect(isPmDashboard(pmData)).toBe(true);
    });

    it('should return false for tech dashboard', () => {
      expect(isPmDashboard(techData)).toBe(false);
    });

    it('should return false for admin dashboard', () => {
      expect(isPmDashboard(adminData)).toBe(false);
    });
  });

  describe('isAdminDashboard', () => {
    it('should return true for admin dashboard', () => {
      expect(isAdminDashboard(adminData)).toBe(true);
    });

    it('should return false for tech dashboard', () => {
      expect(isAdminDashboard(techData)).toBe(false);
    });

    it('should return false for PM dashboard', () => {
      expect(isAdminDashboard(pmData)).toBe(false);
    });
  });
});

describe('PaginatedList interface', () => {
  it('should accept valid paginated task list', () => {
    const list: PaginatedList<DashboardTask> = {
      items: [
        {
          id: 'task-1',
          title: 'Task 1',
          status: 'todo',
          priority: 1,
          is_focus: false,
          due_date: null,
          energy_estimate: 2,
          mystery_factor: 'none',
          battery_impact: 'average_drain',
          estimated_minutes: 30,
          project: null,
        },
      ],
      total: 10,
      hasMore: true,
    };

    expect(list.items).toHaveLength(1);
    expect(list.total).toBe(10);
    expect(list.hasMore).toBe(true);
  });

  it('should accept empty paginated list', () => {
    const list: PaginatedList<DashboardTask> = {
      items: [],
      total: 0,
      hasMore: false,
    };

    expect(list.items).toHaveLength(0);
    expect(list.total).toBe(0);
    expect(list.hasMore).toBe(false);
  });
});
