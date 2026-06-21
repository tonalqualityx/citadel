import type { ApiEndpoint } from './index';

export const portalEndpoints: ApiEndpoint[] = [
  {
    path: '/api/portal/login/request',
    group: 'portal',
    methods: [
      {
        method: 'POST',
        summary:
          'Client contact requests a magic-link login. Issues a short-lived, single-use link per matching active contact and emails it. Public, no auth required.',
        auth: 'none',
        bodySchema: [
          { name: 'email', type: 'string', required: true, description: 'The contact email to send the login link to' },
        ],
        responseExample: { requested: true },
        responseNotes:
          'Always returns { requested: true } regardless of whether the email matches a contact (no email enumeration). Rate-limited.',
      },
    ],
  },
  {
    path: '/api/portal/login/:token',
    group: 'portal',
    methods: [
      {
        method: 'GET',
        summary:
          'Consume a magic-link token (single-use): issues a 7-day client-scoped session cookie and redirects into the portal. Public, no auth required.',
        auth: 'none',
        responseNotes:
          'Sets the httpOnly `client_session` cookie and 303-redirects to /portal on success; redirects to /portal/login?error=invalid for an invalid/expired/used token (no cookie set).',
      },
    ],
  },
  {
    path: '/api/portal/clients/:clientId',
    group: 'portal',
    methods: [
      {
        method: 'GET',
        summary:
          'Client-scoped portal read of a client (id + name). Requires a client_session cookie; a session may only read its own client.',
        auth: 'session',
        responseExample: { client: { id: 'uuid', name: 'string' } },
        responseNotes:
          '401 without a valid client session; 403 when the session belongs to a different client; 404 if the client does not exist.',
      },
    ],
  },
  {
    path: '/api/portal/articles',
    group: 'portal',
    methods: [
      {
        method: 'GET',
        summary:
          "The logged-in client's articles that are ready for their review (in_review only), client-scoped via the A2 projection. Requires a client_session cookie; lists only the session client's articles.",
        auth: 'session',
        responseExample: {
          articles: [
            {
              id: 'uuid',
              title: 'string',
              status: 'in_review',
              body: 'string|null',
              comments: [{ id: 'uuid', content: 'string', author_name: 'string|null', created_at: 'ISO-8601' }],
              created_at: 'ISO-8601',
              updated_at: 'ISO-8601',
            },
          ],
        },
        responseNotes:
          '401 without a valid client session. Scope is implicit (client_id from the session, never from input), so no cross-client read is possible; only in_review, non-deleted articles are returned, newest-updated first.',
      },
    ],
  },
  {
    path: '/api/portal/tasks/:token',
    group: 'portal',
    methods: [
      {
        method: 'GET',
        summary:
          'View a task client-approval page via portal token. Returns the client-safe task projection plus the staging preview. Public, no auth required.',
        auth: 'none',
        responseExample: {
          task: {
            id: 'uuid',
            title: 'string',
            description: 'object|null',
            status: 'not_started|in_progress|review|done|blocked|abandoned',
            estimated_minutes: 'number|null',
            comments: [{ id: 'uuid', content: 'string', author_name: 'string|null', created_at: 'ISO-8601' }],
            created_at: 'ISO-8601',
            updated_at: 'ISO-8601',
          },
          staging_preview_url: 'string|null',
          staging_deployed_at: 'ISO-8601|null',
          already_approved: 'boolean',
          contact: { id: 'uuid', name: 'string|null' },
          available_sites: [{ id: 'uuid', name: 'string|null' }],
        },
        responseNotes:
          'Returns 404 if token is invalid or expired. contact is the resolved acting client contact (requestor, else client primary) or null; available_sites are that contact\'s client sites (for the new-task action).',
      },
    ],
  },
  {
    path: '/api/portal/tasks/:token/approve',
    group: 'portal',
    methods: [
      {
        method: 'POST',
        summary:
          'Client approves the staged work via portal token. Sets client_approved_at + approved_by_contact_id. Idempotent. Public, no auth required.',
        auth: 'none',
        responseExample: {
          message: 'Approved',
          approved_at: 'ISO-8601',
          promotion_pending: 'boolean',
        },
        responseNotes:
          'promotion_pending is true for staged client sites (site.auto_deploy=false): staging→prod promotion is a separate operator step (recorded as an internal note), not performed here. Returns 404 for an invalid/expired token.',
      },
    ],
  },
  {
    path: '/api/portal/tasks/:token/request-changes',
    group: 'portal',
    methods: [
      {
        method: 'POST',
        summary:
          'Client asks for rework via portal token. Re-opens the task (status→not_started) and records the note as a client-visible comment. Public, no auth required.',
        auth: 'none',
        bodySchema: [
          { name: 'note', type: 'string', required: true, description: "What needs changing (the 'what')" },
        ],
        responseExample: {
          message: 'Thanks — sent back for changes',
          status: 'not_started',
        },
        responseNotes: 'Returns 400 if already approved, 404 for an invalid/expired token.',
      },
    ],
  },
  {
    path: '/api/portal/tasks/:token/new-task',
    group: 'portal',
    methods: [
      {
        method: 'POST',
        summary:
          'Client files a new request from the portal. Creates a not_started task routed to Bast triage, tagged with client provenance. site_id must belong to the contact\'s client. Public, no auth required.',
        auth: 'none',
        bodySchema: [
          { name: 'title', type: 'string', required: true, description: 'Short title' },
          { name: 'description', type: 'string', required: false, description: 'Detailed description' },
          { name: 'site_id', type: 'string', required: true, description: 'One of the contact\'s linked sites' },
        ],
        responseExample: {
          message: 'Thanks — your request has been received',
          task: { id: 'uuid', title: 'string', status: 'not_started' },
        },
        responseNotes:
          'Returns 400 if no contact is linked or the site is not the contact\'s, 404 for an invalid/expired token.',
      },
    ],
  },
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
