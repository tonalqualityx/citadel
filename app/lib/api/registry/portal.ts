import type { ApiEndpoint } from './index';

export const portalEndpoints: ApiEndpoint[] = [
  {
    path: '/api/portal/proposals/:token',
    group: 'portal',
    methods: [
      {
        method: 'GET',
        summary: 'View a proposal via portal token. Public, no auth required.',
        auth: 'none',
        responseExample: {
          id: 'uuid',
          version: 'number',
          content: 'string',
          status: 'string',
          pricing_snapshot: 'object',
          accord: {
            name: 'string',
            client: { name: 'string' },
            owner: { name: 'string', email: 'string' },
            charter_items: [{ name: 'string', final_price: 'number', billing_period: 'string' }],
            commission_items: [{ name: 'string', final_price: 'number|null' }],
            keep_items: [{ site_name: 'string', monthly_total: 'number|null' }],
          },
        },
        responseNotes: 'Returns 404 if token is invalid or expired.',
      },
    ],
  },
  {
    path: '/api/portal/proposals/:token/respond',
    group: 'portal',
    methods: [
      {
        method: 'POST',
        summary: 'Respond to a proposal (accept, reject, or request changes). Public, no auth required.',
        auth: 'none',
        bodySchema: [
          { name: 'action', type: 'string', required: true, description: 'accept, reject, or changes_requested' },
          { name: 'note', type: 'string', required: false, description: 'Optional note from the client' },
        ],
        responseExample: {
          message: 'Proposal accepted',
          status: 'accepted',
        },
        responseNotes: 'On accept, the accord status advances to "contract".',
      },
    ],
  },
  {
    path: '/api/portal/msa/:token',
    group: 'portal',
    methods: [
      {
        method: 'GET',
        summary: 'View MSA content for signing via portal token. Public, no auth required.',
        auth: 'none',
        responseExample: {
          id: 'uuid',
          client: { name: 'string' },
          msa_version: { version: 'string', content: 'string', effective_date: 'ISO-8601' },
          already_signed: 'boolean',
        },
      },
    ],
  },
  {
    path: '/api/portal/msa/:token/sign',
    group: 'portal',
    methods: [
      {
        method: 'POST',
        summary: 'Sign an MSA via portal token. Records signature details including IP and user agent. Public, no auth required.',
        auth: 'none',
        bodySchema: [
          { name: 'signer_name', type: 'string', required: true, description: 'Full name of the signer' },
          { name: 'signer_email', type: 'string', required: true, description: 'Email address of the signer' },
        ],
        responseExample: {
          message: 'MSA signed successfully',
          signed_at: 'ISO-8601',
        },
        responseNotes: 'Returns 400 if MSA has already been signed.',
      },
    ],
  },
  {
    path: '/api/portal/contracts/:token',
    group: 'portal',
    methods: [
      {
        method: 'GET',
        summary: 'View a contract via portal token for signing. Public, no auth required.',
        auth: 'none',
        responseExample: {
          id: 'uuid',
          version: 'number',
          content: 'string',
          status: 'string',
          pricing_snapshot: 'object',
          accord: {
            name: 'string',
            client: { name: 'string' },
            owner: { name: 'string', email: 'string' },
            charter_items: [{ name: 'string', final_price: 'number', billing_period: 'string' }],
            commission_items: [{ name: 'string', final_price: 'number|null' }],
            keep_items: [{ site_name: 'string', monthly_total: 'number|null' }],
          },
          msa_version: { version: 'string' },
        },
        responseNotes: 'Returns 404 if token is invalid or expired.',
      },
    ],
  },
  {
    path: '/api/portal/contracts/:token/sign',
    group: 'portal',
    methods: [
      {
        method: 'POST',
        summary: 'Sign a contract via portal token. Records signer details including IP and user agent. Advances accord to signed status. Public, no auth required.',
        auth: 'none',
        bodySchema: [
          { name: 'signer_name', type: 'string', required: true, description: 'Full name of the signer' },
          { name: 'signer_email', type: 'string', required: true, description: 'Email address of the signer' },
        ],
        responseExample: {
          message: 'Contract signed successfully',
          signed_at: 'ISO-8601',
        },
        responseNotes: 'Returns 400 if contract has already been signed.',
      },
    ],
  },
];
