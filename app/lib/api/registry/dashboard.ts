import type { ApiEndpoint } from './index';

export const dashboardEndpoints: ApiEndpoint[] = [
  {
    path: '/api/dashboard',
    group: 'dashboard',
    methods: [
      {
        method: 'GET',
        summary: 'Get role-specific dashboard data (tasks, metrics, alerts). Returns different data based on user role.',
        auth: 'required',
        responseExample: {
          tasks: [{ id: 'uuid', title: 'string', status: 'string', priority: 'number', project: { id: 'uuid', name: 'string' }, time_logged_minutes: 'number' }],
          metrics: { tasks_due_today: 'number', tasks_in_progress: 'number', hours_this_week: 'number' },
        },
        responseNotes: 'Response shape varies by role. Tech users see their assigned tasks and focus items. PM/admin users see team overview, project health, and alerts. tasks[].time_logged_minutes is pre-calculated at API level.',
      },
    ],
  },
  {
    path: '/api/dashboard/timeclock-issues',
    group: 'dashboard',
    methods: [
      {
        method: 'GET',
        summary: 'Get completed tasks missing time entries and currently running timers.',
        auth: 'required',
        responseExample: {
          tasks_missing_time: [{ id: 'uuid', title: 'string', status: 'string', completed_at: 'ISO-8601' }],
          running_timers: [{ id: 'uuid', task: { id: 'uuid', title: 'string' }, started_at: 'ISO-8601' }],
        },
      },
    ],
  },
  {
    path: '/api/dashboard/load-more',
    group: 'dashboard',
    methods: [
      {
        method: 'GET',
        summary: 'Load additional items for dashboard lists.',
        auth: 'required',
        queryParams: [
          { name: 'section', type: 'string', required: true, description: 'Dashboard section to load more from' },
          { name: 'page', type: 'number', required: false, description: 'Page number' },
        ],
        responseExample: {
          items: [{ id: 'uuid', title: 'string' }],
          hasMore: 'boolean',
        },
      },
    ],
  },
];
