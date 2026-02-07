import type { ApiEndpoint } from './index';

export const miscEndpoints: ApiEndpoint[] = [
  {
    path: '/api/comments/:id',
    group: 'misc',
    methods: [
      {
        method: 'GET',
        summary: 'Get a single comment.',
        auth: 'required',
        responseExample: {
          id: 'uuid',
          content: 'string',
          task_id: 'uuid',
          user_id: 'uuid',
          user: { id: 'uuid', name: 'string', avatar_url: 'string|null' },
          created_at: 'ISO-8601',
          updated_at: 'ISO-8601',
        },
      },
      {
        method: 'PATCH',
        summary: 'Update a comment.',
        auth: 'required',
        responseExample: { id: 'uuid', content: 'string', updated_at: 'ISO-8601' },
      },
      {
        method: 'DELETE',
        summary: 'Soft delete a comment.',
        auth: 'required',
        responseExample: { success: true },
      },
    ],
  },
  {
    path: '/api/resource-links/:id',
    group: 'misc',
    methods: [
      {
        method: 'GET',
        summary: 'Get a resource link.',
        auth: 'required',
        responseExample: { id: 'uuid', title: 'string', url: 'string', type: 'string|null', project_id: 'uuid' },
      },
      {
        method: 'PATCH',
        summary: 'Update a resource link.',
        auth: 'required',
        responseExample: { id: 'uuid', title: 'string', url: 'string', updated_at: 'ISO-8601' },
      },
      {
        method: 'DELETE',
        summary: 'Delete a resource link.',
        auth: 'required',
        responseExample: { success: true },
      },
    ],
  },
  {
    path: '/api/activities',
    group: 'misc',
    methods: [
      {
        method: 'GET',
        summary: 'List activity log entries.',
        auth: 'required',
        queryParams: [
          { name: 'entity_type', type: 'string', required: false, description: 'Filter by entity type' },
          { name: 'entity_id', type: 'uuid', required: false, description: 'Filter by entity ID' },
          { name: 'user_id', type: 'uuid', required: false, description: 'Filter by user' },
        ],
        responseExample: {
          activities: [{
            id: 'uuid',
            action: 'string',
            entity_type: 'string',
            entity_id: 'uuid',
            entity_title: 'string',
            user_id: 'uuid',
            user: { id: 'uuid', name: 'string' },
            metadata: 'object|null',
            created_at: 'ISO-8601',
          }],
        },
      },
    ],
  },
  {
    path: '/api/search',
    group: 'misc',
    methods: [
      {
        method: 'GET',
        summary: 'Global search across clients, sites, projects, tasks, SOPs, domains, and tools.',
        auth: 'required',
        queryParams: [
          { name: 'q', type: 'string', required: true, description: 'Search query' },
          { name: 'type', type: 'string', required: false, description: 'Limit to specific entity type' },
        ],
        responseExample: {
          results: [{
            type: 'client|site|project|task|sop|domain|tool',
            id: 'uuid',
            title: 'string',
            subtitle: 'string|null',
            url: 'string',
          }],
        },
      },
    ],
  },
  {
    path: '/api/uploads',
    group: 'misc',
    methods: [
      {
        method: 'POST',
        summary: 'Upload a file (avatar, attachment). Accepts multipart/form-data.',
        auth: 'required',
        responseExample: { url: 'string', filename: 'string' },
        responseNotes: 'Send file as multipart/form-data with field name "file". Returns the public URL of the uploaded file.',
      },
    ],
  },
  {
    path: '/api/bug-report',
    group: 'misc',
    methods: [
      {
        method: 'POST',
        summary: 'Submit a bug report (creates task and/or sends email).',
        auth: 'required',
        responseExample: { success: true, task_id: 'uuid|null' },
        responseNotes: 'Creates a task in the configured bug report project if settings are configured. May also send an email notification.',
      },
    ],
  },
  {
    path: '/api/settings/bug-report',
    group: 'misc',
    methods: [
      {
        method: 'POST',
        summary: 'Configure bug report settings (project, phase, notify user).',
        auth: 'required',
        roles: ['admin'],
        responseExample: { success: true },
      },
    ],
  },
  {
    path: '/api/webhooks/slack/events',
    group: 'misc',
    methods: [
      {
        method: 'POST',
        summary: 'Handle incoming Slack webhook events (thread replies sync).',
        auth: 'none',
        responseNotes: 'Slack sends a verification challenge on first setup. Subsequent events are thread reply syncs to task comments.',
      },
    ],
  },
  {
    path: '/api/cron/retainer-alerts',
    group: 'misc',
    methods: [
      {
        method: 'POST',
        summary: 'Check retainer usage and send alerts for clients approaching limits.',
        auth: 'cron',
        responseExample: { success: true, alerts_sent: 'number' },
      },
    ],
  },
  {
    path: '/api/cron/maintenance',
    group: 'misc',
    methods: [
      {
        method: 'POST',
        summary: 'Generate maintenance tasks for the current period.',
        auth: 'cron',
        responseExample: { success: true, tasks_created: 'number' },
      },
    ],
  },
  {
    path: '/api/cron/task-due-soon',
    group: 'misc',
    methods: [
      {
        method: 'POST',
        summary: 'Notify assignees about tasks due within 24 hours.',
        auth: 'cron',
        responseExample: { success: true, notifications_sent: 'number' },
      },
    ],
  },
  {
    path: '/api/cron/email-digest',
    group: 'misc',
    methods: [
      {
        method: 'POST',
        summary: 'Process and send email digest notifications.',
        auth: 'cron',
        responseExample: { success: true, digests_sent: 'number' },
      },
    ],
  },
  {
    path: '/api/cron/slack-batches',
    group: 'misc',
    methods: [
      {
        method: 'POST',
        summary: 'Process and send batched Slack notifications.',
        auth: 'cron',
        responseExample: { success: true, batches_sent: 'number' },
      },
    ],
  },
  {
    path: '/api/docs',
    group: 'misc',
    methods: [
      {
        method: 'GET',
        summary: 'Get API documentation. Returns endpoint summary by default, or full detail for a specific group.',
        auth: 'required',
        queryParams: [
          { name: 'group', type: 'string', required: false, description: 'Domain group to get full detail for (e.g., tasks, projects, clients). Omit for summary of all endpoints.' },
        ],
        responseNotes: 'Without group param: returns summary (paths, methods, summaries, available groups — no response shapes or param details). With group param: returns full detail for that domain including responseExample, queryParams, bodySchema.',
      },
    ],
  },
];
