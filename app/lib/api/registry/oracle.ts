import type { ApiEndpoint } from './index';

// Oracle Phase 1 fleet telemetry. Read-only visualizer over Claude Code sessions,
// Workflow fan-outs, and openclaw crons on Reshi's workstation(s). Zero LLM tokens spent
// on ingest — a local Python hook handler + a once-a-minute heartbeat cron push structured
// events/snapshots over HTTP. The service client authenticates as the seeded
// oracle@indelible.bot user and is the ONLY caller allowed to POST ingest.
export const oracleEndpoints: ApiEndpoint[] = [
  {
    path: '/api/oracle/ingest',
    group: 'oracle',
    methods: [
      {
        method: 'POST',
        summary: 'Machine client only: push hook events and/or a heartbeat snapshot.',
        auth: 'required',
        responseNotes:
          'Bearer API key for the oracle@indelible.bot service user ONLY — any other caller gets 403. ' +
          'events[] come from Claude Code hooks (SessionStart/UserPromptSubmit/Stop/SubagentStop/' +
          'SessionEnd/Notification); session status is server-derived from event kind, never client-set. ' +
          'snapshot is the heartbeat\'s authoritative state (running processes, wf_*.json progress per ' +
          'agent, openclaw cron list) and upserts sessions + agents directly, then reconciles: any ' +
          'running/waiting/idle session absent from the snapshot and unseen for 5+ minutes flips to stale. ' +
          'Unknown event kinds are stored, never rejected. Capped at 500 events/call and ~32KB per ' +
          'event/agent payload blob (2MB total body); opportunistically prunes OracleEvent rows older ' +
          'than 7 days on every call.',
        bodySchema: [
          { name: 'machine', type: 'object', required: true, description: '{ name (unique machine key), hostname? }' },
          { name: 'sent_at', type: 'ISO-8601', required: false, description: 'Heartbeat/call timestamp; updates machine.last_heartbeat_at' },
          { name: 'events', type: 'object', required: false, description: 'Array of hook events (max 500): { kind, external_id, source, ts, title?, cwd?, model?, tokens_total?, payload? }' },
          { name: 'snapshot', type: 'object', required: false, description: '{ sessions: [{ external_id, source, title?, cwd?, model?, remote_url?, status?, needs_attention?, attention_reason?, started_at?, last_event_at?, ended_at?, tokens_total?, meta?, agents?: [...], session_type?, goal?, waiting_on?, ask_queue?, ask_severity?, arc_id?, archived_at? }] }. remote_url (Phase 3, nullable) must be an https://claude.ai/code/... URL or null to clear — anything else 400s the whole request. Clarity Phase 1 session-meaning fields (session_type/goal/waiting_on/ask_queue/ask_severity/arc_id/archived_at) are each independently nullable-optional: absent leaves the stored value untouched, explicit null clears it. goal/waiting_on are capped at 2000 chars. Clarity Phase 7 — a truthy arc_id is existence-checked against Arc; a miss stores null and adds a message to the response\'s `warnings` array instead of failing the whole call (explicit null is a legitimate clear, never checked/warned).' },
        ],
        responseExample: {
          success: true,
          machine_id: 'uuid',
          events_ingested: 'number',
          sessions_upserted: 'number',
          agents_upserted: 'number',
          reconciled_stale: 'number',
          pruned_events: 'number',
          warnings: ['string'],
        },
      },
    ],
  },
  {
    path: '/api/oracle/calendar-sync',
    group: 'oracle',
    methods: [
      {
        method: 'POST',
        summary:
          'Clarity Phase 3b: sync a rolling window of real Google Calendar events into calendar_events, the Today time-shape\'s calendar source. Same Bearer-auth util as /api/session-tasks (cookie session OR API key) — no bot-only restriction.',
        auth: 'required',
        responseNotes:
          'Upserts every event in the payload by event_id (create-or-update, never duplicates), THEN ' +
          'deletes any calendar_events row whose starts_at falls inside [window_start, window_end] but ' +
          'whose event_id was NOT in this payload — that\'s how a cancelled/deleted meeting disappears. ' +
          'Rows with starts_at outside the window are never touched by this call. The machine-side caller ' +
          '(~/.claude/tools/oracle/clarity/calendar-sync.py, STAGED — not cron-wired) is expected to ' +
          're-sync a rolling window (e.g. now-2h to now+7d) on every run. ' +
          'Clarity Phase 8 — description/meet_url/location/attendees are optional+nullable; ' +
          'ABSENT is treated identically to null and WRITES BACK NULL on update (both create ' +
          'and update branches set all four), so a description or Meet link removed in Google ' +
          'actually disappears from the glass on the next sync pass. attendees is ' +
          '[{email, display_name, response_status, organizer, self}] — response_status is ' +
          'Google\'s raw value, never translated server-side.',
        bodySchema: [
          { name: 'window_start', type: 'ISO-8601', required: true, description: '' },
          { name: 'window_end', type: 'ISO-8601', required: true, description: 'Must be at or after window_start' },
          {
            name: 'events',
            type: 'object',
            required: true,
            description: 'Array (max 500): { event_id (Google event id, unique), title, starts_at, ends_at, all_day? (default false), description?, meet_url?, location?, attendees? }',
          },
        ],
        responseExample: {
          success: true,
          window_start: 'ISO-8601',
          window_end: 'ISO-8601',
          upserted: 'number',
          pruned: 'number',
        },
      },
    ],
  },
  {
    path: '/api/oracle/email-sync',
    group: 'oracle',
    methods: [
      {
        method: 'POST',
        summary:
          'Clarity Phase 4a: batch upsert email asks into email_asks — the source for the Seeing Stone\'s crisis strip and intake drawer. Same Bearer-auth util as /api/session-tasks and /api/oracle/calendar-sync.',
        auth: 'required',
        responseNotes:
          'Called by the staged, not-cron-wired classifier ' +
          '(~/.claude/tools/oracle/clarity/email-classifier.py) for BOTH mailboxes on every ' +
          '15-min pass. Upserts each ask by message_id (create-or-update, never duplicates). ' +
          'On an ask that IS urgent AND either did not exist before this call, or existed but ' +
          'was not previously urgent, creates a Notification (type oracle_urgent_email) for ' +
          'the primary operator (same email-lookup default as /api/session-tasks\' assignee) — ' +
          'a re-sync of an already-urgent ask never re-notifies. Clarity Phase 6: intent and ' +
          'proposed_event_* are optional and independently absent-safe — a legacy payload ' +
          'that never sends them leaves those columns untouched on an update (byte-compatible ' +
          'with pre-Phase-6 classifier payloads), never nulled out. Clarity Phase 6b: intent ' +
          'additionally accepts "admin" for business-critical non-client mail ' +
          '(accountant/bookkeeper/banking/tax) — same absent-safe rule applies.',
        bodySchema: [
          {
            name: 'asks',
            type: 'object',
            required: true,
            description:
              'Array (1-200): { message_id (unique), thread_id?, account, from_name?, from_email, subject, gist? (never set for personal mail — personal is never posted at all), queue? (decide|answer|review|do), severity? (client_blocking|launch_blocking|internal), is_urgent? (default false), deep_link, received_at, intent? (general|meeting|sales|admin — Clarity Phase 6/6b, absent=untouched; admin = business-critical non-client mail: accountant/bookkeeper/banking/tax), proposed_event_at? (ISO-8601, absent=untouched — HIGH-CONFIDENCE parsed meeting time only, never guessed), proposed_event_title? (absent=untouched), proposed_event_minutes? (positive int, absent=untouched) }',
          },
        ],
        responseExample: {
          success: true,
          upserted: 'number',
          created: 'number',
          updated: 'number',
          notified_urgent: 'number',
        },
      },
    ],
  },
  {
    path: '/api/oracle/fleet',
    group: 'oracle',
    methods: [
      {
        method: 'GET',
        summary: 'Admin-only: full fleet snapshot for the Oracle visualizer, shaped for one call.',
        auth: 'required',
        roles: ['admin'],
        responseNotes:
          'Sessions are running|waiting|idle|stale always, plus ended sessions from the last 24h. Machine ' +
          '`stale` is derived at read time (last_heartbeat_at gap > 3 minutes), never a stored status. ' +
          '1.5a: admin-only (was pm-or-admin) — the oracle service bot is unaffected since ingest ' +
          'authorizes via isOracleBot, not role. `commands` (1.5b) is each machine\'s last 24h of ' +
          'spawn_session commands, newest first, capped at 20. Clarity Phase 1: sessions with ' +
          'archived_at set are excluded from the default response entirely; ?include_archived=true ' +
          'restores them. Each session also now carries session_type/goal/waiting_on/ask_queue/' +
          'ask_severity/arc_id/archived_at.',
        queryParams: [
          { name: 'include_archived', type: 'boolean', required: false, description: 'When true, restores sessions with archived_at set (excluded by default)' },
        ],
        responseExample: {
          machines: [
            {
              id: 'uuid',
              name: 'string',
              hostname: 'string|null',
              last_heartbeat_at: 'ISO-8601|null',
              stale: 'boolean',
              sessions: [
                {
                  id: 'uuid',
                  external_id: 'string',
                  source: 'claude_code|workflow|openclaw_cron',
                  title: 'string|null',
                  cwd: 'string|null',
                  model: 'string|null',
                  remote_url: 'string|null',
                  status: 'running|waiting|idle|ended|stale',
                  needs_attention: 'boolean',
                  attention_reason: 'string|null',
                  started_at: 'ISO-8601|null',
                  last_event_at: 'ISO-8601|null',
                  ended_at: 'ISO-8601|null',
                  tokens_total: 'number',
                  session_type: 'client_work|internal|systems|exploratory|null',
                  goal: 'string|null',
                  waiting_on: 'string|null',
                  ask_queue: 'decide|answer|review|do|null',
                  ask_severity: 'client_blocking|launch_blocking|internal|null',
                  arc_id: 'uuid|null',
                  archived_at: 'ISO-8601|null',
                  agents: [
                    {
                      id: 'uuid',
                      external_id: 'string',
                      label: 'string',
                      phase: 'string|null',
                      model: 'string|null',
                      status: 'string',
                      activity: 'string|null',
                      tokens: 'number',
                      duration_ms: 'number|null',
                      started_at: 'ISO-8601|null',
                      ended_at: 'ISO-8601|null',
                    },
                  ],
                },
              ],
              commands: [
                {
                  id: 'uuid',
                  verb: 'spawn_session',
                  status: 'pending|claimed|done|failed',
                  title: 'string|null',
                  cwd: 'string|null',
                  created_at: 'ISO-8601',
                  completed_at: 'ISO-8601|null',
                  result: 'object|null',
                  error: 'string|null',
                },
              ],
            },
          ],
          counts: { machines: 'number', sessions: 'number', agents: 'number' },
          generated_at: 'ISO-8601',
        },
      },
    ],
  },
  {
    path: '/api/oracle/commands',
    group: 'oracle',
    methods: [
      {
        method: 'POST',
        summary: 'Admin-only: queue a Remote Spawn command (1.5b) — starts a new Claude Code session on the target machine.',
        auth: 'required',
        roles: ['admin'],
        responseNotes:
          'Verb is hard-allowlisted to spawn_session via a Zod literal — no other verb can ever be ' +
          'created here. `machine` must match an existing OracleMachine.name (404 if not found). The ' +
          'local dispatcher (bot auth, polling this machine\'s queue via GET) claims and executes it, ' +
          'always via argv-array subprocess calls, never shell interpolation. Full audit: created_by ' +
          'is the calling admin; an OracleEvent (kind=command_executed) is written when the dispatcher ' +
          'reports completion via PATCH.',
        bodySchema: [
          { name: 'machine', type: 'string', required: true, description: 'OracleMachine.name to target' },
          { name: 'verb', type: 'string', required: true, description: "Must be the literal 'spawn_session' — any other value is rejected (400)" },
          { name: 'payload', type: 'object', required: true, description: '{ cwd (1-1024 chars), prompt? (<=10KB), title? (<=256 chars) }' },
        ],
        responseExample: {
          id: 'uuid',
          machine: 'string',
          verb: 'spawn_session',
          payload: { cwd: 'string', prompt: 'string|undefined', title: 'string|undefined' },
          status: 'pending',
          created_by_id: 'uuid',
          claimed_at: null,
          completed_at: null,
          result: null,
          error: null,
          created_at: 'ISO-8601',
        },
      },
      {
        method: 'GET',
        summary: 'Machine client only: poll pending commands queued for this machine.',
        auth: 'required',
        responseNotes:
          'Bearer API key for the oracle@indelible.bot service user ONLY — any other caller gets 403. ' +
          '`machine` query param is required (a machine only ever reads its own queue; there is no ' +
          '"all machines" mode). `status` defaults to `pending`. Commands are scoped to the named ' +
          'machine and returned oldest first so the dispatcher processes them in order.',
        queryParams: [
          { name: 'machine', type: 'string', required: true, description: 'OracleMachine.name — scopes the query to this machine only' },
          { name: 'status', type: 'string', required: false, description: 'pending|claimed|done|failed — defaults to pending' },
        ],
        responseExample: {
          commands: [
            {
              id: 'uuid',
              verb: 'spawn_session',
              payload: { cwd: 'string', prompt: 'string|undefined', title: 'string|undefined' },
              status: 'pending',
              created_at: 'ISO-8601',
              claimed_at: null,
              completed_at: null,
              result: null,
              error: null,
            },
          ],
        },
      },
    ],
  },
  {
    path: '/api/oracle/commands/{id}',
    group: 'oracle',
    methods: [
      {
        method: 'PATCH',
        summary: 'Machine client only: atomically claim a pending command, or report completion of a claimed one.',
        auth: 'required',
        responseNotes:
          'Bearer API key for the oracle@indelible.bot service user ONLY — any other caller gets 403. ' +
          "action=claim is ATOMIC (updateMany where status=pending -> claimed); if another caller " +
          "already claimed it, count is 0 and this returns 409 — exactly one claimant ever wins. " +
          "action=complete requires status to currently be claimed (also atomic; 409 if not) and sets " +
          "status to done|failed + completed_at + result?/error?. On complete, writes an OracleEvent " +
          "(kind=command_executed, machine-scoped) carrying only { command_id, verb, status, result } " +
          "for the audit trail — never the prompt or cwd.",
        bodySchema: [
          { name: 'action', type: 'string', required: true, description: "'claim' or 'complete'" },
          { name: 'status', type: 'string', required: false, description: "complete only: 'done' or 'failed'" },
          { name: 'result', type: 'object', required: false, description: 'complete only: e.g. { tmux_session, remote_control }, capped at 8KB' },
          { name: 'error', type: 'string', required: false, description: 'complete only: error message, max 2000 chars' },
        ],
        responseExample: {
          id: 'uuid',
          machine_id: 'uuid',
          verb: 'spawn_session',
          payload: { cwd: 'string' },
          status: 'claimed|done|failed',
          claimed_at: 'ISO-8601|null',
          completed_at: 'ISO-8601|null',
          result: 'object|null',
          error: 'string|null',
          created_at: 'ISO-8601',
          updated_at: 'ISO-8601',
        },
      },
    ],
  },
  {
    path: '/api/oracle/admin-soon',
    group: 'oracle',
    methods: [
      {
        method: 'GET',
        summary: "Clarity Phase 8 (composition) — Process mode's admin-soon stage: the weekly ~45-60 min batch's third deal (after intake, after review).",
        auth: 'required',
        roles: ['admin'],
        responseNotes:
          '"Admin-soon" is a PRAGMATIC, documented filter (not a new task field) — a task qualifies via ' +
          'ANY of: (a) explicit — tagged "kind:admin" (always wins); (b) small internal bite — no client, ' +
          'no project, energy_estimate <= 3, and mystery_factor != no_idea (the SMALL-BITE HONESTY LAW: a ' +
          'task the system cannot honestly size is never offered inside a timeboxed chunk); (c) admin-lane ' +
          'provenance — referenced by an EmailAsk with intent=admin. All three additionally pass the same ' +
          'plate rule /api/waiting-on-me uses (a task under a quote/queue-status project contributes zero). ' +
          'Ordered due_date asc (nulls last), then priority asc, then created_at asc; capped at 20.',
        responseExample: {
          tasks: [
            {
              id: 'uuid', title: 'string', status: 'string', priority: 'number',
              due_date: 'ISO-8601|null', promised_to: 'string|null',
              client: { id: 'uuid', name: 'string' }, source_intent: 'admin|null',
            },
          ],
          meta: { total: 'number', cap: 20 },
        },
      },
    ],
  },
  {
    path: '/api/oracle/projects',
    group: 'oracle',
    methods: [
      {
        method: 'GET',
        summary:
          'Oracle Projects Tab Phase 2 — the 4th Oracle mode\'s signals feed: every in-progress contracted project with its blockers, owner, movement, and hybrid next-step line.',
        auth: 'required',
        roles: ['pm', 'admin'],
        queryParams: [
          {
            name: 'lens',
            type: 'string',
            required: false,
            description: 'lens=kind adds `by_kind`: the same blockers grouped by kind across every project, instead of per-project.',
          },
        ],
        responseNotes:
          'Loads projects with type=project, status=in_progress, is_deleted=false. Each blocker kind ' +
          '(decision, clarification, review, session_ask, mention, client_email, client_approval, ' +
          'someone_else, stale, meeting_risk) is classified by lib/oracle/projects/blockers.ts; a ' +
          'project is "stalled on Mike" when ANY of its non-dismissed blockers is owned by Mike. ' +
          'Projects sort stalled-on-Mike first, then by days_quiet descending. ' +
          'Judgment calls: EmailAsk.replied is state !== \'open\' only (this schema tracks no outbound ' +
          'reply record); a calendar event links to a client by attendee-email match against that ' +
          'client\'s ClientContact rows (CalendarEvent has no first-class client relation) and, if ' +
          'matched, is attached only to a client\'s SOLE in-progress project (ambiguous with 0 or 2+ ' +
          'never guesses). A session ask (Needs Reshi) surfaces here ONLY when its OracleSession ' +
          'declared an arc — OracleSession has no client/project column of its own, so an arc-less ' +
          'ask can never be attributed to a project and stays visible only in /api/waiting-on-me. ' +
          'The mention scan and the movement comment feed both share the SAME 90-day lookback window ' +
          '(comments older than 90 days never produce a mention blocker and are never read for ' +
          'movement either) — this is a fixed window, not configurable per project.',
        responseExample: {
          projects: [
            {
              id: 'uuid',
              name: 'string',
              client: { id: 'uuid', name: 'string' },
              status: 'in_progress',
              next_step: {
                text: 'string',
                owner: { id: 'uuid', name: 'string' },
                owner_label: 'string|null',
                source: 'graph|bast|mike|none',
                at: 'ISO-8601|null',
              },
              last_movement: { at: 'ISO-8601', who: 'string', what: 'string' },
              days_quiet: 'number|null',
              stale: 'boolean',
              stalled_on_mike: 'boolean',
              blockers: [
                {
                  kind: 'decision|clarification|review|session_ask|mention|client_email|client_approval|someone_else|stale|meeting_risk',
                  id: 'string',
                  title: 'string',
                  detail: 'string',
                  owner: { id: 'string', name: 'string', is_mike: 'boolean' },
                  source: { type: 'string', id: 'string', url: 'string' },
                  since: 'ISO-8601',
                  actions: ['reply'],
                },
              ],
              counts_by_kind: { review: 1 },
              refresh_requested_at: 'ISO-8601|null',
              open_url: '/projects/uuid',
            },
          ],
          stalled_count: 'number',
          generated_at: 'ISO-8601',
        },
      },
    ],
  },
  {
    path: '/api/oracle/projects/{id}/next-step',
    group: 'oracle',
    methods: [
      {
        method: 'PATCH',
        summary: "Oracle Projects Tab Phase 3 — Mike's manual next-step override (sticky until changed or cleared).",
        auth: 'required',
        roles: ['pm', 'admin'],
        responseNotes:
          'Sets next_step_source=mike, which wins over both the nightly/on-demand Bast line and the live ' +
          'task-graph candidate (see mergeNextStep). owner_id and owner_label are mutually exclusive; ' +
          'a PATCH always sets both owner fields, clearing whichever one was not sent.',
        bodySchema: [
          { name: 'text', type: 'string', required: true, description: '1-500 chars' },
          { name: 'owner_id', type: 'uuid', required: false, description: 'A User. Mutually exclusive with owner_label.' },
          { name: 'owner_label', type: 'string', required: false, description: 'Free text for a non-User owner, e.g. "Andy (client)". 1-255 chars.' },
        ],
        responseExample: {
          next_step: { text: 'string', owner: { id: 'uuid', name: 'string' }, owner_label: 'string|null', source: 'mike', at: 'ISO-8601' },
        },
      },
      {
        method: 'DELETE',
        summary: "Clears Mike's next-step override — source reverts to null so the next bast refresh or the live graph candidate applies again.",
        auth: 'required',
        roles: ['pm', 'admin'],
        responseNotes: 'Does not itself trigger a refresh; pair with POST .../refresh for an immediate fresh line.',
        responseExample: { success: true },
      },
    ],
  },
  {
    path: '/api/oracle/projects/{id}/next-step/write',
    group: 'oracle',
    methods: [
      {
        method: 'PUT',
        summary: 'Machine-side job only (next-step-refresh.py): writes a freshly-inferred next-step line and/or email summary.',
        auth: 'required',
        responseNotes:
          "Bearer, any authenticated user — not role-gated (this is a machine endpoint). Mike's override " +
          "always wins: if the project's CURRENT next_step_source is 'mike', next_step_text/owner/source/at " +
          'are left untouched, but email_summary is still written (`applied: false` in the response signals ' +
          'this). Either way, next_step_refresh_requested_at is cleared. next_step_text and email_summary are ' +
          'both linted server-side against the writing-standard comment-gate patterns ' +
          '(lib/oracle/projects/next-step-lint.ts) — a violation on either field 422s with no write at all.',
        bodySchema: [
          { name: 'text', type: 'string', required: true, description: '1-500 chars' },
          { name: 'owner_id', type: 'uuid', required: false, description: 'Mutually exclusive with owner_label' },
          { name: 'owner_label', type: 'string', required: false, description: 'Mutually exclusive with owner_id' },
          { name: 'email_summary', type: 'string', required: false, description: 'Up to 2000 chars, or null/absent when there are no linked emails' },
          { name: 'source', type: 'string', required: true, description: "Must be the literal 'bast'" },
          { name: 'generated_at', type: 'ISO-8601', required: true, description: '' },
          { name: 'model', type: 'string', required: true, description: 'e.g. "sonnet" — recorded in the activity log' },
          { name: 'cost_usd', type: 'number', required: false, description: '' },
        ],
        responseExample: {
          applied: 'boolean',
          next_step: { text: 'string', owner: { id: 'uuid', name: 'string' }, owner_label: 'string|null', source: 'bast', at: 'ISO-8601' },
          email_summary: 'string|null',
        },
      },
    ],
  },
  {
    path: '/api/oracle/projects/{id}/refresh',
    group: 'oracle',
    methods: [
      {
        method: 'POST',
        summary: 'Queues an on-demand next-step refresh for one project.',
        auth: 'required',
        roles: ['pm', 'admin'],
        responseNotes:
          'Stamps next_step_refresh_requested_at; the machine-side job\'s --requested poll (every 2 minutes ' +
          'during business hours) picks it up and clears the stamp via PUT .../next-step/write. 202 means ' +
          'queued, not done.',
        responseExample: { requested_at: 'ISO-8601' },
      },
    ],
  },
  {
    path: '/api/oracle/projects/refresh',
    group: 'oracle',
    methods: [
      {
        method: 'POST',
        summary: 'Queues an on-demand next-step refresh for EVERY in-progress, type=project project at once.',
        auth: 'required',
        roles: ['pm', 'admin'],
        responseExample: { requested_at: 'ISO-8601', count: 'number' },
      },
    ],
  },
  {
    path: '/api/oracle/projects/refresh-requests',
    group: 'oracle',
    methods: [
      {
        method: 'GET',
        summary: "Machine-side job only: projects with a queued on-demand refresh, oldest first.",
        auth: 'required',
        responseNotes: 'Bearer, any authenticated user — a cheap GET, not a Mike-only action.',
        responseExample: {
          ids: ['uuid'],
          requests: [{ id: 'uuid', requested_at: 'ISO-8601' }],
        },
      },
    ],
  },
];
