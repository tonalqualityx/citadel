import type { ApiEndpoint } from './index';

export const portalEndpoints: ApiEndpoint[] = [
  {
    path: '/api/portal/login/request',
    group: 'portal',
    methods: [
      {
        method: 'POST',
        summary:
          'Client contact requests a magic-link login. Issues a single-use, 15-minute link per matching active contact (hashed at rest) and emails it. At most one request per email per 60 seconds; extra requests mint nothing. Public, no auth required.',
        auth: 'none',
        bodySchema: [
          { name: 'email', type: 'string', required: true, description: 'The contact email to send the login link to' },
        ],
        responseExample: { requested: true },
        responseNotes:
          'Always returns { requested: true } regardless of whether the email matches a contact or the 60-second limit applied (no email enumeration). IP rate-limited as well.',
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
          'Legacy magic-link entry. Never consumes the token: 303-redirects to /portal/login/verify?token=... where a person presses one button. Public, no auth required.',
        auth: 'none',
        responseNotes: 'Exists so mail scanners that GET the link cannot burn it.',
      },
    ],
  },
  {
    path: '/api/portal/login/consume',
    group: 'portal',
    methods: [
      {
        method: 'POST',
        summary:
          'Consume a single-use magic-link token (called by the /portal/login/verify button). Sets the httpOnly `client_session` cookie (30 days, sliding on activity, 90-day hard cap) and returns { redirect: "/portal" }. Public, no auth required.',
        auth: 'none',
        bodySchema: [
          { name: 'token', type: 'string', required: true, description: 'The raw token from the emailed link' },
        ],
        responseExample: { redirect: '/portal' },
        responseNotes: '401 for an unknown, already-used or expired token (no cookie set).',
      },
    ],
  },
  {
    path: '/api/portal/logout',
    group: 'portal',
    methods: [
      {
        method: 'POST',
        summary: 'Revoke the current portal session server-side and clear the cookie. Always 200.',
        auth: 'none',
        responseExample: { loggedOut: true },
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
    path: '/api/portal/home',
    group: 'portal',
    methods: [
      {
        method: 'GET',
        summary:
          'Portal v2 phase 1: one aggregate payload for the client account home — identity, pending approvals (in_review articles WITH their comment thread + tasks awaiting client approval WITH staging preview), open/active projects, an open-amount billing summary, a derived recent-activity feed, and the latest stats snapshot per site. Requires a client_session cookie; every field is scoped to the session\'s client_id.',
        auth: 'session',
        responseExample: {
          client: { id: 'uuid', name: 'string' },
          pending_approvals: {
            articles: [
              {
                id: 'uuid', title: 'string', status: 'in_review', body: 'string|null',
                comments: [{ id: 'uuid', content: 'string', author_name: 'string|null', created_at: 'ISO-8601' }],
                created_at: 'ISO-8601', updated_at: 'ISO-8601',
              },
            ],
            tasks: [
              {
                id: 'uuid', title: 'string', description: 'object|null', status: 'review',
                comments: [], staging_preview_url: 'string|null',
                staging_deployed_at: 'ISO-8601|null', created_at: 'ISO-8601', updated_at: 'ISO-8601',
              },
            ],
          },
          needs_from_you: {
            questions: [{ task_id: 'uuid', title: 'string', question: 'string|null', asked_at: 'ISO-8601|null' }],
            review_links: [{ project_id: 'uuid', project_name: 'string', url: 'string' }],
          },
          projects: [
            {
              id: 'uuid', name: 'string', status_label: 'Starting soon|In progress|In review', target_date: 'ISO-8601|null',
              updated_at: 'ISO-8601', progress: { done: 'number', total: 'number' }, current_phase: 'string|null',
              review_link: 'string|null', links: [{ name: 'string', url: 'string', kind: 'review|upload|preview' }],
            },
          ],
          billing: '{ open_amount: number, open_count: number } | null (owner role only, null otherwise)',
          activity: [{ type: 'task_completed|task_approved|article_published', id: 'uuid', title: 'string', url: 'string|null', at: 'ISO-8601' }],
          stats: [
            {
              site: { id: 'uuid', name: 'string' },
              captured_at: 'ISO-8601', period: 'day|week|month',
              payload: { leads: { count: 'number', change_pct: 'number|null' }, uptime_pct: 'number|null' },
            },
          ],
        },
        responseNotes:
          '401 without a valid client session; 404 if the session\'s client record no longer resolves. "billing" is returned only for portal role owner (null for member, viewer and project-only contacts). "billing.open_amount" is computed from billing-eligible, not-yet-invoiced Milestone rows plus Task rows the client may see (A1 visibility rule, project access applied) (no Invoice model exists in this schema) — amount + count only, never rates/margins/internal targets. "activity" is derived from client-safe task/article state, not the internal ActivityLog (which carries non-client-safe diffs). "stats" omits any site with no snapshot yet rather than fabricating zeros.',
      },
    ],
  },
  {
    path: '/api/portal/projects/:id',
    group: 'portal',
    methods: [
      {
        method: 'GET',
        summary:
          'Portal MVP A5: one project in client words. Status label, progress (client-visible tasks done of total), phases with done/current, client-visible tasks, what we need from you (staged approvals, open questions, review link), links, and recent history for the project. Requires a client_session cookie.',
        auth: 'session',
        responseExample: {
          project: {
            id: 'uuid', name: 'string', status_label: 'Starting soon|In progress|In review|Complete',
            target_date: 'ISO-8601|null', completed_date: 'ISO-8601|null',
            progress: { done: 'number', total: 'number' }, current_phase: 'string|null',
          },
          phases: [{ id: 'uuid', name: 'string', state: 'done|current|upcoming' }],
          tasks: [{ id: 'uuid', title: 'string', status_label: 'string', is_done: 'boolean', awaiting_you: 'boolean', phase: 'string|null', completed_at: 'ISO-8601|null' }],
          needs_from_you: {
            approvals: [{ id: 'uuid', title: 'string', staging_preview_url: 'string|null', staging_deployed_at: 'ISO-8601|null' }],
            requests: [{ task_id: 'uuid', title: 'string', question: 'string|null', asked_at: 'ISO-8601|null' }],
            review_link: 'string|null',
          },
          links: [{ name: 'string', url: 'string', kind: 'review|upload|preview' }],
          history: [{ type: 'task_completed|task_approved', id: 'uuid', title: 'string', at: 'ISO-8601' }],
        },
        responseNotes:
          '404 when the project is not accessible to the signed-in contact (other client, hidden, restricted for a non-owner, quote/queue/suspended/cancelled, deleted); the answer is identical for missing and not allowed. Tasks follow the A1 visibility rule. Phases appear only when they hold a client-visible task. Only ResourceLinks marked review or upload are shown. No estimates, assignees, tags, billing or internal notes.',
      },
    ],
  },
  {
    path: '/api/portal/history',
    group: 'portal',
    methods: [
      {
        method: 'GET',
        summary:
          'Portal MVP A5: completed client-visible tasks and published articles for the active client, newest first. Query: page (default 1, max 20), page_size (default 20, max 50). Requires a client_session cookie.',
        auth: 'session',
        responseExample: {
          items: [{ type: 'task_completed|task_approved|article_published', id: 'uuid', title: 'string', url: 'string|null', project: '{ id, name }|null', at: 'ISO-8601' }],
          page: 'number', page_size: 'number', has_more: 'boolean',
        },
        responseNotes:
          'Uses the A1 history visibility rule and the A3 project scope. Project-only contacts get tasks on their granted projects and no articles.',
      },
    ],
  },
  {
    path: '/api/portal/tasks',
    group: 'portal',
    methods: [
      {
        method: 'GET',
        summary:
          "Portal v2 phase 1: the logged-in client's tasks — those awaiting THEIR approval, plus recently-approved ones — mirroring the GET /api/portal/articles session-scoped list pattern. Requires a client_session cookie.",
        auth: 'session',
        responseExample: {
          pending: [
            {
              id: 'uuid', title: 'string', description: 'object|null', status: 'review',
              comments: [], staging_preview_url: 'string|null',
              staging_deployed_at: 'ISO-8601|null', created_at: 'ISO-8601', updated_at: 'ISO-8601',
            },
          ],
          recently_approved: [
            {
              id: 'uuid', title: 'string', description: 'object|null', status: 'done',
              comments: [], client_approved_at: 'ISO-8601',
              created_at: 'ISO-8601', updated_at: 'ISO-8601',
            },
          ],
        },
        responseNotes:
          '401 without a valid client session. "pending" = client_approved_at is null (NOT gated on a minted portal_token — a session can review any of its own tasks). Per-item actions: POST /api/portal/tasks/mine/:id/approve and .../request-changes.',
      },
    ],
  },
  {
    path: '/api/portal/tasks/mine/:id/approve',
    group: 'portal',
    methods: [
      {
        method: 'POST',
        summary:
          'Portal v2 phase 1: session-scoped equivalent of POST /api/portal/tasks/:token/approve — same shared mutation (recordTaskClientApproval), authenticated via the client_session cookie instead of a portal_token. Requires a client_session cookie.',
        auth: 'session',
        responseExample: { message: 'Approved', approved_at: 'ISO-8601', promotion_pending: 'boolean' },
        responseNotes:
          '401 without a session; 404 if the task does not exist or belongs to another client (existence not leaked — never 403). Idempotent (already_approved: true on a repeat call).',
      },
    ],
  },
  {
    path: '/api/portal/tasks/mine/:id/request-changes',
    group: 'portal',
    methods: [
      {
        method: 'POST',
        summary:
          'Portal v2 phase 1: session-scoped equivalent of POST /api/portal/tasks/:token/request-changes — same shared mutation (recordTaskClientRequestChanges). The acting contact is the session\'s own contact (more precise than the token flow\'s best-guess resolution). Requires a client_session cookie.',
        auth: 'session',
        bodySchema: [
          { name: 'note', type: 'string', required: true, description: "What needs changing (the 'what')" },
        ],
        responseExample: { message: 'string', status: 'not_started' },
        responseNotes: '401 without a session; 404 task not found/not this client; 400 already approved or an empty note.',
      },
    ],
  },
  {
    path: '/api/portal/stats',
    group: 'portal',
    methods: [
      {
        method: 'GET',
        summary:
          "Portal v2 phase 1: the logged-in client's latest stats snapshot per site (leads/forms, traffic, rankings, uptime — see SiteStatsPayload). Requires a client_session cookie.",
        auth: 'session',
        responseExample: {
          sites: [
            {
              site: { id: 'uuid', name: 'string' },
              captured_at: 'ISO-8601', period: 'day|week|month',
              payload: { leads: { count: 'number', change_pct: 'number|null' }, uptime_pct: 'number|null' },
            },
          ],
        },
        responseNotes:
          '401 without a valid client session. Sites with no snapshot yet are omitted (no fabricated zeros). See POST /api/cron/site-stats for the ingest contract.',
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
    path: '/api/portal/articles/:id',
    group: 'portal',
    methods: [
      {
        method: 'GET',
        summary:
          "A single article for the logged-in client's full-screen review/edit screen (C4), client-scoped via the A2 projection. Requires a client_session cookie.",
        auth: 'session',
        responseExample: {
          article: {
            id: 'uuid',
            title: 'string',
            status: 'in_review',
            body: 'string|null',
            comments: [{ id: 'uuid', content: 'string', author_name: 'string|null', created_at: 'ISO-8601' }],
            created_at: 'ISO-8601',
            updated_at: 'ISO-8601',
          },
        },
        responseNotes:
          '401 without a valid client session; 403 when the article belongs to a different client; 404 if it does not exist or is still an internal draft stage (existence not leaked). Internal fields never leak (allow-list projection).',
      },
      {
        method: 'PATCH',
        summary:
          "[C5] Save the client's edits to the article body from the full-screen review screen. Requires a client_session cookie; client-scoped.",
        auth: 'session',
        bodySchema: [
          { name: 'body', type: 'string', required: true, description: 'The edited article body (plain text)' },
        ],
        responseExample: {
          article: {
            id: 'uuid',
            title: 'string',
            status: 'in_review',
            body: 'string|null',
            comments: [{ id: 'uuid', content: 'string', author_name: 'string|null', created_at: 'ISO-8601' }],
            created_at: 'ISO-8601',
            updated_at: 'ISO-8601',
          },
        },
        responseNotes:
          '401 without a session; 403 cross-client; 404 missing/internal-draft (existence not leaked); 409 when the article is already approved (body frozen) or not in a reviewable stage (in_review/needs_revision); 400 on an invalid body. Returns the client-safe projection.',
      },
    ],
  },
  {
    path: '/api/portal/articles/:id/approve',
    group: 'portal',
    methods: [
      {
        method: 'POST',
        summary:
          "[C5] Client approves the article from the review screen. Sets client_approved_at + approved_by_contact_id (the logged-in contact) and advances the article to 'approved'. Idempotent. Requires a client_session cookie; client-scoped.",
        auth: 'session',
        responseExample: { status: 'approved', approved_at: 'ISO-8601', already_approved: false },
        responseNotes:
          '401 without a session; 403 cross-client; 404 missing/internal-draft (existence not leaked); 409 when not in a reviewable stage and not already approved. A repeat approval is a no-op (already_approved: true) and never churns status.',
      },
    ],
  },
  {
    path: '/api/portal/articles/:id/request-changes',
    group: 'portal',
    methods: [
      {
        method: 'POST',
        summary:
          "[C5] Client sends the article back for changes from the review screen. Records the note as a client-visible comment (author masked — the worker persona never leaks) and sets status to 'needs_revision'. Requires a client_session cookie; client-scoped.",
        auth: 'session',
        bodySchema: [
          { name: 'note', type: 'string', required: true, description: 'What needs changing (the client-visible feedback)' },
        ],
        responseExample: { message: 'string', status: 'needs_revision' },
        responseNotes:
          '401 without a session; 403 cross-client; 404 missing/internal-draft (existence not leaked); 409 when already approved or not in a reviewable stage; 400 on an empty note.',
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
