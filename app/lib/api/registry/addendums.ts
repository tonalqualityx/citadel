import type { ApiEndpoint } from './index';

export const addendumEndpoints: ApiEndpoint[] = [
  {
    path: '/api/accords/:id/addendums',
    group: 'addendums',
    methods: [
      {
        method: 'GET',
        summary: 'List addendums for an accord.',
        auth: 'required',
        responseExample: {
          addendums: [{
            id: 'uuid',
            accord_id: 'uuid',
            title: 'string',
            description: 'string|null',
            status: 'draft|sent|accepted|rejected|changes_requested',
            contract_content: 'string|null',
            changes: 'object|null',
            pricing_snapshot: 'object|null',
            is_override: 'boolean',
            override_reason: 'string|null',
            created_at: 'ISO-8601',
            updated_at: 'ISO-8601',
          }],
        },
      },
      {
        method: 'POST',
        summary: 'Create an addendum for an accord.',
        auth: 'required',
        roles: ['pm', 'admin'],
        bodySchema: [
          { name: 'title', type: 'string', required: true, description: 'Addendum title' },
          { name: 'description', type: 'string', required: false, description: 'Addendum description' },
          { name: 'contract_content', type: 'string', required: false, description: 'Contract content / terms' },
          { name: 'changes', type: 'object', required: false, description: 'Structured changes object' },
          { name: 'pricing_snapshot', type: 'object', required: false, description: 'Pricing snapshot at time of creation' },
          { name: 'is_override', type: 'boolean', required: false, description: 'Whether this overrides existing terms' },
          { name: 'override_reason', type: 'string', required: false, description: 'Reason for override' },
        ],
        responseExample: {
          id: 'uuid',
          accord_id: 'uuid',
          title: 'string',
          status: 'draft',
          created_at: 'ISO-8601',
        },
      },
    ],
  },
  {
    path: '/api/accords/:id/addendums/:addendumId',
    group: 'addendums',
    methods: [
      {
        method: 'GET',
        summary: 'Get a single addendum.',
        auth: 'required',
        responseExample: {
          id: 'uuid',
          accord_id: 'uuid',
          title: 'string',
          description: 'string|null',
          status: 'string',
          contract_content: 'string|null',
          changes: 'object|null',
          pricing_snapshot: 'object|null',
          is_override: 'boolean',
          override_reason: 'string|null',
          portal_token: 'string|null',
          portal_token_expires_at: 'ISO-8601|null',
          created_at: 'ISO-8601',
          updated_at: 'ISO-8601',
        },
      },
      {
        method: 'PATCH',
        summary: 'Update a draft addendum.',
        auth: 'required',
        roles: ['pm', 'admin'],
        bodySchema: [
          { name: 'title', type: 'string', required: false, description: 'Addendum title' },
          { name: 'description', type: 'string', required: false, description: 'Addendum description' },
          { name: 'contract_content', type: 'string', required: false, description: 'Contract content / terms' },
          { name: 'changes', type: 'object', required: false, description: 'Structured changes object' },
          { name: 'pricing_snapshot', type: 'object', required: false, description: 'Pricing snapshot' },
          { name: 'is_override', type: 'boolean', required: false, description: 'Whether this overrides existing terms' },
          { name: 'override_reason', type: 'string', required: false, description: 'Reason for override' },
        ],
        responseExample: {
          id: 'uuid',
          title: 'string',
          status: 'string',
          updated_at: 'ISO-8601',
        },
      },
      {
        method: 'DELETE',
        summary: 'Soft delete an addendum.',
        auth: 'required',
        roles: ['admin'],
        responseExample: { success: true },
      },
    ],
  },
  {
    path: '/api/accords/:id/addendums/:addendumId/send',
    group: 'addendums',
    methods: [
      {
        method: 'POST',
        summary: 'Send an addendum to the client for review.',
        auth: 'required',
        roles: ['pm', 'admin'],
        responseExample: {
          id: 'uuid',
          status: 'sent',
          portal_token: 'string',
          portal_token_expires_at: 'ISO-8601',
        },
      },
    ],
  },
  {
    path: '/api/portal/addendums/:token',
    group: 'addendums',
    methods: [
      {
        method: 'GET',
        summary: 'View an addendum via the public portal.',
        auth: 'none',
        responseExample: {
          id: 'uuid',
          title: 'string',
          description: 'string|null',
          status: 'string',
          contract_content: 'string|null',
          changes: 'object|null',
          pricing_snapshot: 'object|null',
          accord: {
            id: 'uuid',
            title: 'string',
            client: { id: 'uuid', name: 'string' },
          },
        },
      },
    ],
  },
  {
    path: '/api/portal/addendums/:token/respond',
    group: 'addendums',
    methods: [
      {
        method: 'POST',
        summary: 'Client responds to an addendum (accept, reject, or request changes).',
        auth: 'none',
        bodySchema: [
          { name: 'response', type: 'string', required: true, description: 'Response: accepted, rejected, changes_requested' },
          { name: 'note', type: 'string', required: false, description: 'Optional note from client' },
          { name: 'signer_name', type: 'string', required: true, description: 'Name of person responding' },
          { name: 'signer_email', type: 'string', required: true, description: 'Email of person responding' },
        ],
        responseExample: {
          id: 'uuid',
          status: 'accepted|rejected|changes_requested',
          signed_at: 'ISO-8601|null',
        },
      },
    ],
  },
];
