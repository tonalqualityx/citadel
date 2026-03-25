import type { ApiEndpoint } from './index';

export const charterEndpoints: ApiEndpoint[] = [
  {
    path: '/api/charters',
    group: 'charter',
    methods: [
      {
        method: 'GET',
        summary: 'List charters with pagination, search, and filters.',
        auth: 'required',
        queryParams: [
          { name: 'search', type: 'string', required: false, description: 'Search by name' },
          { name: 'status', type: 'string', required: false, description: 'Filter: active, paused, cancelled' },
          { name: 'client_id', type: 'uuid', required: false, description: 'Filter by client' },
          { name: 'page', type: 'number', required: false, description: 'Page number (default 1)' },
          { name: 'limit', type: 'number', required: false, description: 'Items per page (default 20)' },
        ],
        responseExample: {
          charters: [{ id: 'uuid', name: 'string', status: 'active|paused|cancelled', billing_period: 'monthly|annually' }],
          pagination: { page: 'number', limit: 'number', total: 'number', totalPages: 'number' },
        },
      },
      {
        method: 'POST',
        summary: 'Create a new charter.',
        auth: 'required',
        roles: ['pm', 'admin'],
        bodySchema: [
          { name: 'name', type: 'string', required: true, description: 'Charter name' },
          { name: 'client_id', type: 'uuid', required: true, description: 'Client ID' },
          { name: 'billing_period', type: 'string', required: true, description: 'monthly or annually' },
          { name: 'start_date', type: 'string', required: true, description: 'Start date (ISO)' },
          { name: 'accord_id', type: 'uuid', required: false, description: 'Linked accord' },
          { name: 'budget_hours', type: 'number', required: false, description: 'Budget hours per period' },
          { name: 'hourly_rate', type: 'number', required: false, description: 'Hourly rate' },
          { name: 'budget_amount', type: 'number', required: false, description: 'Budget amount per period' },
          { name: 'end_date', type: 'string', required: false, description: 'End date (ISO)' },
        ],
        responseExample: { id: 'uuid', name: 'string', status: 'active', created_at: 'ISO-8601' },
      },
    ],
  },
  {
    path: '/api/charters/:id',
    group: 'charter',
    methods: [
      { method: 'GET', summary: 'Get charter details with all relations.', auth: 'required' },
      {
        method: 'PATCH',
        summary: 'Update a charter.',
        auth: 'required',
        roles: ['pm', 'admin'],
        bodySchema: [
          { name: 'name', type: 'string', required: false, description: 'Charter name' },
          { name: 'billing_period', type: 'string', required: false, description: 'monthly or annually' },
          { name: 'budget_hours', type: 'number', required: false, description: 'Budget hours' },
          { name: 'hourly_rate', type: 'number', required: false, description: 'Hourly rate' },
          { name: 'budget_amount', type: 'number', required: false, description: 'Budget amount' },
        ],
      },
      { method: 'DELETE', summary: 'Soft delete a charter.', auth: 'required', roles: ['admin'] },
    ],
  },
  {
    path: '/api/charters/:id/status',
    group: 'charter',
    methods: [
      {
        method: 'PATCH',
        summary: 'Update charter status (active, paused, cancelled).',
        auth: 'required',
        roles: ['pm', 'admin'],
        bodySchema: [
          { name: 'status', type: 'string', required: true, description: 'active, paused, or cancelled' },
          { name: 'cancellation_reason', type: 'string', required: false, description: 'Reason for cancellation' },
        ],
      },
    ],
  },
  {
    path: '/api/charters/:id/wares',
    group: 'charter',
    methods: [
      {
        method: 'POST',
        summary: 'Add a ware to a charter.',
        auth: 'required',
        roles: ['pm', 'admin'],
        bodySchema: [
          { name: 'ware_id', type: 'uuid', required: true, description: 'Ware ID' },
          { name: 'price', type: 'number', required: true, description: 'Price for this ware' },
        ],
      },
    ],
  },
  {
    path: '/api/charters/:id/wares/:wareId',
    group: 'charter',
    methods: [
      { method: 'PATCH', summary: 'Update a charter ware.', auth: 'required', roles: ['pm', 'admin'] },
      { method: 'DELETE', summary: 'Remove a ware from a charter.', auth: 'required', roles: ['pm', 'admin'] },
    ],
  },
  {
    path: '/api/charters/:id/scheduled-tasks',
    group: 'charter',
    methods: [
      {
        method: 'POST',
        summary: 'Add a scheduled task to a charter.',
        auth: 'required',
        roles: ['pm', 'admin'],
        bodySchema: [
          { name: 'sop_id', type: 'uuid', required: true, description: 'SOP to use as template' },
          { name: 'cadence', type: 'string', required: true, description: 'weekly, monthly, quarterly, semi_annually, annually' },
          { name: 'charter_ware_id', type: 'uuid', required: false, description: 'Linked charter ware' },
          { name: 'sort_order', type: 'number', required: false, description: 'Sort order' },
        ],
      },
    ],
  },
  {
    path: '/api/charters/:id/scheduled-tasks/:taskId',
    group: 'charter',
    methods: [
      { method: 'PATCH', summary: 'Update a scheduled task.', auth: 'required', roles: ['pm', 'admin'] },
      { method: 'DELETE', summary: 'Remove a scheduled task.', auth: 'required', roles: ['pm', 'admin'] },
    ],
  },
  {
    path: '/api/charters/:id/commissions',
    group: 'charter',
    methods: [
      {
        method: 'POST',
        summary: 'Link a commission (project) to a charter.',
        auth: 'required',
        roles: ['pm', 'admin'],
        bodySchema: [
          { name: 'commission_id', type: 'uuid', required: true, description: 'Project/commission ID' },
          { name: 'allocated_hours_per_period', type: 'number', required: false, description: 'Allocated hours per period' },
          { name: 'start_period', type: 'string', required: true, description: 'Start period (e.g., 2026-03)' },
          { name: 'end_period', type: 'string', required: false, description: 'End period' },
        ],
      },
    ],
  },
  {
    path: '/api/charters/:id/commissions/:linkId',
    group: 'charter',
    methods: [
      { method: 'PATCH', summary: 'Update commission allocation.', auth: 'required', roles: ['pm', 'admin'] },
      { method: 'DELETE', summary: 'Unlink a commission from a charter.', auth: 'required', roles: ['pm', 'admin'] },
    ],
  },
  {
    path: '/api/charters/:id/usage',
    group: 'charter',
    methods: [
      {
        method: 'GET',
        summary: 'Get period usage breakdown for a charter.',
        auth: 'required',
        queryParams: [
          { name: 'period', type: 'string', required: false, description: 'Period (e.g., 2026-03). Defaults to current month.' },
        ],
      },
    ],
  },
  {
    path: '/api/cron/charter-tasks',
    group: 'charter',
    methods: [
      {
        method: 'POST',
        summary: 'Generate scheduled charter tasks (cron).',
        auth: 'cron',
        responseNotes: 'Requires x-cron-secret header matching CRON_SECRET env var.',
      },
    ],
  },
];
