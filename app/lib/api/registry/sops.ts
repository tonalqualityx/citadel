import type { ApiEndpoint } from './index';

export const sopEndpoints: ApiEndpoint[] = [
  {
    path: '/api/sops',
    group: 'sops',
    methods: [
      {
        method: 'GET',
        summary: 'List SOPs with pagination and filters.',
        auth: 'required',
        queryParams: [
          { name: 'search', type: 'string', required: false, description: 'Search by title' },
          { name: 'function_id', type: 'uuid', required: false, description: 'Filter by function' },
          { name: 'is_active', type: 'boolean', required: false, description: 'Filter by active status' },
          { name: 'page', type: 'number', required: false, description: 'Page number' },
          { name: 'limit', type: 'number', required: false, description: 'Items per page' },
        ],
        responseExample: {
          sops: [{
            id: 'uuid',
            title: 'string',
            description: 'string|null',
            function_id: 'uuid|null',
            function: { id: 'uuid', name: 'string' },
            estimated_minutes: 'number|null',
            is_active: 'boolean',
            created_at: 'ISO-8601',
            updated_at: 'ISO-8601',
          }],
          pagination: { page: 'number', limit: 'number', total: 'number', totalPages: 'number' },
        },
        responseNotes: 'List response does not include content field. Use GET /api/sops/:id for full content.',
      },
      {
        method: 'POST',
        summary: 'Create a new SOP.',
        auth: 'required',
        roles: ['pm', 'admin'],
        responseExample: { id: 'uuid', title: 'string', created_at: 'ISO-8601' },
      },
    ],
  },
  {
    path: '/api/sops/:id',
    group: 'sops',
    methods: [
      {
        method: 'GET',
        summary: 'Get SOP details with content and requirements.',
        auth: 'required',
        responseExample: {
          id: 'uuid',
          title: 'string',
          description: 'string|null',
          content: 'object|null',
          function_id: 'uuid|null',
          function: { id: 'uuid', name: 'string' },
          estimated_minutes: 'number|null',
          requirements: 'string|null',
          is_active: 'boolean',
          is_deleted: 'boolean',
          created_at: 'ISO-8601',
          updated_at: 'ISO-8601',
        },
        responseNotes: 'content is stored as JSON (rich text editor format).',
      },
      {
        method: 'PATCH',
        summary: 'Update an SOP.',
        auth: 'required',
        roles: ['pm', 'admin'],
        responseExample: { id: 'uuid', title: 'string', updated_at: 'ISO-8601' },
      },
      {
        method: 'DELETE',
        summary: 'Soft delete an SOP.',
        auth: 'required',
        roles: ['pm', 'admin'],
        responseExample: { success: true },
      },
    ],
  },
  {
    path: '/api/sops/bulk',
    group: 'sops',
    methods: [
      {
        method: 'PATCH',
        summary: 'Bulk update SOPs.',
        auth: 'required',
        roles: ['pm', 'admin'],
        responseExample: { success: true, count: 'number' },
      },
      {
        method: 'DELETE',
        summary: 'Bulk soft delete SOPs.',
        auth: 'required',
        roles: ['pm', 'admin'],
        responseExample: { success: true, count: 'number' },
      },
    ],
  },
  {
    path: '/api/recipes',
    group: 'sops',
    methods: [
      {
        method: 'GET',
        summary: 'List recipe templates.',
        auth: 'required',
        responseExample: {
          recipes: [{
            id: 'uuid',
            name: 'string',
            description: 'string|null',
            phases_count: 'number',
            tasks_count: 'number',
            created_at: 'ISO-8601',
          }],
        },
      },
      {
        method: 'POST',
        summary: 'Create a recipe template.',
        auth: 'required',
        roles: ['pm', 'admin'],
        responseExample: { id: 'uuid', name: 'string', created_at: 'ISO-8601' },
      },
    ],
  },
  {
    path: '/api/recipes/:id',
    group: 'sops',
    methods: [
      {
        method: 'GET',
        summary: 'Get recipe with phases and tasks.',
        auth: 'required',
        responseExample: {
          id: 'uuid',
          name: 'string',
          description: 'string|null',
          phases: [{
            id: 'uuid',
            name: 'string',
            sort_order: 'number',
            tasks: [{ id: 'uuid', title: 'string', energy_estimate: 'number|null', mystery_factor: 'string' }],
          }],
          created_at: 'ISO-8601',
          updated_at: 'ISO-8601',
        },
      },
      {
        method: 'PATCH',
        summary: 'Update a recipe.',
        auth: 'required',
        roles: ['pm', 'admin'],
        responseExample: { id: 'uuid', name: 'string', updated_at: 'ISO-8601' },
      },
      {
        method: 'DELETE',
        summary: 'Delete a recipe.',
        auth: 'required',
        roles: ['pm', 'admin'],
        responseExample: { success: true },
      },
    ],
  },
  {
    path: '/api/recipes/:id/phases',
    group: 'sops',
    methods: [
      {
        method: 'GET',
        summary: 'List recipe phases.',
        auth: 'required',
        responseExample: {
          phases: [{ id: 'uuid', name: 'string', sort_order: 'number' }],
        },
      },
      {
        method: 'POST',
        summary: 'Create a recipe phase.',
        auth: 'required',
        roles: ['pm', 'admin'],
        responseExample: { id: 'uuid', name: 'string', sort_order: 'number' },
      },
    ],
  },
  {
    path: '/api/recipes/:id/phases/:phaseId/tasks',
    group: 'sops',
    methods: [
      {
        method: 'GET',
        summary: 'List tasks in a recipe phase.',
        auth: 'required',
        responseExample: {
          tasks: [{ id: 'uuid', title: 'string', energy_estimate: 'number|null', mystery_factor: 'string', sort_order: 'number' }],
        },
      },
      {
        method: 'POST',
        summary: 'Add a task to a recipe phase.',
        auth: 'required',
        roles: ['pm', 'admin'],
        responseExample: { id: 'uuid', title: 'string', sort_order: 'number' },
      },
    ],
  },
];
