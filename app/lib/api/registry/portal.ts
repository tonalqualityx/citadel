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
        responseExample: { redirect: '/portal/home' },
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
          requests: { open_count: 'number', top: '[request item, see GET /api/portal/requests] (attention first, at most 3)' },
          retainers: '[{ id, heading, status, period, plan_ready: boolean, open: [at most 3 request items] }] (slice 2)',
          summary: '{ needs_count: number, moving: { projects, retainers, requests } } (slice 2; the home summary line)',
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
          'Client asks for rework via portal token. Re-opens the task (status→not_started), tags it client-sent-back, and stores the note word for word as the link contact\'s own thread message. A link with no contact of its own (made by the approval-link and notify-requestor routes) never writes under another person: the note is saved as an INTERNAL staff comment quoted as client input, the task is tagged client-sent-back and needs-mike, and the task owner is alerted; the answer is the same. GET /api/portal/tasks/:token reports can_request_changes so the page can say so up front. Approval clears the client-sent-back tag. Public, no auth required.',
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
  {
    path: '/api/portal/intake/context',
    group: 'portal',
    methods: [
      {
        method: 'GET',
        summary:
          'Portal phase B slice 1: what the request chat needs. The active client\'s sites, the open builds the contact may see (ready, in_progress, review), and the active or paused charters with a client-facing plan label (never the internal charter name). The browser runs the same pure placement function for the summary line; the server re-checks every id at filing. Requires a client_session cookie. Rate limited to 120 a minute.',
        auth: 'session',
        responseExample: {
          can_request: 'boolean',
          sites: [{ id: 'uuid', name: 'string', has_plan: 'boolean' }],
          open_builds: [{ id: 'uuid', name: 'string', site_id: 'uuid|null', status: 'ready|in_progress|review', scope_locked: 'boolean' }],
          charters: [{ id: 'uuid', site_id: 'uuid|null', status: 'active|paused', start_date: 'ISO-8601', end_date: 'ISO-8601|null', created_at: 'ISO-8601', label: 'string' }],
        },
        responseNotes: 'can_request is false for grant-only contacts (portal_role none); the lists are then empty.',
      },
    ],
  },
  {
    path: '/api/portal/requests',
    group: 'portal',
    methods: [
      {
        method: 'POST',
        summary:
          'Portal phase B slice 1: file a request as one Citadel task. Answers are validated against the fixed question tree and the stored prompts are rebuilt server-side. Placement mirrors inbound placement rule 6; during a build, a new page or feature, or any change after content lock, files tagged quote and needs-mike. The two urgent "broken" choices file at priority 1 with a critical notification to Mike and a portal.emergency wait. Idempotent on intake_id (one transaction under pg_advisory_xact_lock). Rate limits are counted in the database per person: 6 an hour, 20 a day; 3 emergencies a day per client (past that they file as priority 2 with needs-mike). Roles owner, member and viewer may file; grant-only contacts get 403.',
        auth: 'session',
        bodySchema: [
          { name: 'intake_id', type: 'uuid', required: true, description: 'Client-generated id for this draft; makes a repeat POST a no-op' },
          { name: 'type', type: 'string', required: true, description: 'site_change | new_page_feature | content_article | marketing_question | broken | other' },
          { name: 'site_id', type: 'uuid', required: false, description: 'The chosen site' },
          { name: 'project_id', type: 'uuid', required: false, description: 'A siteless open build chosen at the site step, or a prefill from a project page' },
          { name: 'chosen_project_id', type: 'uuid', required: false, description: 'The pick when the site has two open builds' },
          { name: 'answers', type: 'object', required: true, description: 'Array of { key: q1|q2|q3, value, detail? }. Choice questions send the choice key as value.' },
        ],
        responseExample: {
          task: {
            id: 'uuid',
            client_title: 'string',
            state: { label: 'Received', tone: 'quiet' },
            engagement: { kind: 'project|retainer|request', label: 'string', href: 'string|null' },
          },
          urgent: 'boolean',
        },
        responseNotes: '201 when new, 200 with the same task on a repeat. 404 for any site or project the contact may not see. 422 choose_project when two open builds match and none was chosen. 429 with the plain-language rate message.',
      },
      {
        method: 'GET',
        summary:
          'Portal phase B slice 1: open requests (attention first, then newest) and recently closed ones for the active client. Includes client-visible ad hoc tasks and every task a contact on the client filed, on any chain. Query: site_id, closed_days (default 30). Requires a client_session cookie. Rate limited to 120 a minute.',
        auth: 'session',
        queryParams: [
          { name: 'site_id', type: 'uuid', required: false, description: 'Only requests on this site' },
          { name: 'closed_days', type: 'number', required: false, description: 'How far back "recently closed" goes (default 30, max 365)' },
        ],
        responseExample: {
          open: [
            {
              id: 'uuid', title: 'string (client_title ?? title)',
              state: { label: 'string', tone: 'attention|moving|done|quiet|urgent|quote' },
              engagement: { kind: 'project|retainer|request', label: 'string', href: 'string|null' },
              site: '{ id, name }|null', created_at: 'ISO-8601', updated_at: 'ISO-8601',
            },
          ],
          recently_closed: [],
        },
        responseNotes: 'Allow-list only: tags, estimates and assignees never leave the server.',
      },
    ],
  },
  {
    path: '/api/portal/work/:id',
    group: 'portal',
    methods: [
      {
        method: 'GET',
        summary:
          'Portal phase B slice 1: one client-visible task in client words. Title (client_title ?? title), state chip, engagement, site, who asked (first name), the intake answers verbatim, and the staged preview when it waits on the client. 404 for anything the contact may not see. Requires a client_session cookie. Rate limited to 120 a minute.',
        auth: 'session',
        responseExample: {
          work: {
            id: 'uuid', title: 'string',
            state: { label: 'string', tone: 'string' },
            engagement: { kind: 'project|retainer|request', label: 'string', href: 'string|null' },
            site: '{ id, name }|null',
            requested_by: '{ first_name }|null',
            requested_at: 'ISO-8601',
            answers: [{ prompt: 'string', value: 'string' }],
            staged: '{ preview_url, awaiting_approval }|null',
            can_act: 'boolean',
          },
        },
      },
    ],
  },
  {
    path: '/api/portal/work/:id/messages',
    group: 'portal',
    methods: [
      {
        method: 'GET',
        summary:
          'Portal phase B slice 2: the conversation on a request, oldest first. Shows the client\'s own messages and the staff replies shared with them (client_visible), plus older questions staff marked for the client. Staff replies carry the author "Indelible", never a name; internal notes and unflagged comments never appear. Query: after (ISO-8601, only newer messages; the page polls every 30 seconds). 404 for work the contact may not see. Requires a client_session cookie. Rate limited to 120 a minute.',
        auth: 'session',
        responseExample: {
          messages: [
            { id: 'uuid', author: { kind: 'client|staff', name: 'string' }, mine: 'boolean', text: 'string', created_at: 'ISO-8601' },
          ],
        },
      },
      {
        method: 'POST',
        summary:
          'Portal phase B slice 2: the client writes in the thread. Creates a Comment authored by the contact (author_contact_id set, user_id null, client_visible true, is_internal false), text verbatim. 201 when new, 200 with the same message when client_ref was already sent. Opens or moves the request\'s wait: stops the contact\'s waits, flags staff-owned waits needs_human, or opens portal.client_reply. Any client role may write, grant-only contacts included. 20 messages per 10 minutes and 200 a day per person (counted in the database); past that, 429 with the plain-words limit message.',
        auth: 'session',
        bodySchema: [
          { name: 'client_ref', type: 'uuid', required: true, description: 'The client\'s id for this message; a repeat is a no-op' },
          { name: 'text', type: 'string', required: true, description: '1 to 4,000 characters, stored verbatim' },
        ],
        responseExample: { message: { id: 'uuid', author: { kind: 'client', name: 'string' }, mine: true, text: 'string', created_at: 'ISO-8601' } },
      },
    ],
  },
  {
    path: '/api/portal/retainer',
    group: 'portal',
    methods: [
      {
        method: 'GET',
        summary:
          'Portal phase B slice 2: one card per active or paused charter. Heading is Charter.client_label, else the active wares\' names, else "Marketing plan" (Charter.name is internal and never sent). Period, the sites covered, a staged unapproved marketing-plan task as plan_ready, this month\'s open and finished client-visible work, the newest published report, and the plan allowance as text. Hours used are never selected or sent. A grant-only contact gets an empty list. Requires a client_session cookie.',
        auth: 'session',
        responseExample: {
          retainers: [
            {
              id: 'uuid', heading: 'string', status: { label: 'Active|Paused', tone: 'string' }, period: 'October 2026',
              covers: ['string'], allowance: 'string|null',
              plan_ready: '{ task_id, title, preview_url, book_href }|null',
              this_month: { open: ['request item'], done: ['request item'] },
              latest_report: '{ title, headline, period, url }|null',
            },
          ],
        },
      },
    ],
  },
  {
    path: '/api/portal/projects',
    group: 'portal',
    methods: [
      {
        method: 'GET',
        summary:
          'Portal phase B slice 2: the projects the contact may see, active (ready, in progress, in review) first, then complete. Same scope as the project page: hidden, restricted and pre-kickoff projects never appear. Name, status word, "N of M complete", the next open milestone and the target date. No money, owners or tags. Requires a client_session cookie.',
        auth: 'session',
        responseExample: {
          active: [
            { id: 'uuid', name: 'string', status_label: 'Starting soon|In progress|In review', progress: { done: 'number', total: 'number' }, next_milestone: '{ name, target_date }|null', target_date: 'ISO-8601|null', updated_at: 'ISO-8601' },
          ],
          complete: [],
        },
      },
    ],
  },
  {
    path: '/api/portal-notices',
    group: 'portal',
    methods: [
      {
        method: 'GET',
        summary:
          'Portal phase B slice 2: the outbox of "new reply on your request" emails, read by the machine-side sender (approval-sender.py process_portal_notices). pm and admin only. For status=queued, stale notices are cancelled first (a reply that was unflagged, made internal or deleted), and only notices quiet for at least older_than seconds are returned (default 120).',
        auth: 'required',
        roles: ['pm', 'admin'],
        queryParams: [
          { name: 'status', type: 'string', required: false, description: 'queued (default), sending, sent, failed or cancelled' },
          { name: 'older_than', type: 'number', required: false, description: 'Seconds a queued notice must have been quiet. Default 120.' },
          { name: 'task_id', type: 'uuid', required: false, description: 'Only notices for this task' },
        ],
        responseExample: {
          notices: [{ id: 'uuid', task_id: 'uuid', contact_id: 'uuid', comment_ids: ['uuid'], to_email: 'string', subject: 'string', body: 'string', status: 'queued', created_at: 'ISO-8601' }],
        },
      },
    ],
  },
  {
    path: '/api/portal-notices/:id/sending',
    group: 'portal',
    methods: [
      {
        method: 'PUT',
        summary:
          'The sender\'s claim, BEFORE the email goes to gog: queued -> sending, send_attempt_at stamped. Under the same advisory lock the queue uses, the notice is re-checked and rebuilt, and the answer carries to_email, subject and body exactly as they stand now: the sender sends THOSE, never its earlier list copy. 409 with a code when it cannot be sent: not_queued (another sender took it, or it was cancelled), withdrawn (every reply was unflagged, made internal or deleted in the hold; the notice is cancelled) or no_access (the recipient was deleted or revoked, or lost the project; the notice is cancelled with a reason and the task owner gets an in-app alert). Mirrors PUT /api/approval-requests/:id/sending. pm and admin only.',
        auth: 'required',
        roles: ['pm', 'admin'],
        responseExample: { id: 'uuid', status: 'sending', send_attempt_at: 'ISO-8601', to_email: 'string', subject: 'string', body: 'string' },
        responseNotes: '409 code is one of not_queued, withdrawn, no_access.',
      },
    ],
  },
  {
    path: '/api/portal-notices/:id/sent',
    group: 'portal',
    methods: [
      {
        method: 'PUT',
        summary:
          'Record a delivery: sending -> sent. An already sent notice is an idempotent re-confirmation. Mirrors PUT /api/approval-requests/:id/sent. pm and admin only.',
        auth: 'required',
        roles: ['pm', 'admin'],
        bodySchema: [
          { name: 'sent_at', type: 'ISO-8601', required: true, description: 'When gog delivered it' },
          { name: 'message_id', type: 'string', required: false, description: 'Required unless delivered_unconfirmed' },
          { name: 'thread_id', type: 'string', required: false, description: 'Required unless delivered_unconfirmed' },
          { name: 'delivered_unconfirmed', type: 'boolean', required: false, description: 'The email went out but its ids could not be resolved' },
        ],
        responseExample: { id: 'uuid', status: 'sent', message_id: 'string|null', thread_id: 'string|null', sent_at: 'ISO-8601' },
      },
    ],
  },
  {
    path: '/api/portal-notices/:id/send-error',
    group: 'portal',
    methods: [
      {
        method: 'PUT',
        summary:
          'The sender could not hand the email to gog. The first two errors release the notice back to queued; the third (or a refusal on a queued notice) ends in failed. Mirrors PUT /api/approval-requests/:id/send-error. pm and admin only.',
        auth: 'required',
        roles: ['pm', 'admin'],
        bodySchema: [{ name: 'error', type: 'string', required: true, description: 'Why it failed' }],
        responseExample: { id: 'uuid', status: 'queued|failed', send_error: 'string', send_error_count: 'number' },
      },
    ],
  },
  {
    path: '/api/client-reports',
    group: 'portal',
    methods: [
      {
        method: 'POST',
        summary:
          'Portal phase B slice 2: upsert a published monthly report by url, for the Retainer page. The Steward lane calls it when it publishes clients/<slug>/steward/<period>/publish.json. 409 when the url belongs to another client. pm and admin only.',
        auth: 'required',
        roles: ['pm', 'admin'],
        bodySchema: [
          { name: 'client_id', type: 'uuid', required: true, description: 'The client' },
          { name: 'charter_id', type: 'uuid', required: false, description: 'The charter the report covers' },
          { name: 'site_id', type: 'uuid', required: false, description: 'The site the report covers' },
          { name: 'period', type: 'string', required: true, description: 'YYYY-MM' },
          { name: 'title', type: 'string', required: true, description: 'Report title' },
          { name: 'headline', type: 'string', required: false, description: 'The finding sentence' },
          { name: 'url', type: 'string', required: true, description: 'The tracked report page (http or https)' },
          { name: 'published_at', type: 'ISO-8601', required: false, description: 'Unset means not yet visible to the client' },
        ],
        responseExample: { report: { id: 'uuid', period: 'YYYY-MM', title: 'string', url: 'string' } },
      },
    ],
  },
  {
    path: '/api/portal/chat',
    group: 'portal',
    methods: [
      {
        method: 'POST',
        summary:
          'Portal phase C: the first chat message. Saves the words verbatim and files the task in one transaction (type other, tags portal-chat and chat-clarifying), then queues a reply job or runs the question tree. 201 when new, 200 on a repeat of intake_id. 409 chat_unavailable when the switches are off for this contact (the page shows the stepper).',
        auth: 'session',
        bodySchema: [
          { name: 'intake_id', type: 'uuid', required: true, description: 'Idempotency key for the conversation' },
          { name: 'client_ref', type: 'uuid', required: true, description: 'Idempotency key for the message' },
          { name: 'text', type: 'string', required: true, description: 'The client words, verbatim (4000 characters at most)' },
          { name: 'site_id', type: 'uuid', required: false, description: 'The site, when chosen' },
          { name: 'attachment_ids', type: 'string[]', required: false, description: 'Staged uploads (10 at most)' },
        ],
        responseExample: { conversation_id: 'uuid', task_id: 'uuid', mode: 'model|tree' },
      },
    ],
  },
  {
    path: '/api/portal/chat/{id}',
    group: 'portal',
    methods: [
      {
        method: 'GET',
        summary:
          'Portal phase C: poll the chat. Query after=<comment id>. Returns state, mode, messages, writing and the writing note, the one pending thing to answer (ask, summary card, or urgent choices), the banner. Expires a stale job first (queued over 60 s or claimed over 120 s) and answers the turn from the tree. 404 for anything not theirs.',
        auth: 'session',
        responseExample: { conversation_id: 'uuid', state: 'clarifying|confirming|filed|with_person|closed', mode: 'model|tree', messages: 'object', writing: 'boolean', writing_note: 'writing|still_writing|checking_numbers|null', pending: 'object|null', urgent: 'object|null', banner: 'string|null' },
      },
    ],
  },
  {
    path: '/api/portal/chat/{id}/messages',
    group: 'portal',
    methods: [
      {
        method: 'POST',
        summary:
          'Portal phase C: the client writes or presses a choice. Saved first, verbatim (client_ref dedupe); a choice is validated against the real options and labelled from the database. 201 when new, 200 on a repeat.',
        auth: 'session',
        bodySchema: [
          { name: 'client_ref', type: 'uuid', required: true, description: 'Idempotency key for the message' },
          { name: 'text', type: 'string', required: false, description: 'Free text' },
          { name: 'choice', type: 'object', required: false, description: '{ slot, id } of a button pressed' },
          { name: 'attachment_ids', type: 'string[]', required: false, description: 'Staged uploads' },
        ],
        responseExample: { comment_id: 'uuid', route: 'queued|tree|person|none|repeat', urgent: 'object|null' },
      },
    ],
  },
  {
    path: '/api/portal/chat/{id}/confirm',
    group: 'portal',
    methods: [
      {
        method: 'POST',
        summary:
          'Portal phase C: Send to the team. Re-runs placement, applies the scope gate and tags, retitles, links files and runs the phase B first-response or quote or emergency wait. 409 when the summary changed; 422 choose_project when two builds are open.',
        auth: 'session',
        bodySchema: [
          { name: 'summary_version', type: 'number', required: true, description: 'The version on the card the client pressed' },
          { name: 'project_id', type: 'uuid', required: false, description: 'The build chosen when two are open' },
        ],
        responseExample: { state: 'filed', quote: 'boolean', urgent: 'boolean', lines: 'string[]' },
      },
    ],
  },
  {
    path: '/api/portal/chat/{id}/presence',
    group: 'portal',
    methods: [
      {
        method: 'POST',
        summary:
          'Portal phase C: presence for the walk-away sweep (slice C4).',
        auth: 'session',
        bodySchema: [
          { name: 'state', type: 'string', required: true, description: 'visible | typing | hidden' },
        ],
        responseExample: { ok: true },
      },
    ],
  },
  {
    path: '/api/portal/uploads',
    group: 'portal',
    methods: [
      {
        method: 'POST',
        summary:
          'Portal phase C: stage one file (multipart: file, intake_id or conversation_id). Type by magic bytes; SVG, HTML, executables, archives and macro Office are refused; 20 MB a file, 150 MB a conversation, 60 uploads a contact a day. Stored privately.',
        auth: 'session',
        responseExample: { attachment: { id: 'uuid', name: 'string', type: 'string', size: 'number', url: 'string' } },
      },
    ],
  },
  {
    path: '/api/portal/attachments/{id}',
    group: 'portal',
    methods: [
      {
        method: 'GET',
        summary:
          'Portal phase C: the file, to the client that owns it only. nosniff; images inline, the rest a download.',
        auth: 'session',
      },
    ],
  },
];
