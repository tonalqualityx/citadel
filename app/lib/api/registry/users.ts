import type { ApiEndpoint } from './index';

export const userEndpoints: ApiEndpoint[] = [
  {
    path: '/api/users',
    group: 'users',
    methods: [
      {
        method: 'GET',
        summary: 'List users.',
        auth: 'required',
        queryParams: [
          { name: 'include_inactive', type: 'boolean', required: false, description: 'Include inactive users' },
        ],
        responseExample: {
          users: [{
            id: 'uuid',
            name: 'string',
            email: 'string',
            role: 'tech|pm|admin',
            avatar_url: 'string|null',
            is_active: 'boolean',
            created_at: 'ISO-8601',
          }],
        },
      },
      {
        method: 'POST',
        summary: 'Create a new user.',
        auth: 'required',
        roles: ['admin'],
        responseExample: { id: 'uuid', name: 'string', email: 'string', role: 'string', created_at: 'ISO-8601' },
      },
    ],
  },
  {
    path: '/api/users/:id',
    group: 'users',
    methods: [
      {
        method: 'GET',
        summary: 'Get user details.',
        auth: 'required',
        responseExample: {
          id: 'uuid',
          name: 'string',
          email: 'string',
          role: 'tech|pm|admin',
          avatar_url: 'string|null',
          is_active: 'boolean',
          functions: [{ id: 'uuid', function: { id: 'uuid', name: 'string' }, is_primary: 'boolean' }],
          created_at: 'ISO-8601',
          updated_at: 'ISO-8601',
        },
      },
      {
        method: 'PATCH',
        summary: 'Update user or reset password.',
        auth: 'required',
        roles: ['admin'],
        responseExample: { id: 'uuid', name: 'string', updated_at: 'ISO-8601' },
      },
      {
        method: 'DELETE',
        summary: 'Delete or deactivate a user.',
        auth: 'required',
        roles: ['admin'],
        responseExample: { success: true },
      },
    ],
  },
  {
    path: '/api/users/:id/functions',
    group: 'users',
    methods: [
      {
        method: 'GET',
        summary: 'Get user function specialties.',
        auth: 'required',
        responseExample: {
          functions: [{
            id: 'uuid',
            user_id: 'uuid',
            function_id: 'uuid',
            function: { id: 'uuid', name: 'string' },
            is_primary: 'boolean',
            created_at: 'ISO-8601',
          }],
        },
      },
      {
        method: 'POST',
        summary: 'Set user function specialties.',
        auth: 'required',
        roles: ['admin'],
        responseExample: { success: true },
      },
    ],
  },
  {
    path: '/api/users/me',
    group: 'users',
    methods: [
      {
        method: 'GET',
        summary: 'Get current user profile.',
        auth: 'required',
        responseExample: {
          id: 'uuid',
          name: 'string',
          email: 'string',
          role: 'string',
          avatar_url: 'string|null',
        },
      },
      {
        method: 'PATCH',
        summary: 'Update current user profile (name, avatar).',
        auth: 'required',
        responseExample: { id: 'uuid', name: 'string', avatar_url: 'string|null', updated_at: 'ISO-8601' },
      },
    ],
  },
  {
    path: '/api/users/me/preferences',
    group: 'users',
    methods: [
      {
        method: 'GET',
        summary: 'Get current user preferences (theme, naming convention).',
        auth: 'required',
        responseExample: {
          theme: 'light|dark|dim',
          naming_convention: 'string',
          sidebar_collapsed: 'boolean',
        },
      },
      {
        method: 'PATCH',
        summary: 'Update user preferences.',
        auth: 'required',
        responseExample: { success: true },
      },
    ],
  },
  {
    path: '/api/users/me/notification-preferences',
    group: 'users',
    methods: [
      {
        method: 'GET',
        summary: 'Get notification preferences matrix.',
        auth: 'required',
        responseExample: {
          preferences: [{
            event_type: 'string',
            in_app: 'boolean',
            email: 'boolean',
            slack: 'boolean',
          }],
        },
      },
      {
        method: 'PATCH',
        summary: 'Update notification preferences.',
        auth: 'required',
        responseExample: { success: true },
      },
    ],
  },
  {
    path: '/api/notifications',
    group: 'users',
    methods: [
      {
        method: 'GET',
        summary: 'List notifications for current user.',
        auth: 'required',
        queryParams: [
          { name: 'is_read', type: 'boolean', required: false, description: 'Filter by read status' },
          { name: 'page', type: 'number', required: false, description: 'Page number' },
          { name: 'limit', type: 'number', required: false, description: 'Items per page' },
        ],
        responseExample: {
          notifications: [{
            id: 'uuid',
            type: 'string',
            title: 'string',
            message: 'string',
            entity_type: 'string|null',
            entity_id: 'uuid|null',
            is_read: 'boolean',
            created_at: 'ISO-8601',
          }],
          pagination: { page: 'number', limit: 'number', total: 'number', totalPages: 'number' },
        },
      },
    ],
  },
  {
    path: '/api/notifications/:id',
    group: 'users',
    methods: [
      {
        method: 'PATCH',
        summary: 'Mark notification as read.',
        auth: 'required',
        responseExample: { success: true },
      },
      {
        method: 'DELETE',
        summary: 'Delete a notification.',
        auth: 'required',
        responseExample: { success: true },
      },
    ],
  },
  {
    path: '/api/notifications/unread-count',
    group: 'users',
    methods: [
      {
        method: 'GET',
        summary: 'Get count of unread notifications.',
        auth: 'required',
        responseExample: { count: 'number' },
      },
    ],
  },
  {
    path: '/api/notifications/mark-all-read',
    group: 'users',
    methods: [
      {
        method: 'POST',
        summary: 'Mark all notifications as read.',
        auth: 'required',
        responseExample: { success: true },
      },
    ],
  },
];
