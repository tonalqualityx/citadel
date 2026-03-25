import type { ApiEndpoint } from './index';

export const contractEndpoints: ApiEndpoint[] = [
  {
    path: '/api/accords/:id/contracts',
    group: 'contracts',
    methods: [
      {
        method: 'GET',
        summary: 'List contracts for an accord, ordered by version descending.',
        auth: 'required',
        roles: ['pm', 'admin'],
        responseExample: {
          contracts: [{
            id: 'uuid',
            accord_id: 'uuid',
            version: 'number',
            content: 'string',
            status: 'draft|sent|signed',
            pricing_snapshot: 'object',
            sent_at: 'ISO-8601|null',
            signed_at: 'ISO-8601|null',
            msa_version: { id: 'uuid', version: 'string' },
            created_by: { id: 'uuid', name: 'string', email: 'string' },
            created_at: 'ISO-8601',
          }],
          total: 'number',
        },
      },
      {
        method: 'POST',
        summary: 'Generate a new contract from accord line items. Auto-increments version, snapshots pricing, assembles content from ware contract language.',
        auth: 'required',
        roles: ['pm', 'admin'],
        bodySchema: [
          { name: 'msa_version_id', type: 'uuid', required: false, description: 'MSA version to reference (defaults to current)' },
          { name: 'content', type: 'string', required: false, description: 'Override generated content' },
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
    path: '/api/accords/:id/contracts/:contractId',
    group: 'contracts',
    methods: [
      {
        method: 'GET',
        summary: 'Get contract details.',
        auth: 'required',
        roles: ['pm', 'admin'],
        responseExample: {
          id: 'uuid',
          accord_id: 'uuid',
          version: 'number',
          content: 'string',
          status: 'string',
          pricing_snapshot: 'object',
          msa_version: { id: 'uuid', version: 'string' },
          sent_at: 'ISO-8601|null',
          signed_at: 'ISO-8601|null',
          created_at: 'ISO-8601',
        },
      },
      {
        method: 'PATCH',
        summary: 'Update a draft contract content. Only draft contracts can be edited.',
        auth: 'required',
        roles: ['pm', 'admin'],
        bodySchema: [
          { name: 'content', type: 'string', required: false, description: 'Contract HTML content' },
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
        summary: 'Soft delete a contract.',
        auth: 'required',
        roles: ['pm', 'admin'],
        responseExample: { message: 'Contract deleted' },
      },
    ],
  },
  {
    path: '/api/accords/:id/contracts/:contractId/send',
    group: 'contracts',
    methods: [
      {
        method: 'POST',
        summary: 'Send a draft contract to the client. Generates portal token, creates content snapshot, sets status to sent, sends email.',
        auth: 'required',
        roles: ['pm', 'admin'],
        responseExample: {
          id: 'uuid',
          status: 'sent',
          sent_at: 'ISO-8601',
          portal_token: 'string',
          content_snapshot: 'string',
        },
        responseNotes: 'Requires lead_email on the accord or email on the associated client.',
      },
    ],
  },
];
