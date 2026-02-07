import type { ApiEndpoint } from './index';

export const referenceEndpoints: ApiEndpoint[] = [
  {
    path: '/api/functions',
    group: 'reference',
    methods: [
      {
        method: 'GET',
        summary: 'List functions/departments.',
        auth: 'required',
        responseExample: {
          functions: [{ id: 'uuid', name: 'string', description: 'string|null', created_at: 'ISO-8601' }],
        },
      },
      {
        method: 'POST',
        summary: 'Create a function.',
        auth: 'required',
        roles: ['admin'],
        responseExample: { id: 'uuid', name: 'string', created_at: 'ISO-8601' },
      },
    ],
  },
  {
    path: '/api/functions/:id',
    group: 'reference',
    methods: [
      {
        method: 'GET',
        summary: 'Get function details.',
        auth: 'required',
        responseExample: { id: 'uuid', name: 'string', description: 'string|null', created_at: 'ISO-8601' },
      },
      {
        method: 'PATCH',
        summary: 'Update a function.',
        auth: 'required',
        roles: ['admin'],
        responseExample: { id: 'uuid', name: 'string', updated_at: 'ISO-8601' },
      },
      {
        method: 'DELETE',
        summary: 'Delete a function.',
        auth: 'required',
        roles: ['admin'],
        responseExample: { success: true },
      },
    ],
  },
  {
    path: '/api/hosting-plans',
    group: 'reference',
    methods: [
      {
        method: 'GET',
        summary: 'List hosting plans.',
        auth: 'required',
        responseExample: {
          plans: [{ id: 'uuid', name: 'string', rate: 'number', description: 'string|null' }],
        },
      },
      {
        method: 'POST',
        summary: 'Create a hosting plan.',
        auth: 'required',
        roles: ['admin'],
        responseExample: { id: 'uuid', name: 'string', rate: 'number', created_at: 'ISO-8601' },
      },
    ],
  },
  {
    path: '/api/hosting-plans/:id',
    group: 'reference',
    methods: [
      {
        method: 'GET',
        summary: 'Get hosting plan details.',
        auth: 'required',
        responseExample: { id: 'uuid', name: 'string', rate: 'number', description: 'string|null' },
      },
      {
        method: 'PATCH',
        summary: 'Update a hosting plan.',
        auth: 'required',
        roles: ['admin'],
        responseExample: { id: 'uuid', name: 'string', rate: 'number', updated_at: 'ISO-8601' },
      },
      {
        method: 'DELETE',
        summary: 'Delete a hosting plan (fails if in use).',
        auth: 'required',
        roles: ['admin'],
        responseExample: { success: true },
      },
    ],
  },
  {
    path: '/api/maintenance-plans',
    group: 'reference',
    methods: [
      {
        method: 'GET',
        summary: 'List maintenance plans.',
        auth: 'required',
        responseExample: {
          plans: [{ id: 'uuid', name: 'string', rate: 'number', frequency: 'string' }],
        },
      },
      {
        method: 'POST',
        summary: 'Create a maintenance plan.',
        auth: 'required',
        roles: ['admin'],
        responseExample: { id: 'uuid', name: 'string', rate: 'number', created_at: 'ISO-8601' },
      },
    ],
  },
  {
    path: '/api/maintenance-plans/:id',
    group: 'reference',
    methods: [
      {
        method: 'GET',
        summary: 'Get maintenance plan with linked SOPs.',
        auth: 'required',
        responseExample: {
          id: 'uuid',
          name: 'string',
          rate: 'number',
          frequency: 'string',
          description: 'string|null',
          sops: [{ id: 'uuid', title: 'string' }],
        },
      },
      {
        method: 'PATCH',
        summary: 'Update a maintenance plan.',
        auth: 'required',
        roles: ['admin'],
        responseExample: { id: 'uuid', name: 'string', updated_at: 'ISO-8601' },
      },
      {
        method: 'DELETE',
        summary: 'Delete a maintenance plan.',
        auth: 'required',
        roles: ['admin'],
        responseExample: { success: true },
      },
    ],
  },
  {
    path: '/api/maintenance-plans/:id/sops',
    group: 'reference',
    methods: [
      {
        method: 'GET',
        summary: 'List SOPs linked to a maintenance plan.',
        auth: 'required',
        responseExample: {
          sops: [{ id: 'uuid', title: 'string', estimated_minutes: 'number|null' }],
        },
      },
      {
        method: 'POST',
        summary: 'Link/unlink SOPs to a maintenance plan.',
        auth: 'required',
        roles: ['admin'],
        responseExample: { success: true },
      },
    ],
  },
  {
    path: '/api/dns-providers',
    group: 'reference',
    methods: [
      {
        method: 'GET',
        summary: 'List DNS providers.',
        auth: 'required',
        responseExample: {
          providers: [{ id: 'uuid', name: 'string' }],
        },
      },
      {
        method: 'POST',
        summary: 'Create a DNS provider.',
        auth: 'required',
        roles: ['admin'],
        responseExample: { id: 'uuid', name: 'string', created_at: 'ISO-8601' },
      },
    ],
  },
  {
    path: '/api/tools',
    group: 'reference',
    methods: [
      {
        method: 'GET',
        summary: 'List tools.',
        auth: 'required',
        responseExample: {
          tools: [{ id: 'uuid', name: 'string', url: 'string|null', description: 'string|null' }],
        },
      },
      {
        method: 'POST',
        summary: 'Create a tool.',
        auth: 'required',
        roles: ['admin'],
        responseExample: { id: 'uuid', name: 'string', created_at: 'ISO-8601' },
      },
    ],
  },
  {
    path: '/api/tools/:id',
    group: 'reference',
    methods: [
      {
        method: 'GET',
        summary: 'Get tool details.',
        auth: 'required',
        responseExample: { id: 'uuid', name: 'string', url: 'string|null', description: 'string|null' },
      },
      {
        method: 'PATCH',
        summary: 'Update a tool.',
        auth: 'required',
        roles: ['admin'],
        responseExample: { id: 'uuid', name: 'string', updated_at: 'ISO-8601' },
      },
      {
        method: 'DELETE',
        summary: 'Delete a tool.',
        auth: 'required',
        roles: ['admin'],
        responseExample: { success: true },
      },
    ],
  },
];
