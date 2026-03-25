import type { ApiEndpoint } from './index';

export const wareEndpoints: ApiEndpoint[] = [
  {
    path: '/api/wares',
    group: 'wares',
    methods: [
      {
        method: 'GET',
        summary: 'List wares with pagination, search, and filters.',
        auth: 'required',
        queryParams: [
          { name: 'search', type: 'string', required: false, description: 'Search by name or description' },
          { name: 'type', type: 'string', required: false, description: 'Filter: commission, charter' },
          { name: 'is_active', type: 'boolean', required: false, description: 'Filter by active status' },
          { name: 'page', type: 'number', required: false, description: 'Page number (default 1)' },
          { name: 'limit', type: 'number', required: false, description: 'Items per page (default 50)' },
        ],
        responseExample: {
          wares: [{
            id: 'uuid',
            name: 'string',
            type: 'commission|charter',
            description: 'string|null',
            is_active: 'boolean',
            created_at: 'ISO-8601',
            updated_at: 'ISO-8601',
          }],
          pagination: { page: 'number', limit: 'number', total: 'number', totalPages: 'number' },
        },
      },
      {
        method: 'POST',
        summary: 'Create a new ware.',
        auth: 'required',
        roles: ['pm', 'admin'],
        bodySchema: [
          { name: 'name', type: 'string', required: true, description: 'Ware name' },
          { name: 'type', type: 'string', required: true, description: 'commission or charter' },
          { name: 'description', type: 'string', required: false, description: 'Ware description' },
          { name: 'is_active', type: 'boolean', required: false, description: 'Active status (default true)' },
        ],
        responseExample: {
          id: 'uuid',
          name: 'string',
          type: 'string',
          is_active: 'boolean',
          created_at: 'ISO-8601',
        },
      },
    ],
  },
  {
    path: '/api/wares/:id',
    group: 'wares',
    methods: [
      {
        method: 'GET',
        summary: 'Get ware details.',
        auth: 'required',
        responseExample: {
          id: 'uuid',
          name: 'string',
          type: 'commission|charter',
          description: 'string|null',
          is_active: 'boolean',
          is_deleted: 'boolean',
          created_at: 'ISO-8601',
          updated_at: 'ISO-8601',
        },
      },
      {
        method: 'PATCH',
        summary: 'Update a ware.',
        auth: 'required',
        roles: ['pm', 'admin'],
        bodySchema: [
          { name: 'name', type: 'string', required: false, description: 'Ware name' },
          { name: 'type', type: 'string', required: false, description: 'commission or charter' },
          { name: 'description', type: 'string', required: false, description: 'Ware description' },
          { name: 'is_active', type: 'boolean', required: false, description: 'Active status' },
        ],
        responseExample: {
          id: 'uuid',
          name: 'string',
          type: 'string',
          updated_at: 'ISO-8601',
        },
      },
      {
        method: 'DELETE',
        summary: 'Soft delete a ware.',
        auth: 'required',
        roles: ['admin'],
        responseExample: { success: true },
      },
    ],
  },
];
