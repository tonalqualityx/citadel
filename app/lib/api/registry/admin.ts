import type { ApiEndpoint } from './index';

export const adminEndpoints: ApiEndpoint[] = [
  {
    path: '/api/admin/integrations',
    group: 'admin',
    methods: [
      {
        method: 'GET',
        summary: 'List configured integrations with masked API keys.',
        auth: 'required',
        roles: ['admin'],
        responseExample: {
          integrations: [{
            provider: 'string',
            is_configured: 'boolean',
            config: { api_key: '****masked****' },
          }],
        },
      },
    ],
  },
  {
    path: '/api/admin/integrations/:provider',
    group: 'admin',
    methods: [
      {
        method: 'GET',
        summary: 'Get integration configuration for a provider.',
        auth: 'required',
        roles: ['admin'],
        responseExample: {
          provider: 'string',
          is_configured: 'boolean',
          config: 'object',
        },
      },
      {
        method: 'PATCH',
        summary: 'Update integration configuration.',
        auth: 'required',
        roles: ['admin'],
        responseExample: { success: true },
      },
    ],
  },
  {
    path: '/api/admin/integrations/sendgrid/test',
    group: 'admin',
    methods: [
      {
        method: 'POST',
        summary: 'Test SendGrid email integration.',
        auth: 'required',
        roles: ['admin'],
        responseExample: { success: true, message: 'string' },
      },
    ],
  },
  {
    path: '/api/admin/integrations/slack/test',
    group: 'admin',
    methods: [
      {
        method: 'POST',
        summary: 'Test Slack bot integration.',
        auth: 'required',
        roles: ['admin'],
        responseExample: { success: true, message: 'string' },
      },
    ],
  },
  {
    path: '/api/admin/slack/users',
    group: 'admin',
    methods: [
      {
        method: 'GET',
        summary: 'List Slack workspace users.',
        auth: 'required',
        roles: ['admin'],
        responseExample: {
          users: [{ id: 'string', name: 'string', real_name: 'string', email: 'string|null' }],
        },
      },
    ],
  },
  {
    path: '/api/admin/slack/mappings',
    group: 'admin',
    methods: [
      {
        method: 'GET',
        summary: 'List Citadel-to-Slack user mappings.',
        auth: 'required',
        roles: ['admin'],
        responseExample: {
          mappings: [{ user_id: 'uuid', user_name: 'string', slack_user_id: 'string', slack_name: 'string' }],
        },
      },
      {
        method: 'POST',
        summary: 'Create or auto-match Slack user mappings.',
        auth: 'required',
        roles: ['admin'],
        responseExample: { success: true, matched: 'number' },
      },
    ],
  },
  {
    path: '/api/admin/slack/mappings/:userId',
    group: 'admin',
    methods: [
      {
        method: 'GET',
        summary: 'Get Slack mapping for a user.',
        auth: 'required',
        roles: ['admin'],
        responseExample: { user_id: 'uuid', slack_user_id: 'string', slack_name: 'string' },
      },
      {
        method: 'PATCH',
        summary: 'Update Slack mapping.',
        auth: 'required',
        roles: ['admin'],
        responseExample: { success: true },
      },
      {
        method: 'DELETE',
        summary: 'Remove Slack mapping.',
        auth: 'required',
        roles: ['admin'],
        responseExample: { success: true },
      },
    ],
  },
  {
    path: '/api/admin/users/:id/notification-preferences',
    group: 'admin',
    methods: [
      {
        method: 'GET',
        summary: 'Get user notification preferences (admin view).',
        auth: 'required',
        roles: ['admin'],
        responseExample: {
          preferences: [{ event_type: 'string', in_app: 'boolean', email: 'boolean', slack: 'boolean' }],
        },
      },
      {
        method: 'PATCH',
        summary: 'Set user notification preferences with admin override.',
        auth: 'required',
        roles: ['admin'],
        responseExample: { success: true },
      },
    ],
  },
  {
    path: '/api/admin/database/tables',
    group: 'admin',
    methods: [
      {
        method: 'GET',
        summary: 'List available table groups for database export/import.',
        auth: 'required',
        roles: ['admin'],
        responseExample: {
          groups: [{ name: 'string', tables: ['string'], row_counts: { table_name: 'number' } }],
        },
      },
    ],
  },
  {
    path: '/api/admin/database/export',
    group: 'admin',
    methods: [
      {
        method: 'POST',
        summary: 'Export database tables as SQL file.',
        auth: 'required',
        roles: ['admin'],
        responseNotes: 'Returns SQL file as application/sql content type, not JSON.',
      },
    ],
  },
  {
    path: '/api/admin/database/import',
    group: 'admin',
    methods: [
      {
        method: 'POST',
        summary: 'Import SQL database dump file.',
        auth: 'required',
        roles: ['admin'],
        responseExample: { success: true, tables_imported: 'number' },
      },
    ],
  },
  {
    path: '/api/admin/maintenance/generate',
    group: 'admin',
    methods: [
      {
        method: 'POST',
        summary: 'Manually trigger maintenance task generation.',
        auth: 'required',
        roles: ['admin'],
        responseExample: { success: true, tasks_created: 'number' },
      },
    ],
  },
];
