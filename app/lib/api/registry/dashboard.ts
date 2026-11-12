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
          { name: 'action', type: 'string', required: true, description: 'One of: not_now, matters_more, not_emergency, not_this_week, step_done, clear_session, on_day, proposal_yes, proposal_no, pin, stop, done_pin, arc_add, arc_remove, arc_reorder, swap, lighter, record. proposal_yes and proposal_no take a card from the sent-mail reconciler (item_key proposal:<uuid>); proposal_yes on a Track it card or a done card with a time choice answers 400 "Tap this on the home screen." finished_close, finished_close_one and finished_keep belong to the looks-finished card (item keys finished:<uuid>): finished_close takes item_keys, the ticked list (1 to 100) of main and orphan rows only, and closes each task through the normal status path (so its emails close too) with one Handled line and Undo for 72 hours; a security, portal or unticked row in the list is refused and stays open. finished_close_one closes one security or portal row with its own line and Undo. finished_keep (Not finished) takes the row off the card for 90 days. attach_choose answers the one question about which work a source belongs to (item_key attach:<uuid>, choice: a candidate target key, new_project, task or not_work); every answer has Undo for 72 hours (compare-and-set, nothing deleted). reopen_ask (item_key ask:<email ask uuid>) is Undo of a mail recorded as handled: it reopens it as a reply he owes and holds it against re-closing; allowed for 30 days; the chat may call it.' },
          { name: 'choice', type: 'string', required: false, description: 'attach_choose only: a candidate target key (project:<uuid> or task:<uuid>), new_project, task or not_work.' },
          { name: 'item_keys', type: 'string[]', required: false, description: 'finished_close only: 1 to 100 item keys finished:<uuid> from the looks-finished card.' },
          { name: 'item_key', type: 'string', required: false, description: 'Item key such as task:<uuid>, review:<uuid>, session:<id>, wait:<uuid>, thread:<account>:<thread id>, crisis:<uuid>. Required for every action except swap, lighter and arc_reorder. clear_session takes session:<external_id>: it remembers the cleared question text on the caller\'s own row and never touches the session; the card returns only if the session asks something new.' },
          { name: 'switch', type: 'boolean', required: false, description: 'pin only: true moves the pin from another item. Without it a second pin answers 409 pin_conflict.' },
          { name: 'note', type: 'string', required: false, description: 'stop only: where the work was left off. Trimmed; null or empty clears it.' },
          { name: 'group_key', type: 'string', required: false, description: 'arc_add, arc_remove and arc_reorder: the arc group key (arc:<uuid>, client:<uuid>, project:<uuid> or own).' },
          { name: 'origin', type: 'string', required: false, description: 'arc_add only: in_view or created.' },
          { name: 'step_keys', type: 'string[]', required: false, description: 'arc_reorder only: the full new step order, the same set as today\'s steps.' },
          { name: 'to_group_key', type: 'string', required: false, description: 'swap and lighter: the group key chosen from today.swap or today.lighter.' },
          { name: 'date', type: 'string', required: false, description: 'on_day only: the calendar day (YYYY-MM-DD, his zone) he will do the item. Tomorrow or later, at most 60 days out; otherwise 400 "Pick a day after today.". The item leaves Needs you now, Quick, today\'s steps and Working on until 00:05 that day, then returns boosted with "You said today.". Not a Not now: park_count and the learner are untouched, and no Task field is written.' },
          { name: 'did', type: 'string', required: false, description: 'record only: the existing-endpoint action taken on the item.' },
          { name: 'undo', type: 'boolean', required: false, description: 'record only: true logs the existing-endpoint undo instead.' },
        ],
        responseExample: { ok: true, action_id: 'uuid', undo_until: 'ISO-8601|null', item_key: 'string|null', message: 'string|null' },
        responseNotes: 'Answers 403 unless the caller is an admin whose own home_view preference is home. Errors use { error, code }: 409 with code pin_conflict, stale_day, already_in_arc or not_in_arc; 400 for an invalid body. Writes touch only the caller\'s home_item_state, home_day and home_actions rows, never a shared record.',
      },
    ],
  },
  {
    path: '/api/home/reconcile',
    group: 'dashboard',
    methods: [
      {
        method: 'POST',
        summary: 'Tap a card from the sent-mail reconciler that can create a time entry: Track it, Log time, or Mark it done with a time choice. Browser session only; the only path that creates a time entry from these cards.',
        auth: 'required',
        roles: ['admin'],
        bodySchema: [
          { name: 'action', type: 'string', required: true, description: 'track_it, log_time or proposal_yes.' },
          { name: 'item_key', type: 'string', required: false, description: 'proposal:<uuid>. track_it and proposal_yes.' },
          { name: 'placement', type: 'string', required: false, description: 'track_it only: project (the live project the card named), new_project, or none (a single finished one-off with no next step). Only a choice the card offered is accepted; multi-step work always lands in a project.' },
          { name: 'minutes', type: 'number', required: false, description: 'track_it and proposal_yes: the minutes chosen, or null for no time entry. log_time: 1 to 1440.' },
          { name: 'billable', type: 'boolean', required: false, description: 'track_it only: the time entry is billable unless false.' },
          { name: 'task_id', type: 'uuid', required: false, description: 'log_time only: his own task with no time entries.' },
          { name: 'day', type: 'string', required: false, description: 'log_time only: the day of his email (YYYY-MM-DD).' },
        ],
        responseExample: { ok: true, action_id: 'uuid', undo_until: 'ISO-8601', item_key: 'string', message: 'string' },
        responseNotes: 'Session only and only the owner: answers 403 for an API key (the chat key, the courier key and the machine job can never reach it). 409 with code card_gone, changed_since, bad_choice or has_time; 404 not_found. Track it writes, in one transaction: a new live project when asked (no billing field), the done task, the next-step task, the later tasks (blocked by the next step) and one time entry only when minutes are chosen. Undo is POST /api/home/undo for 24 hours (compare-and-set, nothing deleted).',
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
    path: '/api/home/calendar',
    group: 'dashboard',
    methods: [
      {
        method: 'GET',
        summary: 'Get today\'s calendar strip for the Home screen: one row per event with only a time and who it is with. Browser session only, and only the calendar\'s owner.',
        auth: 'required',
        roles: ['admin'],
        responseExample: {
          upcoming: [{ id: 'uuid', time: 'string (2:00, 6:30 am or Now)', who: 'string (names, never an email address)', muted: 'boolean', openable: 'boolean' }],
          later: [{ id: 'uuid', time: 'string', who: 'string', muted: 'boolean', openable: 'boolean' }],
          earlier: [{ id: 'uuid', time: 'string', who: 'string', muted: 'boolean', openable: 'boolean' }],
          all_day: 'string|null',
          tomorrow: '{id, time, who, muted, openable}|null (after 3:00 pm his time)',
          soon: '{id, time, who, muted, openable}|null (a meeting under way or starting within 30 minutes)',
        },
        responseNotes: 'Answers 403 for an API key or the chat (a browser session only), for a non-admin, when the caller\'s own home_view preference is not home, and when the caller\'s email is not the calendar owner\'s. No user_id parameter. Sends Cache-Control: no-store. Writes nothing and builds no Home list. Declined events never appear.',
      },
    ],
  },
  {
    path: '/api/home/calendar/:id',
    group: 'dashboard',
    methods: [
      {
        method: 'GET',
        summary: 'Get the Home screen meeting drawer for one calendar event on today or tomorrow: who it is with, how that matched, the join link, hints, the caller\'s own items and links. Browser session only, and only the calendar\'s owner.',
        auth: 'required',
        roles: ['admin'],
        responseExample: {
          event: { id: 'uuid', title: 'string', when: 'string', location: 'string|null', join: '{href, label}|null (https only)', invite_text: 'string|null (plain text, cut to 600 characters)', invite_links: [{ href: 'string', label: 'string' }] },
          client: '{id, name}|null',
          also_with: ['string'],
          people: [{ name: 'string', detail: 'string|null', reply: 'string|null' }],
          matched_by: 'string',
          hints: [{ text: 'string', muted: 'boolean' }],
          items: [{ item: 'HomeItem', where: 'string' }],
          more_items: 'number',
          more_project_id: 'uuid|null',
          links: [{ label: 'string', href: 'string|null', project_id: 'uuid|null' }],
        },
        responseNotes: 'Same gate as the strip (403 for an API key, a non-admin, a home_view other than home, or another email). 404 for a bad id, an event outside today and tomorrow in the caller\'s zone, or a declined event. Sends Cache-Control: no-store. Writes nothing. Event titles and descriptions are untrusted: plain text only, and links only for known meeting hosts over https. Items carry no score, class, priority or emergency field.',
      },
    ],
  },
  {
    path: '/api/home/learned',
    group: 'dashboard',
    methods: [
      {
        method: 'GET',
        summary: 'What the Home screen learned from the caller\'s taps (Slice 7b): one sentence per learned weight, and whether learning is on. Browser session only.',
        auth: 'required',
        roles: ['admin'],
        responseExample: { on: true, items: [{ evidence_key: 'client:uuid', sentence: 'Nerd Herd work comes up a little sooner, since November 30', since: 'ISO-8601' }] },
        responseNotes: 'Sentences only: no weight or percent is returned. Answers 403 for an API key or the chat and when the home view is off.',
      },
      {
        method: 'POST',
        summary: 'Put a learned weight back to untouched, or switch "Learn from my taps". Browser session only.',
        auth: 'required',
        roles: ['admin'],
        bodySchema: [
          { name: 'action', type: 'string', required: true, description: 'put_back or learning.' },
          { name: 'evidence_key', type: 'string', required: false, description: 'For put_back: the key from GET /api/home/learned.' },
          { name: 'on', type: 'boolean', required: false, description: 'For learning: true or false.' },
        ],
        responseExample: { ok: true, on: true, items: [], action_id: 'uuid', undo_until: 'ISO-8601' },
        responseNotes: 'Put back sets the weight to untouched and holds it 30 days; its Undo (POST /api/home/undo) stays open 24 hours. Answers 403 for an API key or the chat, 404 for a key that is not learned. A Learned line under Handled for you is undone through POST /api/home/undo for seven days.',
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
    path: '/api/home/send',
    group: 'dashboard',
    methods: [
      {
        method: 'POST',
        summary: 'Send the draft: Mike\'s own press on Bast\'s draft for a thread. Queues one held outbox reply (kind owed_reply) that the courier lane\'s sender claims after 10 minutes. Browser session only, and only while his owed_send switch is on.',
        auth: 'required',
        roles: ['admin'],
        bodySchema: [
          { name: 'item_key', type: 'string', required: true, description: 'thread:<account>:<thread id>.' },
          { name: 'draft_id', type: 'string', required: true, description: 'Bast\'s current Gmail draft id for the newest open mail on the thread, or the short holding draft\'s id.' },
        ],
        responseExample: { ok: true, action_id: 'uuid', send_after: 'ISO-8601', item_key: 'string', message: 'string' },
        responseNotes: 'Answers 403 for an API key or the chat (a browser session only) and when the home view is off. 409 with code send_off while the switch is off (the default: no settings row means off), not_current, already_queued or draft_blank. Nothing is sent by this call; undo is POST /api/home/undo until send_after, which cancels the held row.',
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
          { name: 'wrong', type: 'boolean', required: false, description: 'true ("This was wrong"), only on a sent-mail note line: undoes it, then keeps the reconciler from changing that task from his mail for 90 days.' },
        ],
        responseExample: { ok: true, action_id: 'uuid', item_key: 'string|null', message: 'string|null ("Changed since. Open the task." when part of a Track it was left alone)' },
        responseNotes: 'Answers 403 unless the caller is an admin whose own home_view preference is home. Refused with 409 when the 24-hour undo window has passed, when the action was already undone, or when the action has no undo (record without undo). A Send the draft press is undone here too, until its 10-minute hold ends, and answers 409 undo_expired after that.',
      },
    ],
  },
];
