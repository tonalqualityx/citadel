import type { ApiEndpoint } from './index';

export const dashboardEndpoints: ApiEndpoint[] = [
  {
    path: '/api/dashboard',
    group: 'dashboard',
    methods: [
      {
        method: 'GET',
        summary: 'Get role-specific dashboard data (tasks, metrics, alerts). Returns different data based on user role.',
        auth: 'required',
        queryParams: [
          { name: 'orderBy', type: 'string', required: false, description: 'Sort order for My Tasks: priority, due_date, or estimate' },
          { name: 'tz', type: 'string', required: false, description: 'IANA timezone name (e.g., America/New_York). Used to compute "today" boundaries. Defaults to server timezone if omitted.' },
          { name: 'limit_myTasks', type: 'number', required: false, description: 'Page size for the My Tasks list (default 10, max 200). Used by "load more".' },
          { name: 'limit_focusTasks', type: 'number', required: false, description: 'Page size for the Focus Tasks list (default 10, max 200). Used by "load more".' },
          { name: 'limit_awaitingReview', type: 'number', required: false, description: 'Page size for the Awaiting Review list (default 10, max 200). Used by "load more".' },
          { name: 'limit_unassignedTasks', type: 'number', required: false, description: 'Page size for the Unassigned Tasks list (default 10, max 200). Used by "load more".' },
        ],
        responseExample: {
          tasks: [{ id: 'uuid', title: 'string', status: 'string', priority: 'number', project: { id: 'uuid', name: 'string' }, time_logged_minutes: 'number' }],
          metrics: { tasks_due_today: 'number', tasks_in_progress: 'number', hours_this_week: 'number' },
        },
        responseNotes: 'Response shape varies by role. Tech users see their assigned tasks and focus items. PM/admin users see team overview, project health, and alerts. Paginated lists ({ items, total, hasMore }) grow via the limit_<list> query params, so "load more" survives refetches and mutations. tasks[].time_logged_minutes is pre-calculated at API level.',
      },
    ],
  },
  {
    path: '/api/dashboard/timeclock-issues',
    group: 'dashboard',
    methods: [
      {
        method: 'GET',
        summary: 'Get completed tasks missing time entries and currently running timers.',
        auth: 'required',
        responseExample: {
          tasks_missing_time: [{ id: 'uuid', title: 'string', status: 'string', completed_at: 'ISO-8601' }],
          running_timers: [{ id: 'uuid', task: { id: 'uuid', title: 'string' }, started_at: 'ISO-8601' }],
        },
      },
    ],
  },
  {
    path: '/api/home',
    group: 'dashboard',
    methods: [
      {
        method: 'GET',
        summary: 'Get the Home screen payload for the caller: date line, Today proposal, sections (needs you now, working on, leads, mail, next, handled) and everything else. Admin only; answers 403 unless the caller\'s own home_view preference is home.',
        auth: 'required',
        roles: ['admin'],
        responseExample: {
          generated_at: 'ISO-8601',
          date: 'YYYY-MM-DD',
          timezone: 'string',
          screen_date_line: 'string',
          today: { group_key: 'string', arc_id: 'uuid|null', arc_name: 'string', why: 'string', size_line: 'string', quick: ['HomeItem'], steps: ['HomeItem'], added_keys: ['string'], swap: [{ group_key: 'string', name: 'string', why: 'string', minutes: 'number' }], lighter: 'object|null' },
          sections: { needs_you_now: ['HomeItem'], working_on: ['HomeItem'], leads: ['HomeItem'], mail: ['HomeItem'], next: ['HomeItem'], handled: [{ text: 'string', href: 'string|null', at: 'ISO-8601' }] },
          everything_else: { count: 'number', line: 'string', groups: [{ label: 'string', count: 'number', owner: 'string' }] },
        },
        responseNotes: 'Answers 403 unless the caller is an admin whose own home_view preference is home (the preference is read for the caller only; no user_id parameter). Sends Cache-Control: no-store. Items carry no score, class, priority or emergency field; order and the one-line why_now / reason are the only ranking signals.',
      },
    ],
  },
  {
    path: '/api/home/act',
    group: 'dashboard',
    methods: [
      {
        method: 'POST',
        summary: 'Apply one Home screen action for the caller (not now, matters more, pin, stop, arc add/remove/reorder, swap, lighter, record). Each call is logged to home_actions and most can be undone for 24 hours.',
        auth: 'required',
        roles: ['admin'],
        bodySchema: [
          { name: 'action', type: 'string', required: true, description: 'One of: not_now, matters_more, not_emergency, not_this_week, step_done, pin, stop, done_pin, arc_add, arc_remove, arc_reorder, swap, lighter, record' },
          { name: 'item_key', type: 'string', required: false, description: 'Item key such as task:<uuid>, review:<uuid>, session:<id>, wait:<uuid>, thread:<account>:<thread id>, crisis:<uuid>. Required for every action except swap, lighter and arc_reorder.' },
          { name: 'switch', type: 'boolean', required: false, description: 'pin only: true moves the pin from another item. Without it a second pin answers 409 pin_conflict.' },
          { name: 'note', type: 'string', required: false, description: 'stop only: where the work was left off. Trimmed; null or empty clears it.' },
          { name: 'group_key', type: 'string', required: false, description: 'arc_add, arc_remove and arc_reorder: the arc group key (arc:<uuid>, client:<uuid>, project:<uuid> or own).' },
          { name: 'origin', type: 'string', required: false, description: 'arc_add only: in_view or created.' },
          { name: 'step_keys', type: 'string[]', required: false, description: 'arc_reorder only: the full new step order, the same set as today\'s steps.' },
          { name: 'to_group_key', type: 'string', required: false, description: 'swap and lighter: the group key chosen from today.swap or today.lighter.' },
          { name: 'did', type: 'string', required: false, description: 'record only: the existing-endpoint action taken on the item.' },
          { name: 'undo', type: 'boolean', required: false, description: 'record only: true logs the existing-endpoint undo instead.' },
        ],
        responseExample: { ok: true, action_id: 'uuid', undo_until: 'ISO-8601|null', item_key: 'string|null', message: 'string|null' },
        responseNotes: 'Answers 403 unless the caller is an admin whose own home_view preference is home. Errors use { error, code }: 409 with code pin_conflict, stale_day, already_in_arc or not_in_arc; 400 for an invalid body. Writes touch only the caller\'s home_item_state, home_day and home_actions rows, never a shared record.',
      },
    ],
  },
  {
    path: '/api/home/projects/:id',
    group: 'dashboard',
    methods: [
      {
        method: 'GET',
        summary: 'Get the Home screen project drawer for one project: the caller\'s own items in it (with their buttons), and the open waits others hold. Browser session only.',
        auth: 'required',
        roles: ['admin'],
        responseExample: {
          project: { id: 'uuid', name: 'string', client: { id: 'uuid', name: 'string' } },
          items: [{ item: 'HomeItem', where: 'string' }],
          waits: [{ who: 'string', since: 'ISO-8601', title: 'string' }],
        },
        responseNotes: 'Answers 403 for an API key or the chat (a browser session only), for a non-admin, and when the caller\'s own home_view preference is not home; 404 for an unknown project. No user_id parameter: only the caller\'s own items appear, never another user\'s. Sends Cache-Control: no-store. Writes nothing. Items carry no score, class, priority or emergency field.',
      },
    ],
  },
  {
    path: '/api/home/rule',
    group: 'dashboard',
    methods: [
      {
        method: 'POST',
        summary: 'Save a "Not an emergency" rule from the Home screen for a crisis mail (this sender or this domain) or a site down row (this site). Browser session only.',
        auth: 'required',
        roles: ['admin'],
        bodySchema: [
          { name: 'item_key', type: 'string', required: true, description: 'crisis:<uuid> or site:<uuid>.' },
          { name: 'scope', type: 'string', required: true, description: 'One of: sender, domain, site. Only the choices the item offers are accepted.' },
          { name: 'reason', type: 'string', required: false, description: 'One line, 300 characters at most.' },
        ],
        responseExample: { ok: true, action_id: 'uuid', undo_until: 'ISO-8601', item_key: 'string', rule: { key: 'string', kind: 'string', value: 'string', revision: 'number', line: 'string' }, message: 'string' },
        responseNotes: 'Answers 403 for an API key or the chat (a browser session only) and when the home view is off. 400 for a task item ("A security flag is never turned into a rule."), a free mail or own domain, or a choice the item does not offer. Writes one Decision (lane home-emergency, kind ruling, confirmed) with a link, the caller\'s home_item_state and one home_actions row; undo is POST /api/home/undo for seven days.',
      },
    ],
  },
  {
    path: '/api/home/undo',
    group: 'dashboard',
    methods: [
      {
        method: 'POST',
        summary: 'Undo a Home screen action returned by POST /api/home/act, restoring the stored before-state.',
        auth: 'required',
        roles: ['admin'],
        bodySchema: [
          { name: 'action_id', type: 'uuid', required: true, description: 'The action_id from a POST /api/home/act response' },
        ],
        responseExample: { ok: true, action_id: 'uuid', item_key: 'string|null' },
        responseNotes: 'Answers 403 unless the caller is an admin whose own home_view preference is home. Refused with 409 when the 24-hour undo window has passed, when the action was already undone, or when the action has no undo (record without undo).',
      },
    ],
  },
];
