import type { ApiEndpoint } from './index';

export const proposalEndpoints: ApiEndpoint[] = [
  {
    path: '/api/accords/:id/proposals',
    group: 'proposals',
    methods: [
      {
        method: 'GET',
        summary: 'List proposals for an accord, ordered by version descending.',
        auth: 'required',
        roles: ['pm', 'admin'],
        responseExample: {
          proposals: [{
            id: 'uuid',
            accord_id: 'uuid',
            version: 'number',
            content: 'string',
            status: 'draft|sent|accepted|rejected|changes_requested',
            pricing_snapshot: 'object',
            sent_at: 'ISO-8601|null',
            client_responded_at: 'ISO-8601|null',
            created_by: { id: 'uuid', name: 'string', email: 'string' },
            created_at: 'ISO-8601',
          }],
          total: 'number',
        },
      },
      {
        method: 'POST',
        summary: 'Create a new proposal version for an accord. Auto-increments version number and snapshots current line item pricing.',
        auth: 'required',
        roles: ['pm', 'admin'],
        bodySchema: [
          { name: 'content', type: 'string', required: false, description: 'Proposal content (rich text)' },
        ],
        responseExample: {
          id: 'uuid',
          accord_id: 'uuid',
          version: 'number',
          status: 'draft',
          pricing_snapshot: 'object',
          created_at: 'ISO-8601',
        },
      },
    ],
  },
  {
    path: '/api/accords/:id/proposals/:proposalId',
    group: 'proposals',
    methods: [
      {
        method: 'GET',
        summary: 'Get proposal details.',
        auth: 'required',
        roles: ['pm', 'admin'],
        responseExample: {
          id: 'uuid',
          accord_id: 'uuid',
          version: 'number',
          content: 'string',
          status: 'string',
          pricing_snapshot: 'object',
          sent_at: 'ISO-8601|null',
          client_responded_at: 'ISO-8601|null',
          client_note: 'string|null',
          created_at: 'ISO-8601',
        },
      },
      {
        method: 'PATCH',
        summary: 'Update a draft proposal. Only draft proposals can be edited.',
        auth: 'required',
        roles: ['pm', 'admin'],
        bodySchema: [
          { name: 'content', type: 'string', required: false, description: 'Proposal content' },
          { name: 'pricing_snapshot', type: 'object', required: false, description: 'Pricing snapshot override' },
        ],
        responseExample: {
          id: 'uuid',
          content: 'string',
          status: 'draft',
          updated_at: 'ISO-8601',
        },
      },
      {
        method: 'DELETE',
        summary: 'Soft delete a proposal.',
        auth: 'required',
        roles: ['pm', 'admin'],
        responseExample: { message: 'Proposal deleted' },
      },
    ],
  },
  {
    path: '/api/accords/:id/proposals/:proposalId/send',
    group: 'proposals',
    methods: [
      {
        method: 'POST',
        summary: 'Send a draft proposal to the client. Generates portal token, sets status to sent, sends email.',
        auth: 'required',
        roles: ['pm', 'admin'],
        responseExample: {
          id: 'uuid',
          status: 'sent',
          sent_at: 'ISO-8601',
          portal_token: 'string',
        },
        responseNotes: 'Requires lead_email on the accord or email on the associated client.',
      },
    ],
  },
];
