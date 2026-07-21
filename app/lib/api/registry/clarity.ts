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
];
