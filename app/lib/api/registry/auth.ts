import type { ApiEndpoint } from './index';

export const authEndpoints: ApiEndpoint[] = [
  {
    path: '/api/auth/login',
    group: 'auth',
    methods: [
      {
        method: 'POST',
        summary: 'Authenticate user with email and password. Sets HTTP-only cookies.',
        auth: 'none',
        bodySchema: [
          { name: 'email', type: 'string', required: true, description: 'User email' },
          { name: 'password', type: 'string', required: true, description: 'User password' },
        ],
        responseExample: {
          user: { id: 'uuid', name: 'string', email: 'string', role: 'tech|pm|admin' },
        },
        responseNotes: 'Sets access_token and refresh_token HTTP-only cookies. The response body contains user info only.',
      },
    ],
  },
  {
    path: '/api/auth/logout',
    group: 'auth',
    methods: [
      {
        method: 'POST',
        summary: 'Clear auth cookies and delete session.',
        auth: 'required',
        responseExample: { success: true },
      },
    ],
  },
  {
    path: '/api/auth/me',
    group: 'auth',
    methods: [
      {
        method: 'GET',
        summary: 'Get current authenticated user profile with preferences.',
        auth: 'required',
        responseExample: {
          user: { id: 'uuid', name: 'string', email: 'string', role: 'tech|pm|admin', avatar_url: 'string|null' },
        },
      },
    ],
  },
  {
    path: '/api/auth/refresh',
    group: 'auth',
    methods: [
      {
        method: 'POST',
        summary: 'Refresh access token using refresh token cookie.',
        auth: 'none',
        responseExample: { success: true },
        responseNotes: 'Sets new access_token cookie. Requires valid refresh_token cookie.',
      },
    ],
  },
  {
    path: '/api/auth/forgot-password',
    group: 'auth',
    methods: [
      {
        method: 'POST',
        summary: 'Initiate password reset. Sends email with reset link.',
        auth: 'none',
        bodySchema: [
          { name: 'email', type: 'string', required: true, description: 'User email' },
        ],
        responseExample: { success: true },
        responseNotes: 'Always returns success even if email not found (prevents user enumeration).',
      },
    ],
  },
  {
    path: '/api/auth/reset-password',
    group: 'auth',
    methods: [
      {
        method: 'POST',
        summary: 'Complete password reset with token from email.',
        auth: 'none',
        bodySchema: [
          { name: 'token', type: 'string', required: true, description: 'Reset token from email' },
          { name: 'password', type: 'string', required: true, description: 'New password' },
        ],
        responseExample: { success: true },
      },
    ],
  },
  {
    path: '/api/api-keys',
    group: 'auth',
    methods: [
      {
        method: 'GET',
        summary: 'List current user\'s API keys (excludes revoked).',
        auth: 'required',
        responseExample: {
          api_keys: [{ id: 'uuid', name: 'string', key_prefix: 'citadel_abcd1234', last_used_at: 'ISO-8601|null', expires_at: 'ISO-8601|null', created_at: 'ISO-8601' }],
        },
      },
      {
        method: 'POST',
        summary: 'Create a new API key. The full key is returned ONLY in this response.',
        auth: 'required',
        bodySchema: [
          { name: 'name', type: 'string', required: true, description: 'Descriptive name for the key (max 100 chars)' },
          { name: 'expires_at', type: 'ISO-8601', required: false, description: 'Optional expiration date' },
        ],
        responseExample: {
          id: 'uuid',
          name: 'string',
          key: 'citadel_<full-key-shown-once>',
          key_prefix: 'citadel_abcd1234',
          expires_at: 'ISO-8601|null',
          created_at: 'ISO-8601',
        },
      },
    ],
  },
  {
    path: '/api/api-keys/:id',
    group: 'auth',
    methods: [
      {
        method: 'DELETE',
        summary: 'Revoke an API key (soft delete). Key immediately stops working.',
        auth: 'required',
        responseExample: { success: true },
      },
    ],
  },
];
