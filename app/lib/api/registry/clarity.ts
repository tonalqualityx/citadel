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
              snoozed_until: 'ISO-8601|null',
              estimate_override_minutes: 'number|null',
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
        summary:
          'Arc detail with its tasks and derived status. Clarity Phase 4c adds the arc board ' +
          'header enrichment: `sessions[]` (the arc\'s linked session(s), from ' +
          'origin_session_external_id + any arc_id-linked OracleSession rows, merged/deduped) ' +
          'and `estimated_minutes_total` (sum of the arc\'s OPEN tasks\' estimated_minutes; ' +
          'each task in `tasks[]` also carries its own `estimated_minutes`).',
        auth: 'required',
        responseExample: {
          id: 'uuid',
          name: 'string',
          status: 'empty|open|complete',
          estimate_override_minutes: 'number|null',
          estimated_minutes_total: 'number',
          sessions: [
            {
              id: 'uuid',
              external_id: 'string',
              title: 'string|null',
              status: 'running|waiting|idle|ended|stale',
              remote_url: 'string|null',
              needs_attention: 'boolean',
              last_event_at: 'ISO-8601|null',
            },
          ],
          tasks: [{ id: 'uuid', title: 'string', status: 'string', estimated_minutes: 'number|null' }],
        },
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
          { name: 'snoozed_until', type: 'ISO-8601', required: false, description: 'Clarity Phase 5 — the Soothsayer\'s snooze action. Set to hide the arc from default surfaces (Today\'s no-day-assigned guarantee, Soothsayer\'s unplanned section) until the date passes; null un-snoozes; absent leaves untouched' },
          { name: 'estimate_override_minutes', type: 'number', required: false, description: 'Clarity Phase 4c — arc board header time estimate override. Set to hand-pick a total that overrides the computed sum of open tasks\' estimated_minutes ("~2h (set by hand)"); null clears the override; absent leaves untouched' },
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
        summary: 'Merged "everything waiting on Mike" feed: a 5-query task sweep (focus, overdue, awaiting-review, blocked, open-within-14d) plus live Oracle sessions with a waiting_on ask parked, plus (Clarity Phase 4a) the crisis strip / intake drawer email surfaces.',
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
          'this phase; the endpoint is the single merged view of everything waiting on Mike. ' +
          'Clarity Phase 4a: `crisis` (open+urgent email_asks, newest first) and `intake` ' +
          '(open+non-urgent email_asks, count + newest_at + items, newest first) are their OWN ' +
          'surface — email asks never merge into decide/answer/review/do. ' +
          'Clarity Phase 5: `waiting` merges decide+answer into ONE queue the UI reads (each ' +
          'item tagged `queue_type`: decision for former-decide, reply for former-answer), ' +
          'decide first then answer — `decide`/`answer` stay in the response, unchanged, for ' +
          'API back-compat for one release. Every card also carries `client` (task cards only; ' +
          'session_ask cards are always null, fall back to arc/"Other" client-side for the ' +
          'Review column\'s grouping) and `waiting_since` (best-available "when this started ' +
          'waiting" proxy: a task\'s updated_at, a session\'s last_event_at). ' +
          'Clarity Phase 6: intake email asks carry `intent` (general|meeting|sales, null=' +
          'general) and the proposed_event_* trio (null=no parsed meeting time, no ' +
          'Add-to-calendar affordance); `intake` additionally carries `lanes` — per-lane ' +
          'counts (general/meeting/sales, null intent counted as general) backing the header ' +
          'trigger chip\'s three quiet counts.',
        responseExample: {
          waiting: [
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
              client: { id: 'uuid', name: 'string' },
              waiting_since: 'ISO-8601|null',
              due_date: 'ISO-8601|null',
              queue_type: 'decision|reply',
            },
          ],
          decide: [],
          answer: [],
          review: [],
          do: [],
          crisis: [
            {
              id: 'uuid',
              message_id: 'string',
              thread_id: 'string|null',
              account: 'string',
              from_name: 'string|null',
              from_email: 'string',
              subject: 'string',
              gist: 'string|null',
              queue: 'decide|answer|review|do|null',
              severity: 'client_blocking|launch_blocking|internal|null',
              is_urgent: true,
              state: 'open|handled|dismissed|archive_requested',
              training_note: 'string|null',
              intent: 'general|meeting|sales|null',
              proposed_event_at: 'ISO-8601|null',
              proposed_event_title: 'string|null',
              proposed_event_minutes: 'number|null',
              calendar_requested: 'boolean',
              calendar_event_id: 'string|null',
              task_id: 'uuid|null',
              deep_link: 'string',
              received_at: 'ISO-8601',
            },
          ],
          intake: {
            count: 'number',
            newest_at: 'ISO-8601|null',
            lanes: { general: 'number', meeting: 'number', sales: 'number' },
            items: [],
          },
          meta: {
            counts: {
              waiting: 'number',
              decide: 'number',
              answer: 'number',
              review: 'number',
              do: 'number',
              total: 'number',
            },
          },
        },
      },
    ],
  },
  {
    path: '/api/email-asks',
    group: 'clarity',
    methods: [
      {
        method: 'GET',
        summary:
          'Clarity Phase 4b: machine-side read for the (staged, not-cron-wired) classifier — ' +
          'fetch pending archive intents (state=archive_requested) to execute in Gmail on its ' +
          'next pass. Same Bearer-auth util as /api/oracle/email-sync (no role gate).',
        auth: 'required',
        queryParams: [
          { name: 'state', type: 'string', required: false, description: 'open|handled|dismissed|archive_requested' },
          { name: 'account', type: 'string', required: false, description: 'Filter to one mailbox, e.g. mike@becomeindelible.com' },
          { name: 'calendar_requested', type: 'string', required: false, description: 'Clarity Phase 6 — only "true" is accepted; the machine-side calendar executor\'s read for pending Add-to-calendar requests' },
        ],
        responseExample: {
          asks: [
            {
              id: 'uuid',
              message_id: 'string',
              account: 'string',
              subject: 'string',
              state: 'open|handled|dismissed|archive_requested',
              training_note: 'string|null',
              intent: 'general|meeting|sales|null',
              proposed_event_at: 'ISO-8601|null',
              proposed_event_title: 'string|null',
              proposed_event_minutes: 'number|null',
              calendar_requested: 'boolean',
              calendar_event_id: 'string|null',
              received_at: 'ISO-8601',
            },
          ],
          meta: { total: 'number' },
        },
      },
    ],
  },
  {
    path: '/api/email-asks/{id}',
    group: 'clarity',
    methods: [
      {
        method: 'PATCH',
        summary:
          'Clarity Phase 4a/4b/6: the crisis strip\'s "Handled" action, the intake drawer\'s ' +
          'Dismiss/Open/Archive/Add-to-calendar actions, Mike\'s calibration note on a ' +
          'classification, and (Phase 6 addendum) the machine-side calendar executor\'s ' +
          'completion write. Admin-only.',
        auth: 'required',
        roles: ['admin'],
        bodySchema: [
          { name: 'state', type: 'string', required: false, description: 'open|handled|dismissed|archive_requested — archive_requested drops the ask out of the intake drawer immediately; the classifier executes the real Gmail archive machine-side' },
          { name: 'task_id', type: 'uuid', required: false, description: '404-checked against tasks if given' },
          { name: 'training_note', type: 'string', required: false, description: 'Clarity Phase 4b — Mike\'s own correction/calibration note (max 2000 chars); the classifier consumes recent notes as calibration examples machine-side' },
          { name: 'calendar_requested', type: 'boolean', required: false, description: 'Clarity Phase 6 — the meeting-lane card\'s "Add to calendar" button; flips the button to "queued for calendar ⏳" immediately' },
          { name: 'calendar_event_id', type: 'string', required: false, description: 'Clarity Phase 6 addendum — the machine-side calendar executor\'s completion write (max 255 chars, nullable). Setting it (including explicitly to null) ATOMICALLY flips calendar_requested back to false in the same update, regardless of what else the request body sent — the only transition out of "requested". Renders as "added ✓" once set.' },
        ],
      },
    ],
  },
  {
    path: '/api/email-asks/{id}/create-task',
    group: 'clarity',
    methods: [
      {
        method: 'POST',
        summary: 'Clarity Phase 4a: the "Create" / "Create + open" backend — turns an email ask into a real Task. Admin-only.',
        auth: 'required',
        roles: ['admin'],
        responseNotes:
          'Idempotent: if the ask already has task_id set (and that task still exists), returns ' +
          'it as-is with 200 — never creates a second Task. Otherwise creates one: title is the ' +
          'subject with a leading Re:/Fwd: prefix stripped (repeated/case-insensitive); ' +
          'description is the gist + the deep link; source=email, source_ref=message_id, ' +
          'origin_url=deep_link; client_id matched by from_email\'s domain against every ' +
          'non-deleted Client.email domain (null if no match — never guessed); assignee ' +
          'defaults to the primary operator (same email-lookup helper as /api/session-tasks); ' +
          'priority derives from the ask\'s severity via the same client_blocking->1/' +
          'launch_blocking->2/internal->3 mapping session-tasks uses (lib/ask-severity.ts). ' +
          'arc_id/arc_name reuse the exact same shared resolution as session-tasks ' +
          '(lib/arc-resolution.ts). sop_id is a pure passthrough — no SOP-guessing logic exists ' +
          'yet (out of v1 scope). Sets email_ask.task_id + state=handled on success.',
        bodySchema: [
          { name: 'arc_id', type: 'uuid', required: false, description: 'XOR with arc_name — 400 if both given' },
          { name: 'arc_name', type: 'string', required: false, description: 'XOR with arc_id' },
          { name: 'sop_id', type: 'uuid', required: false, description: 'Passthrough only, no resolution logic' },
        ],
        responseExample: {
          id: 'uuid',
          title: 'string',
          status: 'not_started',
          priority: 'number',
          source: 'email',
          origin_url: 'string',
          client_id: 'uuid|null',
          arc_id: 'uuid|null',
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
          { name: 'days', type: 'number', required: false, description: 'Clarity Phase 5 — how many forward days the `week` aggregation covers (1-31). Defaults to 5 (the Today header\'s own week strip, unchanged); the Soothsayer requests 7.' },
        ],
        responseNotes:
          'Clarity Phase 3b: reads the calendar_events table (synced via POST /api/oracle/calendar-sync ' +
          'from Mike\'s real Google Calendar) — real start/end durations, no more assumed duration. ' +
          'All-day events are excluded from `meetings` entirely and returned separately in `allDay`. ' +
          '`week[].meeting_minutes` is each day\'s real per-event duration PLUS a 20-minute leading prep ' +
          'window and a 15-minute trailing recovery buffer around every timed meeting (Clarity Phase 5 — ' +
          'mutually truncated against neighboring meetings, clamped to the day start, never double-counted; ' +
          'see MEETING_PREP_MINUTES/MEETING_RECOVERY_MINUTES / sumCommittedMinutesWithBuffer in ' +
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
  {
    path: '/api/today/due-soon',
    group: 'clarity',
    methods: [
      {
        method: 'GET',
        summary: 'Clarity Phase 4a: the due-soon row at the foot of Today — the requester\'s own tasks due within a rolling 24h window that are NOT already picked for today.',
        auth: 'required',
        roles: ['admin'],
        queryParams: [
          { name: 'date', type: 'string', required: false, description: 'YYYY-MM-DD in the requester\'s resolved timezone; only used to determine which today_picks to exclude against. Defaults to today in that zone.' },
        ],
        responseNotes:
          'The 24h window is REAL rolling time from the request instant (now to now+24h), ' +
          'never a calendar-day cutoff — immune to the UTC-vs-zoned-date bug class that hit ' +
          'the Phase 3 seed fixtures while baselining this phase (see lib/email-asks.ts\'s ' +
          'isDueSoon). Scoped to status not in (done, abandoned), assignee_id = requester, and ' +
          'excludes any task_id already present in that date\'s today_picks (item_type=task). ' +
          'Adding one to Today uses the existing POST /api/today (item_type=task, task_id) — no ' +
          'separate endpoint for that action.',
        responseExample: {
          date: 'YYYY-MM-DD',
          timezone: 'America/New_York',
          tasks: [
            { id: 'uuid', title: 'string', status: 'string', priority: 'number', due_date: 'ISO-8601' },
          ],
          meta: { total: 'number' },
        },
      },
    ],
  },
  {
    path: '/api/oracle/soothsayer',
    group: 'clarity',
    methods: [
      {
        method: 'GET',
        summary:
          'Clarity Phase 5 — The Soothsayer: the week-plan visualization. One consolidated, ' +
          'read-only aggregation (today + next 6 days\' picks, the can-never-lose-an-arc ' +
          '"no day assigned" list, and the collapsed "snoozed" row) over the SAME today_picks ' +
          'rows /api/today already reads/writes — no new planning model. Admin-only, same gate ' +
          'as /api/today.',
        auth: 'required',
        roles: ['admin'],
        queryParams: [
          { name: 'date', type: 'string', required: false, description: 'YYYY-MM-DD in the requester\'s resolved timezone — the window\'s anchor ("today") day. Defaults to today in that zone; the window always runs this date + 6 forward days (7 total).' },
        ],
        responseNotes:
          '`days[].picks` uses the exact same per-type-joined shape as GET /api/today\'s own ' +
          '`picks` (shared via lib/services/today-picks-shape.ts so the two never drift), with ' +
          'arc summaries additionally carrying `progress_percent` (the day columns render ' +
          '"arc name + progress"). `days[].meeting_count`/`meeting_minutes` fold in the 20-minute ' +
          'prep + 15-minute recovery buffer around every timed meeting, same shared ' +
          'sumCommittedMinutesWithBuffer implementation as /api/today/calendar. ' +
          '`unplanned.arcs` = every OPEN, un-snoozed arc with no arc-type pick dated today-or-' +
          'later; `unplanned.sessions` = every LIVE (not ended/stale) Oracle session with no ' +
          'session-type pick dated today-or-later — this is evaluated across ALL arcs/sessions, ' +
          'not just the 7-day window, since the guarantee is "never silently lose one", not ' +
          '"never lose one within the visible window". `snoozed.arcs` = arcs with snoozed_until ' +
          'in the future, oldest-wake-date first. Assigning an unplanned item to a day uses the ' +
          'existing POST /api/today (respecting its per-day WIP cap, 409 on the 6th); snoozing ' +
          'uses the existing PATCH /api/arcs/{id} (snoozed_until).',
        responseExample: {
          timezone: 'America/New_York',
          days: [
            {
              date: 'YYYY-MM-DD',
              picks: [],
              meeting_count: 'number',
              meeting_minutes: 'number',
            },
          ],
          unplanned: {
            arcs: [
              {
                id: 'uuid',
                name: 'string',
                status: 'empty|open|complete',
                client_id: 'uuid|null',
                client: { id: 'uuid', name: 'string' },
                task_count: 'number',
                progress_percent: 'number',
                snoozed_until: 'ISO-8601|null',
              },
            ],
            sessions: [
              {
                external_id: 'string',
                title: 'string|null',
                status: 'string',
                remote_url: 'string|null',
                goal: 'string|null',
                cwd: 'string|null',
              },
            ],
          },
          snoozed: { arcs: [] },
          meta: { windowStart: 'YYYY-MM-DD', windowEnd: 'YYYY-MM-DD', windowEndInstant: 'ISO-8601' },
        },
      },
    ],
  },
];
