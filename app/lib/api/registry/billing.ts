import type { ApiEndpoint } from './index';

export const billingEndpoints: ApiEndpoint[] = [
  {
    path: '/api/billing/unbilled',
    group: 'billing',
    methods: [
      {
        method: 'GET',
        summary: 'Get all unbilled tasks and milestones grouped by client.',
        auth: 'required',
        roles: ['pm', 'admin'],
        responseExample: {
          clients: [{
            id: 'uuid',
            name: 'string',
            tasks: [{
              id: 'uuid',
              title: 'string',
              billing_amount: 'number|null',
              billing_target: 'number|null',
              time_spent_minutes: 'number',
              project: { id: 'uuid', name: 'string' },
            }],
            milestones: [{
              id: 'uuid',
              name: 'string',
              billing_amount: 'number|null',
              billing_status: 'string',
              project: { id: 'uuid', name: 'string' },
            }],
            total_amount: 'number',
          }],
        },
      },
    ],
  },
  {
    path: '/api/billing/batch-invoice',
    group: 'billing',
    methods: [
      {
        method: 'POST',
        summary: 'Mark multiple tasks and milestones as invoiced.',
        auth: 'required',
        roles: ['pm', 'admin'],
        responseExample: { success: true, tasks_invoiced: 'number', milestones_invoiced: 'number' },
      },
    ],
  },
  {
    path: '/api/reports/retainers',
    group: 'billing',
    methods: [
      {
        method: 'GET',
        summary: 'Get retainer usage report across all retainer clients.',
        auth: 'required',
        roles: ['pm', 'admin'],
        responseExample: {
          clients: [{
            id: 'uuid',
            name: 'string',
            retainer_hours: 'number',
            hours_used: 'number',
            hours_remaining: 'number',
            usage_percent: 'number',
          }],
        },
      },
    ],
  },
  {
    path: '/api/reports/retainers/:clientId',
    group: 'billing',
    methods: [
      {
        method: 'GET',
        summary: 'Get retainer report for a specific client.',
        auth: 'required',
        responseExample: {
          client: { id: 'uuid', name: 'string', retainer_hours: 'number' },
          hours_used: 'number',
          hours_remaining: 'number',
          usage_percent: 'number',
          entries: [{ id: 'uuid', duration: 'number', task: { id: 'uuid', title: 'string' }, user: { id: 'uuid', name: 'string' } }],
        },
      },
    ],
  },
  {
    path: '/api/reports/time',
    group: 'billing',
    methods: [
      {
        method: 'GET',
        summary: 'Get time tracking report with filters.',
        auth: 'required',
        queryParams: [
          { name: 'start_date', type: 'ISO-8601', required: false, description: 'From date' },
          { name: 'end_date', type: 'ISO-8601', required: false, description: 'To date' },
          { name: 'user_id', type: 'uuid', required: false, description: 'Filter by user' },
          { name: 'client_id', type: 'uuid', required: false, description: 'Filter by client' },
          { name: 'project_id', type: 'uuid', required: false, description: 'Filter by project' },
        ],
        responseExample: {
          total_minutes: 'number',
          total_billable_minutes: 'number',
          entries: [{
            id: 'uuid',
            duration: 'number',
            user: { id: 'uuid', name: 'string' },
            task: { id: 'uuid', title: 'string' },
            project: { id: 'uuid', name: 'string' },
            client: { id: 'uuid', name: 'string' },
            is_billable: 'boolean',
            started_at: 'ISO-8601',
          }],
        },
      },
    ],
  },
  {
    path: '/api/reports/utilization',
    group: 'billing',
    methods: [
      {
        method: 'GET',
        summary: 'Get team utilization report.',
        auth: 'required',
        roles: ['pm', 'admin'],
        responseExample: {
          users: [{
            id: 'uuid',
            name: 'string',
            total_minutes: 'number',
            billable_minutes: 'number',
            utilization_percent: 'number',
          }],
          period: { start: 'ISO-8601', end: 'ISO-8601' },
        },
      },
    ],
  },
];
