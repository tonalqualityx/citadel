import type { ApiEndpoint } from './index';

export const msaEndpoints: ApiEndpoint[] = [
  {
    path: '/api/msa',
    group: 'msa',
    methods: [
      {
        method: 'GET',
        summary: 'List all MSA versions.',
        auth: 'required',
        roles: ['pm', 'admin'],
        responseExample: {
          msa_versions: [{
            id: 'uuid',
            version: 'string',
            content: 'string',
            effective_date: 'ISO-8601',
            is_current: 'boolean',
            change_summary: 'string|null',
            signatures_count: 'number',
            created_at: 'ISO-8601',
          }],
          total: 'number',
        },
      },
      {
        method: 'POST',
        summary: 'Create a new MSA version. Admin only.',
        auth: 'required',
        roles: ['admin'],
        bodySchema: [
          { name: 'version', type: 'string', required: true, description: 'Version label (e.g., "1.0", "2024-Q1")' },
          { name: 'content', type: 'string', required: true, description: 'MSA content (rich text)' },
          { name: 'effective_date', type: 'ISO-8601', required: true, description: 'Date MSA becomes effective' },
          { name: 'is_current', type: 'boolean', required: false, description: 'Set as current active version (default false)' },
          { name: 'change_summary', type: 'string', required: false, description: 'Summary of changes from previous version' },
        ],
        responseExample: {
          id: 'uuid',
          version: 'string',
          is_current: 'boolean',
          created_at: 'ISO-8601',
        },
      },
    ],
  },
  {
    path: '/api/msa/:id',
    group: 'msa',
    methods: [
      {
        method: 'GET',
        summary: 'Get MSA version details.',
        auth: 'required',
        roles: ['pm', 'admin'],
        responseExample: {
          id: 'uuid',
          version: 'string',
          content: 'string',
          effective_date: 'ISO-8601',
          is_current: 'boolean',
          change_summary: 'string|null',
          signatures_count: 'number',
          created_at: 'ISO-8601',
        },
      },
      {
        method: 'PATCH',
        summary: 'Update an MSA version. Admin only.',
        auth: 'required',
        roles: ['admin'],
        bodySchema: [
          { name: 'version', type: 'string', required: false, description: 'Version label' },
          { name: 'content', type: 'string', required: false, description: 'MSA content' },
          { name: 'effective_date', type: 'ISO-8601', required: false, description: 'Effective date' },
          { name: 'is_current', type: 'boolean', required: false, description: 'Set as current active version' },
          { name: 'change_summary', type: 'string', required: false, description: 'Change summary' },
        ],
        responseExample: {
          id: 'uuid',
          version: 'string',
          is_current: 'boolean',
          updated_at: 'ISO-8601',
        },
      },
      {
        method: 'DELETE',
        summary: 'Delete an MSA version. Admin only. Blocked if signatures or contracts exist.',
        auth: 'required',
        roles: ['admin'],
        responseExample: { message: 'MSA version deleted' },
      },
    ],
  },
  {
    path: '/api/msa/current',
    group: 'msa',
    methods: [
      {
        method: 'GET',
        summary: 'Get the current active MSA version.',
        auth: 'required',
        roles: ['pm', 'admin'],
        responseExample: {
          id: 'uuid',
          version: 'string',
          content: 'string',
          effective_date: 'ISO-8601',
          is_current: true,
          created_at: 'ISO-8601',
        },
      },
    ],
  },
  {
    path: '/api/clients/:id/msa-status',
    group: 'msa',
    methods: [
      {
        method: 'GET',
        summary: 'Check if a client has signed the current MSA version.',
        auth: 'required',
        roles: ['pm', 'admin'],
        responseExample: {
          has_current_msa: 'boolean',
          signed_current: 'boolean',
          current_msa_version: 'string|null',
          signature: 'object|null',
        },
      },
    ],
  },
];
