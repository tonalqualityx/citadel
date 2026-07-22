import type { ApiEndpoint } from './index';

// Clarity Phase 1 — arcs, ideas, session-tasks, waiting-on-me. Schema + API only in this
// phase: sessions can declare meaning, DO-work parked on Mike becomes a real Task tied
// back to its session, related tasks group into lightweight "arcs", ideas have a
// first-class home, and one endpoint merges everything waiting on Mike. Producers
// (hooks/heartbeat) and the Oracle UI are Phase 2/3.
export const clarityEndpoints: ApiEndpoint[] = [
  {
    path: '/api/arcs',
    group: 'clarity',
    methods: [
      {
        method: 'GET',
        summary: 'List arcs (lightweight micro-project groupings) with derived status and task counts.',
        auth: 'required',
        queryParams: [
          { name: 'status', type: 'string', required: false, description: 'Filter on the DERIVED status: empty | open | complete (never stored — see lib/arc-status.ts)' },
          { name: 'client_id', type: 'uuid', required: false, description: 'Filter by attached client' },
          { name: 'project_id', type: 'uuid', required: false, description: 'Filter by attached project (commission)' },
        ],
        responseExample: {
          arcs: [
            {
              id: 'uuid',
              name: 'string',
              description: 'string|null',
              status: 'empty|open|complete',
              client_id: 'uuid|null',
              client: { id: 'uuid', name: 'string' },
              project_id: 'uuid|null',
              project: { id: 'uuid', name: 'string', status: 'string' },
              origin_session_external_id: 'string|null',
              closed_at: 'ISO-8601|null',
              task_count: 'number',
              created_at: 'ISO-8601',
              updated_at: 'ISO-8601',
            },
          ],
          total: 'number',
        },
      },
      {
        method: 'POST',
        summary: 'Create an arc.',
        auth: 'required',
        bodySchema: [
          { name: 'name', type: 'string', required: true, description: 'Max 300 chars' },
          { name: 'description', type: 'string', required: false, description: '' },
          { name: 'client_id', type: 'uuid', required: false, description: '"Attach arc to a commission" — tasks never re-parent through it' },
          { name: 'project_id', type: 'uuid', required: false, description: '' },
        ],
      },
    ],
  },
  {
    path: '/api/arcs/{id}',
    group: 'clarity',
    methods: [
      {
        method: 'GET',
        summary: 'Arc detail with its tasks and derived status.',
        auth: 'required',
      },
      {
        method: 'PATCH',
        summary: 'Update an arc. Setting closed_at is the "close thread" action; passing closed_at: null reopens it; omitting it leaves it untouched.',
        auth: 'required',
        bodySchema: [
          { name: 'name', type: 'string', required: false, description: '' },
          { name: 'description', type: 'string', required: false, description: '' },
          { name: 'client_id', type: 'uuid', required: false, description: '' },
          { name: 'project_id', type: 'uuid', required: false, description: '' },
          { name: 'closed_at', type: 'ISO-8601', required: false, description: 'Set to close the thread; null to reopen; absent to leave untouched' },
        ],
      },
    ],
  },
  {
    path: '/api/ideas',
    group: 'clarity',
    methods: [
      {
        method: 'GET',
        summary: 'List ideas (a first-class home for ideas surfaced during a session, by Oracle, or via email).',
        auth: 'required',
        queryParams: [
          { name: 'status', type: 'string', required: false, description: 'open|kept|promoted|discarded — defaults to open' },
        ],
        responseExample: {
          ideas: [
            {
              id: 'uuid',
              text: 'string',
              source: 'session|oracle|email',
              source_ref: 'string|null',
              status: 'open|kept|promoted|discarded',
              promoted_task_id: 'uuid|null',
              promoted_task: { id: 'uuid', title: 'string' },
              created_by_id: 'uuid|null',
              created_at: 'ISO-8601',
              updated_at: 'ISO-8601',
            },
          ],
          total: 'number',
        },
      },
      {
        method: 'POST',
        summary: 'Create an idea.',
        auth: 'required',
        bodySchema: [
          { name: 'text', type: 'string', required: true, description: '' },
          { name: 'source', type: 'string', required: true, description: 'session|oracle|email' },
          { name: 'source_ref', type: 'string', required: false, description: 'session external_id / email message id / etc.' },
          { name: 'created_by_id', type: 'uuid', required: false, description: '' },
        ],
      },
    ],
  },
  {
    path: '/api/ideas/{id}',
    group: 'clarity',
    methods: [
      {
        method: 'GET',
        summary: 'Idea detail.',
        auth: 'required',
      },
      {
        method: 'PATCH',
        summary: 'Update an idea — change status, edit text, or promote it to an existing task.',
        auth: 'required',
        bodySchema: [
          { name: 'status', type: 'string', required: false, description: 'open|kept|promoted|discarded' },
          { name: 'text', type: 'string', required: false, description: '' },
          { name: 'promoted_task_id', type: 'uuid', required: false, description: 'Must reference an existing task (404 if not)' },
        ],
      },
    ],
  },
  {
    path: '/api/session-tasks',
    group: 'clarity',
    methods: [
      {
        method: 'POST',
        summary: 'The quest-from-session endpoint: a Claude Code session parks a real Task on Mike, tied back to the session that spawned it. Same Bearer-auth util as the rest of the API (cookie session OR API key) — no bot-only restriction.',
        auth: 'required',
        responseNotes:
          'Dedup: if an existing task has source=session, the same session_external_id, status ' +
          'in (not_started, in_progress), and a case/whitespace-insensitive title match, this ' +
          'UPDATEs that task\'s description/updated_at and returns it with deduped: true — never ' +
          'creates a duplicate. Arc resolution: arc_id used as-is (404 if missing); arc_name ' +
          'reuses an exact-name arc whose derived status is not complete, else creates a new one ' +
          'attributed to the calling session. Assignee: explicit assignee_id wins, else defaults to ' +
          'the primary operator resolved by email at request time (500 if that user is missing or ' +
          'inactive). Priority derives from severity: ' +
          'client_blocking→1, launch_blocking→2, internal→3, absent→3. needs_review is always false.',
        bodySchema: [
          { name: 'session_external_id', type: 'string', required: true, description: 'Max 255 chars' },
          { name: 'title', type: 'string', required: true, description: 'Max 500 chars' },
          { name: 'description', type: 'object', required: false, description: 'Markdown / plain string / BlockNote array' },
          { name: 'arc_id', type: 'uuid', required: false, description: 'XOR with arc_name — 400 if both given' },
          { name: 'arc_name', type: 'string', required: false, description: 'XOR with arc_id' },
          { name: 'client_id', type: 'uuid', required: false, description: '' },
          { name: 'severity', type: 'string', required: false, description: 'client_blocking|launch_blocking|internal' },
          { name: 'assignee_id', type: 'uuid', required: false, description: 'Defaults to the primary operator (email lookup) if absent' },
          { name: 'due_date', type: 'ISO-8601', required: false, description: '' },
        ],
        responseExample: {
          id: 'uuid',
          title: 'string',
          status: 'not_started',
          priority: 'number',
          source: 'session',
          source_session_external_id: 'string',
          arc_id: 'uuid|null',
          arc: { id: 'uuid', name: 'string' },
          deduped: 'boolean',
        },
      },
    ],
  },
  {
    path: '/api/waiting-on-me',
    group: 'clarity',
    methods: [
      {
        method: 'GET',
        summary: 'Merged "everything waiting on Mike" feed: a 5-query task sweep (focus, overdue, awaiting-review, blocked, open-within-14d) plus live Oracle sessions with a waiting_on ask parked.',
        auth: 'required',
        queryParams: [
          { name: 'user_id', type: 'uuid', required: false, description: 'Tech users self-only (403 on mismatch); PM/Admin any user, defaults to self' },
        ],
        responseNotes:
          'Cross-query dedup: a task already emitted by an earlier query in the fixed order ' +
          '(focus > overdue > awaiting-review > blocked > open-within-14d) never appears twice. ' +
          'Task-sweep results route to `do`, EXCEPT awaiting-review, which routes to `review` ' +
          '(reviewer_id-scoped, not assignee-scoped). Session asks route by their own ask_queue ' +
          '(decide|answer|review|do); a session with no ask_queue set falls back to `do`. Session ' +
          'asks are not scoped by user_id — Oracle sessions have no per-Citadel-user ownership in ' +
          'this phase; the endpoint is the single merged view of everything waiting on Mike.',
        responseExample: {
          decide: [
            {
              type: 'task|session_ask',
              id: 'uuid',
              title: 'string',
              status: 'string',
              priority: 'number|null',
              severity: 'client_blocking|launch_blocking|internal|null',
              task_id: 'uuid|null',
              session_external_id: 'string|null',
              arc: { id: 'uuid', name: 'string' },
              due_date: 'ISO-8601|null',
            },
          ],
          answer: [],
          review: [],
          do: [],
          meta: { counts: { decide: 'number', answer: 'number', review: 'number', do: 'number', total: 'number' } },
        },
      },
    ],
  },
  {
    path: '/api/today',
    group: 'clarity',
    methods: [
      {
        method: 'GET',
        summary: 'List Today picks (the day\'s chosen commitments) with joined arc/task/session/charter summaries and a derived per-type primary action.',
        auth: 'required',
        roles: ['admin'],
        queryParams: [
          { name: 'date', type: 'string', required: false, description: 'YYYY-MM-DD in the requester\'s resolved timezone. Defaults to today in that zone.' },
        ],
        responseNotes:
          'Clarity Phase 3d: "today"/date resolves to the REQUESTING USER\'s own timezone ' +
          '(UserPreference.timezone -> CITADEL_DISPLAY_TZ env -> America/New_York — see ' +
          'lib/services/user-timezone.ts), not a plain UTC calendar day. `timezone` in the ' +
          'response is that resolved zone; the client formats every rendered time in it.',
        responseExample: {
          date: 'YYYY-MM-DD',
          timezone: 'America/New_York',
          picks: [
            {
              id: 'uuid',
              date: 'ISO-8601',
              item_type: 'arc|task|session|lead|note',
              arc_id: 'uuid|null',
              arc: { id: 'uuid', name: 'string', status: 'empty|open|complete', task_count: 'number' },
              task_id: 'uuid|null',
              task: { id: 'uuid', title: 'string', status: 'string' },
              session_external_id: 'string|null',
              session: { external_id: 'string', title: 'string|null', status: 'string', remote_url: 'string|null', goal: 'string|null' },
              charter_id: 'uuid|null',
              charter: { id: 'uuid', name: 'string' },
              label: 'string|null',
              sort: 'number',
              completed_at: 'ISO-8601|null',
              primary_action: { kind: 'respond|resume|arc|quest|charter|toggle' },
              created_at: 'ISO-8601',
              updated_at: 'ISO-8601',
            },
          ],
          meta: { total: 'number', uncompleted: 'number', cap: 5 },
        },
      },
      {
        method: 'POST',
        summary: 'Add a Today pick. Exactly one of arc_id/task_id/session_external_id/charter_id (or `label` for a note) identifies the pick — validated here, not the DB.',
        auth: 'required',
        roles: ['admin'],
        responseNotes:
          'WIP ceiling: a 6th uncompleted pick for the date is rejected with 409 (finish or drop one first). ' +
          'Exactly-one-ref validation returns 400. arc_id/task_id/charter_id are 404-checked against their tables; ' +
          'session_external_id is not (Oracle sessions are not a DB relation here).',
        bodySchema: [
          { name: 'date', type: 'string', required: false, description: 'YYYY-MM-DD; defaults to today in the requester\'s resolved timezone (see GET\'s responseNotes)' },
          { name: 'item_type', type: 'string', required: true, description: 'arc|task|session|lead|note' },
          { name: 'arc_id', type: 'uuid', required: false, description: 'Required (and only) for item_type=arc' },
          { name: 'task_id', type: 'uuid', required: false, description: 'Required (and only) for item_type=task' },
          { name: 'session_external_id', type: 'string', required: false, description: 'Required (and only) for item_type=session' },
          { name: 'charter_id', type: 'uuid', required: false, description: 'Required (and only) for item_type=lead' },
          { name: 'label', type: 'string', required: false, description: 'Required (and only) for item_type=note; an override display string on other types' },
          { name: 'sort', type: 'number', required: false, description: '' },
        ],
      },
    ],
  },
  {
    path: '/api/today/{id}',
    group: 'clarity',
    methods: [
      {
        method: 'PATCH',
        summary: 'Update a Today pick: sort, completed_at (quiet completion toggle), or label. The pick\'s type/ref is never re-pointed here.',
        auth: 'required',
        roles: ['admin'],
        bodySchema: [
          { name: 'sort', type: 'number', required: false, description: '' },
          { name: 'completed_at', type: 'ISO-8601', required: false, description: 'Set to complete; null to un-complete; absent to leave untouched' },
          { name: 'label', type: 'string', required: false, description: '' },
        ],
      },
      {
        method: 'DELETE',
        summary: 'Remove a Today pick. This removes only the pick row — never the underlying arc/task/session/charter.',
        auth: 'required',
        roles: ['admin'],
        responseExample: { success: true },
      },
    ],
  },
  {
    path: '/api/today/calendar',
    group: 'clarity',
    methods: [
      {
        method: 'GET',
        summary: 'Day timed calendar events (title/REAL start/end) for the time-shape track, plus a 5-day week aggregation (committed-load minutes/count + due-task counts per day) for the week capacity strip.',
        auth: 'required',
        roles: ['admin'],
        queryParams: [
          { name: 'date', type: 'string', required: false, description: 'YYYY-MM-DD in the requester\'s resolved timezone. Defaults to today in that zone; the week strip runs this date + 4 forward days.' },
        ],
        responseNotes:
          'Clarity Phase 3b: reads the calendar_events table (synced via POST /api/oracle/calendar-sync ' +
          'from Mike\'s real Google Calendar) — real start/end durations, no more assumed duration. ' +
          'All-day events are excluded from `meetings` entirely and returned separately in `allDay`. ' +
          '`week[].meeting_minutes` is each day\'s real per-event duration PLUS a 15-minute recovery buffer ' +
          'trailing every timed meeting (truncated by a back-to-back next meeting — never double-counted; ' +
          'see MEETING_RECOVERY_MINUTES / sumCommittedMinutesWithBuffer in ' +
          'components/domain/oracle/today/time-shape-logic.ts, the single shared implementation). Response ' +
          'is deliberately "dumb" otherwise — fill-percent/packed-tint encoding is computed client-side so ' +
          'the day track, week strip, and future planning views share one capacity encoding implementation. ' +
          'Clarity Phase 3d: day windows (both the single day and the week) are computed in the REQUESTING ' +
          'USER\'s own resolved timezone (UserPreference.timezone -> CITADEL_DISPLAY_TZ env -> ' +
          'America/New_York — lib/services/user-timezone.ts), not UTC — an 8pm-ET event now correctly ' +
          'belongs to its ET calendar date even though the same instant is already tomorrow in UTC. ' +
          '`timezone` in the response is that resolved zone; the client renders the time-shape\'s display ' +
          'window and every clock/hour label in it, never a guess.',
        responseExample: {
          date: 'YYYY-MM-DD',
          timezone: 'America/New_York',
          meetings: [{ id: 'string', title: 'string', start: 'ISO-8601', end: 'ISO-8601' }],
          allDay: [{ id: 'string', title: 'string', start: 'ISO-8601', end: 'ISO-8601' }],
          week: [
            { date: 'YYYY-MM-DD', meeting_minutes: 'number', meetings_count: 'number', due_tasks_count: 'number' },
          ],
        },
      },
    ],
  },
];
