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
        queryParams: [
          { name: 'orderBy', type: 'string', required: false, description: 'Sort order for My Tasks: priority, due_date, or estimate' },
          { name: 'tz', type: 'string', required: false, description: 'IANA timezone name (e.g., America/New_York). Used to compute "today" boundaries. Defaults to server timezone if omitted.' },
          { name: 'limit_myTasks', type: 'number', required: false, description: 'Page size for the My Tasks list (default 10, max 200). Used by "load more".' },
          { name: 'limit_focusTasks', type: 'number', required: false, description: 'Page size for the Focus Tasks list (default 10, max 200). Used by "load more".' },
          { name: 'limit_awaitingReview', type: 'number', required: false, description: 'Page size for the Awaiting Review list (default 10, max 200). Used by "load more".' },
          { name: 'limit_unassignedTasks', type: 'number', required: false, description: 'Page size for the Unassigned Tasks list (default 10, max 200). Used by "load more".' },
        ],
        responseExample: {
          tasks: [{ id: 'uuid', title: 'string', status: 'string', priority: 'number', project: { id: 'uuid', name: 'string' }, time_logged_minutes: 'number' }],
          metrics: { tasks_due_today: 'number', tasks_in_progress: 'number', hours_this_week: 'number' },
        },
        responseNotes: 'Response shape varies by role. Tech users see their assigned tasks and focus items. PM/admin users see team overview, project health, and alerts. Paginated lists ({ items, total, hasMore }) grow via the limit_<list> query params, so "load more" survives refetches and mutations. tasks[].time_logged_minutes is pre-calculated at API level.',
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
];
