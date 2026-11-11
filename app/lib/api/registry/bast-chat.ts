import type { ApiEndpoint, ParamDef } from './index';

/**
 * Bast chat (the owner's chat panel on the home screen and the daemon that answers it): every route under
 * app/api/bast-chat/**. Mike's routes need a signed-in browser session of the configured chat owner, who must
 * still be an admin; an API key of any kind is refused with 403. The worker routes accept only the enforced
 * bast-chat lane key. Every response is no-store and every failure body is {error: "<plain sentence>"}.
 * Bodies are strict: an unknown field is 400. Nothing here deletes anything.
 */

const OWNER = ['admin'];
const WORKER = ['bast-chat'];

const idParam: ParamDef = { name: 'id', type: 'uuid', required: true, description: 'Conversation id (path); a chat that is not the owner is 404' };
const actionIdParam: ParamDef = { name: 'id', type: 'uuid', required: true, description: 'Action id (path); an action of another chat is 404' };

const workerShape = { online: 'boolean', paused: 'boolean', pause_reason: 'string|null', auth_state: "'token'|'login'|'failed'|null" };

const actionExample = {
  id: 'uuid',
  conversation_id: 'uuid',
  event_seq: 'number|null',
  tool: 'create_task|update_task|add_to_arc|remove_from_arc|propose_handoff',
  target_id: 'uuid',
  summary: 'string',
  status: 'applied|proposed|released|declined|undone|failed',
  can_undo: 'boolean',
  undo_until: 'ISO-8601|null',
  proposed_assignee_id: 'uuid|null',
  created_at: 'ISO-8601',
};

const settingsExample = {
  enabled: 'boolean',
  owner_user_id: 'uuid|null',
  model: "string (sonnet, haiku or a full claude-sonnet-* or claude-haiku-* id)",
  effort: 'low|medium|high',
  turn_budget_usd: 'number',
  daily_turn_cap: 'number',
  daily_write_cap: 'number',
  daily_cost_cap_usd: 'number',
  stale_after_minutes: 'number',
  idle_close_minutes: 'number',
};

const emptyBody: ParamDef[] = [];

function actionRoute(verb: 'undo' | 'release' | 'decline', summary: string): ApiEndpoint {
  return {
    path: `/api/bast-chat/actions/:id/${verb}`,
    group: 'bast-chat',
    methods: [
      {
        method: 'POST',
        summary,
        auth: 'required',
        roles: OWNER,
        queryParams: [actionIdParam],
        bodySchema: emptyBody,
        responseExample: { action: actionExample },
        responseNotes: 'Owner session only; runs in Citadel as the owner, never on the machine. Body must be {} (strict). 409 with a plain sentence when it cannot be done any more (already used, window passed, changed since, not waiting). 404 for an action of another chat.',
      },
    ],
  };
}

export const bastChatEndpoints: ApiEndpoint[] = [
  {
    path: '/api/bast-chat/status',
    group: 'bast-chat',
    methods: [
      {
        method: 'GET',
        summary: 'Chat status for the dock: enabled, whether the machine is answering, the current conversation, what is left today',
        auth: 'required',
        roles: OWNER,
        responseExample: {
          enabled: 'boolean',
          worker: workerShape,
          conversation_id: 'uuid|null',
          last_assistant_seq: 'number|null',
          usage: { turns_left: 'number', writes_left: 'number', usd_left: 'number' },
        },
        responseNotes: 'Session only (an API key is 403), chat owner only, chat must be enabled. A 403 makes the dock render nothing. No-store.',
      },
    ],
  },
  {
    path: '/api/bast-chat/conversations',
    group: 'bast-chat',
    methods: [
      {
        method: 'GET',
        summary: 'The last 20 conversations of the owner, newest first',
        auth: 'required',
        roles: OWNER,
        responseExample: { conversations: [{ id: 'uuid', title: 'string|null', status: 'idle|queued|running|closed', last_message_at: 'ISO-8601|null', created_at: 'ISO-8601' }] },
      },
      {
        method: 'POST',
        summary: 'Start a new conversation; the open one is closed and kept',
        auth: 'required',
        roles: OWNER,
        bodySchema: emptyBody,
        responseExample: { id: 'uuid' },
        responseNotes: 'Body must be {} (strict). JSON content type and same origin required. 201.',
      },
    ],
  },
  {
    path: '/api/bast-chat/conversations/:id/feed',
    group: 'bast-chat',
    methods: [
      {
        method: 'GET',
        summary: 'Events after a seq, live text, worker state and the conversation\'s actions (the panel polls this)',
        auth: 'required',
        roles: OWNER,
        queryParams: [
          idParam,
          { name: 'after', type: 'number', required: false, description: 'Return events with seq greater than this (whole number, default 0); anything else is 400' },
        ],
        responseExample: {
          conversation: { id: 'uuid', status: 'idle|queued|running|closed' },
          events: [
            {
              seq: 'number',
              role: 'mike|assistant|tool|system',
              kind: 'text|action|result|status|cost',
              payload: "{text?: string, code?: string} (only text and status events carry text; others are {})",
              client_ref: "string|null (Mike's messages only)",
              delivered: "boolean (Mike's messages only)",
              expired: "boolean (Mike's messages only)",
              created_at: 'ISO-8601',
            },
          ],
          live_text: 'string|null',
          live_action: 'string|null',
          worker: workerShape,
          actions: [{ id: 'uuid', tool: 'string', target_type: 'task|home|comment|email_ask|wait|project', summary: 'string', status: 'applied|proposed|released|declined|undone|failed', undo_until: 'ISO-8601|null', event_seq: 'number|null', proposed_assignee: 'string|null (proposals only, first name)', proposal_kind: 'bast_start|client_show|null', card: 'object|null (the tap card of a proposal: kind, title, lines, reads, client, buttons, clause)', error: 'string|null (a failed proposal: the plain refusal)' }],
          waiting: [{ seq: 'number', delivered: 'boolean (always false)', expired: 'boolean' }],
        },
        responseNotes: 'waiting lists Mike\'s messages the machine has not picked up yet (expired ones included). Stop requests are never listed.',
      },
    ],
  },
  {
    path: '/api/bast-chat/conversations/:id/messages',
    group: 'bast-chat',
    methods: [
      {
        method: 'POST',
        summary: 'Send a message to Bast',
        auth: 'required',
        roles: OWNER,
        queryParams: [idParam],
        bodySchema: [
          { name: 'client_ref', type: 'string', required: true, description: 'Unique per conversation, 1 to 64 characters; a repeat returns the first seq and stores nothing' },
          { name: 'text', type: 'string', required: true, description: 'The message, 1 to 4000 characters' },
          { name: 'context', type: 'object', required: false, description: "The open card: {screen?: 'home'|'overlook', tile?, kind: task|email_ask|wait|project|arc|session_ask|none, id?: uuid, task_id?: uuid, title?}. Strict. An unknown card is stored as kind none; titles never reach the model" },
        ],
        responseExample: { seq: 'number' },
        responseNotes: '201 for a new message, 200 for a repeat client_ref. 429 {error} with a plain sentence when a daily cap is reached. 409 when the chat is closed. Strict body.',
      },
    ],
  },
  {
    path: '/api/bast-chat/conversations/:id/stop',
    group: 'bast-chat',
    methods: [
      {
        method: 'POST',
        summary: 'Ask the machine to stop the turn that is running',
        auth: 'required',
        roles: OWNER,
        queryParams: [idParam],
        bodySchema: emptyBody,
        responseExample: { queued: 'boolean (false when no turn is running)' },
        responseNotes: 'Body must be {} (strict).',
      },
    ],
  },
  actionRoute('undo', 'Undo an applied change the chat made (within 24 hours, only if the task is unchanged since)'),
  actionRoute('release', 'Carry out a handoff proposal: the task goes to the proposed person, under the owner\'s own session'),
  actionRoute('decline', 'Keep it: drop a handoff proposal without touching the task'),
  {
    path: '/api/bast-chat/admin/settings',
    group: 'bast-chat',
    methods: [
      {
        method: 'GET',
        summary: 'Chat settings (owner, kill switch, model, caps)',
        auth: 'required',
        roles: OWNER,
        responseExample: { settings: settingsExample },
        responseNotes: 'Session only, configured owner who is still an admin. Allowed while the chat is switched off. Until an owner is set in the database no one passes.',
      },
      {
        method: 'PATCH',
        summary: 'Change chat settings',
        auth: 'required',
        roles: OWNER,
        bodySchema: [
          { name: 'enabled', type: 'boolean', required: false, description: 'Kill switch' },
          { name: 'owner_user_id', type: 'uuid', required: false, description: 'Must be an active admin' },
          { name: 'model', type: 'string', required: false, description: 'sonnet, haiku or a full claude-sonnet-* or claude-haiku-* id; anything else is 400' },
          { name: 'effort', type: 'string', required: false, description: 'low | medium | high' },
          { name: 'turn_budget_usd', type: 'number', required: false, description: '0.05 to 5' },
          { name: 'daily_turn_cap', type: 'number', required: false, description: 'Messages a day, 1 to 1000' },
          { name: 'daily_write_cap', type: 'number', required: false, description: 'Task changes a day, 0 to 500' },
          { name: 'daily_cost_cap_usd', type: 'number', required: false, description: '0.5 to 100' },
          { name: 'stale_after_minutes', type: 'number', required: false, description: 'A waiting message older than this is marked not answered, 5 to 1440' },
          { name: 'idle_close_minutes', type: 'number', required: false, description: 'Minutes before an idle query closes, 1 to 120' },
        ],
        responseExample: { settings: settingsExample },
        responseNotes: 'Strict partial body: an unknown field is 400.',
      },
    ],
  },
  {
    path: '/api/bast-chat/worker/inbox',
    group: 'bast-chat',
    methods: [
      {
        method: 'GET',
        summary: 'Chat daemon: waiting messages, pending stops and the settings it needs',
        auth: 'required',
        roles: WORKER,
        responseExample: {
          messages: [{ conversation_id: 'uuid', seq: 'number', client_ref: 'string', text: 'string', context: { screen: 'string', tile: 'string', kind: 'task|email_ask|wait|project|arc|session_ask|none', id: 'string' }, notes: [{ code: 'string (action_undone|action_released|action_declined|action_failed|undo_proposed|...)', line: 'string (what happened to a change since the last answer)' }] }],
          stops: [{ conversation_id: 'uuid' }],
          settings: { enabled: 'boolean', owner_user_id: 'uuid|""', model: 'string', effort: 'string', max_budget_usd: 'number', max_turns: 'number', idle_close_minutes: 'number', turns_left: 'number', writes_left: 'number', usd_left: 'number' },
        },
        responseNotes: 'Only the enforced bast-chat lane key; a session or any other key is 403. Messages older than the stale limit are marked not answered and not returned. A stop is served once. Card titles never travel.',
      },
    ],
  },
  {
    path: '/api/bast-chat/worker/heartbeat',
    group: 'bast-chat',
    methods: [
      {
        method: 'POST',
        summary: 'Chat daemon heartbeat',
        auth: 'required',
        roles: WORKER,
        bodySchema: [
          { name: 'version', type: 'string', required: true, description: 'Daemon version, max 40' },
          { name: 'sdk_version', type: 'string', required: true, description: 'Agent SDK version, max 40' },
          { name: 'paused', type: 'boolean', required: true, description: 'Paused on the machine' },
          { name: 'pause_reason', type: 'string', required: false, description: 'Max 200' },
          { name: 'live_conversations', type: 'object', required: true, description: '[{id: uuid, alive: boolean, status?: string}], max 50' },
          { name: 'isolation', type: 'object', required: true, description: '{ok: boolean, at?: string} or null' },
          { name: 'auth_state', type: 'string', required: true, description: 'token | login | failed' },
        ],
        responseExample: { ok: 'boolean' },
        responseNotes: 'Strict body. Also marks stale waiting messages not answered and closes chats idle for 4 hours. Deletes nothing.',
      },
    ],
  },
  {
    path: '/api/bast-chat/worker/conversations/:id',
    group: 'bast-chat',
    methods: [
      {
        method: 'GET',
        summary: 'Chat daemon: the last text messages of a conversation, to seed a reopened query',
        auth: 'required',
        roles: WORKER,
        queryParams: [idParam, { name: 'history', type: 'number', required: false, description: 'How many messages, 1 to 50 (default 20)' }],
        responseExample: { messages: [{ seq: 'number', role: 'mike|assistant', text: 'string' }] },
        responseNotes: 'Oldest first. Expired messages are left out. A conversation that is not the owner\'s is 404.',
      },
      {
        method: 'PATCH',
        summary: 'Chat daemon: update status, live text, live action, model or cost of a conversation',
        auth: 'required',
        roles: WORKER,
        queryParams: [idParam],
        bodySchema: [
          { name: 'status', type: 'string', required: false, description: 'idle | queued | running (never closed)' },
          { name: 'live_text', type: 'string', required: false, description: 'Text so far (last 4000 characters kept); null clears' },
          { name: 'live_action', type: 'string', required: false, description: 'One line; null clears' },
          { name: 'model', type: 'string', required: false, description: 'Sonnet or Haiku only; null clears' },
          { name: 'cost_usd', type: 'number', required: false, description: 'Conversation cost total' },
        ],
        responseExample: { ok: 'boolean' },
        responseNotes: 'Strict body.',
      },
    ],
  },
  {
    path: '/api/bast-chat/worker/conversations/:id/events',
    group: 'bast-chat',
    methods: [
      {
        method: 'POST',
        summary: 'Chat daemon: post assistant, tool or system events and acknowledge Mike\'s messages',
        auth: 'required',
        roles: WORKER,
        queryParams: [idParam],
        bodySchema: [
          { name: 'acks', type: 'object', required: false, description: 'Seqs of Mike\'s messages now picked up (number[], max 200)' },
          { name: 'events', type: 'object', required: false, description: '[{role: assistant|tool|system, kind: text|action|result|status|cost, payload: object (max 16 KB, text max 8 KB), turn?: number}], max 100' },
        ],
        responseExample: { last_seq: 'number', first_seq: 'number|null', acked: 'number' },
        responseNotes: 'Strict body, 256 KB cap. A cost event adds to the conversation and to today\'s usage.',
      },
    ],
  },
  {
    path: '/api/bast-chat/worker/actions',
    group: 'bast-chat',
    methods: [
      {
        method: 'POST',
        summary: 'Chat daemon: record a change the chat made (before and after) or a handoff proposal',
        auth: 'required',
        roles: WORKER,
        bodySchema: [
          { name: 'conversation_id', type: 'uuid', required: true, description: 'The owner\'s conversation' },
          { name: 'event_seq', type: 'number', required: false, description: 'Seq of the action event' },
          { name: 'tool', type: 'string', required: true, description: 'create_task | update_task | add_to_arc | remove_from_arc | propose_handoff' },
          { name: 'target_id', type: 'uuid', required: true, description: 'The task' },
          { name: 'summary', type: 'string', required: true, description: 'The one plain sentence Mike sees, max 600' },
          { name: 'before', type: 'object', required: false, description: 'Allowlisted task fields before: status, title, arc_id, assignee_id' },
          { name: 'after', type: 'object', required: false, description: 'The same fields after' },
          { name: 'proposed_assignee_id', type: 'uuid', required: false, description: 'Proposals only: who it would go to' },
          { name: 'status', type: 'string', required: false, description: 'applied (default) | proposed | failed' },
          { name: 'error', type: 'string', required: false, description: 'Max 500' },
        ],
        responseExample: { id: 'uuid', status: 'string', undo_until: 'ISO-8601|null' },
        responseNotes: 'Strict body. 201. The change already happened, so it is always recorded; it counts against today\'s write cap and the next one is refused. A proposal can only be stored as proposed; release is the owner\'s tap under his own session. A conversation that is not the owner\'s is 404.',
      },
    ],
  },
  {
    path: '/api/bast-chat/worker/today',
    group: 'bast-chat',
    methods: [
      {
        method: 'GET',
        summary: 'Chat daemon: the owner\'s Today, trimmed',
        auth: 'required',
        roles: WORKER,
        responseExample: {
          date: 'string (YYYY-MM-DD)',
          arc_name: 'string|null',
          why: 'string|null',
          size_line: 'string|null',
          quick: [{ key: 'string', title: 'string', who: 'string|null', age: 'string', effort: 'string' }],
          steps: [{ key: 'string', title: 'string', who: 'string|null', age: 'string', effort: 'string' }],
          group_key: 'string|null (today\'s group: arc:<uuid>, client:<uuid>, project:<uuid> or own)',
          swap: [{ group_key: 'string', name: 'string', effort: 'string' }],
          lighter: '{group_key, name, effort}|null',
          pinned: '{key, title}|null (the item being worked on now)',
          emergencies: [{ key: 'string', title: 'string', emergency: 'true (Needs you now; never a rule, class or score)' }],
          parked: [{ key: 'string', title: 'string', until: 'ISO-8601|null (null: it stays in view)' }],
          counts: { needs_you_now: 'number', working_on: 'number', leads: 'number', mail: 'number', next: 'number', handled: 'number', everything_else: 'number' },
        },
        responseNotes: 'Always the owner from the settings; takes no user id. Read only: it stores nothing. Never a score, class or button. The v2 fields let the chat see what a home change touches: a step key, a group key or a pinned key is what the home op takes.',
      },
    ],
  },
  {
    path: '/api/bast-chat/worker/home-keeper',
    group: 'bast-chat',
    methods: [
      {
        method: 'GET',
        summary: 'Chat lane: the nightly home sort as a dry run for the owner',
        auth: 'required',
        roles: WORKER,
        responseExample: {
          dry_run: 'true',
          skipped: '"home_off" (only when the owner is not an active admin on the home view; then there is no plan)',
          plan: {
            owner_id: 'string (uuid)',
            date: 'string (YYYY-MM-DD, the owner\'s zone)',
            stagger: [{ item_key: 'string', title: 'string', day: 'string (YYYY-MM-DD)', view_at: 'ISO-8601' }],
            dates: [{ item_key: 'string', title: 'string', outcome: '"read"|"set_aside"', due_date: 'string (YYYY-MM-DD)', client_facing: 'boolean' }],
            lines: [{ action: 'string', text: 'string', details: ['string'] }],
            counts: { stagger: 'number', dates_read: 'number', dates_set_aside: 'number' },
          },
          arcs: {
            switches: { arcs_create: 'boolean', arcs_close: 'boolean', arcs_link_tasks: 'boolean (all false with no home_keeper_settings row)' },
            would_make: [{ group_key: 'string', name: 'string', client_id: 'string|null', project_id: 'string|null', task_ids: ['string'], task_titles: ['string'], line: 'string' }],
            would_close: [{ arc_id: 'string', name: 'string', reason: '"all_done"|"stale"', open_tasks: 'number', line: 'string' }],
          },
          action_ids: '[] (always empty here)',
        },
        responseNotes: 'Owner only: always the configured chat owner, never a user id. Skipped unless the owner\'s home_view is home. GET writes nothing. The lists show the first 50 changes; counts and lines cover all of them. The arcs key lists what the arc rules would do tonight (at most 1 made, 5 closed) whatever the switches say, so it can be shown before anything is switched on.',
      },
      {
        method: 'POST',
        summary: 'Chat lane: the nightly home sort, the real run (the crontab wrapper)',
        auth: 'required',
        roles: WORKER,
        responseExample: {
          dry_run: 'false',
          already_ran: 'true (this zoned day already has a nightly run; nothing written; then there is no plan)',
          skipped: '"home_off" (the owner is not on the home view; nothing written)',
          plan: 'what was written, same shape as the GET plan',
          arcs_written: 'only when arcs_create or arcs_close is on: { switches, made: [...], closed: [...] } in the shape of the GET arcs lists',
          action_ids: ['string (uuid, one home_actions row per kind with changes, and one per arc made or closed)'],
        },
        responseNotes: 'Strict empty body {}. Owner only. Skipped unless the owner\'s home_view is home. Runs once per zoned day: a second POST the same day answers already_ran and writes nothing. Writes only the owner\'s home_item_state, home_actions (source keeper, undo open 72 hours) and home_keeper_runs rows; never an email ask, wait, comment or notification, and sends nothing. The one exception is the arc writes (Arc rows and Task.arc_id on the owner\'s own tasks), each behind its own switch in home_keeper_settings, read again inside the transaction; with no settings row every switch is off and the run is as it was before.',
      },
    ],
  },
  {
    path: '/api/bast-chat/worker/home-keeper/summaries',
    group: 'bast-chat',
    methods: [
      {
        method: 'GET',
        summary: 'Chat lane: the owner\'s long home cards that still need a short version',
        auth: 'required',
        roles: WORKER,
        queryParams: [{ name: 'limit', type: 'number', required: false, description: 'At most this many items (1 to 40; default and cap 40)' }],
        responseExample: {
          items: [{ item_key: 'string (task:<uuid>)', task_id: 'string (uuid)', title: 'string', text: 'string (plain text, at most 6000 characters)', hash: 'string (sha256 of the stored description; send it back unchanged)', has_checklist: 'boolean' }],
          skipped: '"home_off" (only when the owner is not an active admin on the home view; then items is [])',
        },
        responseNotes: 'Owner only; takes no user id. Only the owner\'s open tasks whose description is over 120 words and whose stored hash is not the current one. Tasks under a keeper hold and Bast\'s own tasks are left out. In view first, then by rank. Writes nothing.',
      },
      {
        method: 'POST',
        summary: 'Chat lane: save Bast\'s short versions of long home cards (the crontab wrapper)',
        auth: 'required',
        roles: WORKER,
        bodySchema: [
          { name: 'items', type: 'object', required: true, description: 'At most 40 of {item_key, hash, summary, done_when?: string[]}. Strict: any other field is 400.' },
        ],
        responseExample: {
          dry_run: 'false',
          skipped_all: '"home_off" (the owner is not on the home view; nothing written)',
          saved: 'number',
          refused: [{ item_key: 'string', reason: '"empty"|"too_long"|"dash"|"banned_word"|"bad_done_when"' }],
          skipped: [{ item_key: 'string', reason: '"duplicate"|"not_found"|"not_long"|"stale_hash"|"held"|"unchanged"|"changed"' }],
          action_id: 'string (uuid)|null (one home_actions row for the whole save)',
          line: 'string|null (the quiet line Mike sees)',
        },
        responseNotes: 'Owner only. A summary over 60 words, or with a dash, "priority", "priorities" or "overdue", is refused and listed; the others are saved. An item whose hash no longer matches the description is skipped. Writes only the owner\'s home_item_state card fields and one home_actions row (source keeper, undo open 72 hours); never a task, arc, email ask, wait, comment or notification, and sends nothing.',
      },
    ],
  },
  {
    path: '/api/bast-chat/worker/home-keeper/learn',
    group: 'bast-chat',
    methods: [
      {
        method: 'GET',
        summary: 'Chat lane: the weekly measures and the approval-speed guard as a dry run',
        auth: 'required',
        roles: WORKER,
        responseExample: {
          dry_run: 'true',
          date: 'string (YYYY-MM-DD, his day)',
          monday: 'boolean',
          daily: { date: 'string', open_items: 'number', past_day: 'number', owed: [{ key: 'string', label: 'string', age_bd: 'number' }] },
          week: '{week_start, week_end, measures, guard}|null (null except on his Monday)',
          lines: [{ action: '"keeper_measures"|"keeper_guard"|"keeper_learned"', line: 'string', details: ['string'] }],
          learned: [{ evidence_key: 'string', label: 'string', dir: '"up"|"down"', line: 'string' }],
          skipped: '"home_off" (only when the owner is not an active admin on the home view)',
          action_ids: '[] (always empty here)',
        },
        responseNotes: 'Owner only; takes no user id. Writes nothing. On his Monday, with Learn from my taps on, lines also holds the keeper_learned lines this run would write (at most 3; learned names the evidence, never a weight). A sentence of the Monday line appears only when its measure has at least 5 business days of data; with none, lines holds no keeper_measures line.',
      },
      {
        method: 'POST',
        summary: 'Chat lane: the learn step, the real run (the crontab wrapper)',
        auth: 'required',
        roles: WORKER,
        responseExample: {
          dry_run: 'false',
          date: 'string',
          monday: 'boolean',
          daily: { date: 'string', open_items: 'number', past_day: 'number', owed: ['object'] },
          week: 'object|null',
          lines: [{ action: '"keeper_measures"|"keeper_guard"|"keeper_learned"', line: 'string', details: ['string'] }],
          learned: [{ evidence_key: 'string', label: 'string', dir: '"up"|"down"', line: 'string' }],
          already_ran: 'true (this day already has a learn row; nothing written)',
          skipped: '"home_off"',
          action_ids: ['string (uuid, one home_actions row per line)'],
        },
        responseNotes: 'Strict empty body {}. Owner only. Once per zoned day. Writes only the owner\'s home_measures, one home_keeper_runs row of kind learn and home_actions lines (source keeper; the measures and guard lines have no Undo, a keeper_learned line has Undo for 7 days) and, on his Monday only, the owner\'s home_score_weights rows (at most 3 a week, 5 at a time). A weight changes order inside a class only, never an emergency, a class or a hard date. It changes no task, email ask, wait or project and no ranking outside those caps, task, email ask, wait or project, and sends nothing.',
      },
    ],
  },
  {
    path: '/api/bast-chat/worker/owed',
    group: 'bast-chat',
    methods: [
      {
        method: 'GET',
        summary: 'Chat lane: the owner\'s owed-reply drafting queue (the machine\'s work list and dry run)',
        auth: 'required',
        roles: WORKER,
        queryParams: [
          { name: 'limit', type: 'number', required: false, description: 'At most this many items (1 to 6; default and cap 6)' },
          {
            name: 'caps',
            type: 'string',
            required: false,
            description:
              'Slice 4c: what the caller\'s drafter can serve, comma separated from short, auto, joins. Without it the items have the 4a shape and the request is never "short" or "auto". "short" allows request "short" and adds full_draft_text; "auto" allows request "auto"; "joins" adds joined.',
          },
        ],
        responseExample: {
          items: [
            {
              thread_key: 'string (thread:<account>:<thread_id>)',
              account: 'string',
              thread_id: 'string',
              ask_ids: ['string (uuid, every open ask on the thread, newest first)'],
              newest: { ask_id: 'string (uuid)', gmail_id: 'string', from_email: 'string', from_name: 'string|null', subject: 'string', received_at: 'ISO-8601', intent: 'string|null' },
              client_name: 'string|null',
              lead: 'boolean',
              request: '"draft"|"read"|"go_with_that"|null (a tap, or a clock waiting); also "short" (a two-line holding draft from full_draft_text) and "auto" (draft once along suggested_answer; never when it needs a commitment) only with caps=short / caps=auto',
              suggested_answer: 'string|null',
              bast_draft: '{draft_id, draft_hash, for_ask_id}|null (Bast\'s own Gmail draft on this thread)',
              full_draft_text: 'string|null (only with caps=short: Bast\'s current full draft, sent with a "short" request)',
              joined: '[{account, thread_id}] (only with caps=joins: other threads Citadel already knows are joined to this one; may be empty)',
            },
          ],
          skipped: '"home_off" (only when the owner is not an active admin on the home view; then items is [])',
        },
        responseNotes: 'Owner only; takes no user id. In order: taps, redrafts, clocks (day-5 read, lead refresh), leads, the oldest thread, then auto and short requests last. Joined threads show as one item (the thread whose newest message is newest). Writes nothing.',
      },
      {
        method: 'POST',
        summary: 'Chat lane: save the owed-reply drafter\'s results (the crontab wrapper)',
        auth: 'required',
        roles: WORKER,
        bodySchema: [
          { name: 'items', type: 'object', required: true, description: 'At most 10 of {thread_key, newest_ask_id, outcome: "drafted", draft_id, draft_message_id, draft_text, model, cost_usd?} | {..., outcome: "needs_thought", read, suggested_answer|null, needs_commitment, model, cost_usd?} | {..., outcome: "mike_edited"} | {..., outcome: "failed", error} | {..., outcome: "short_drafted", short_draft_id, short_draft_text, model, cost_usd?} | {..., outcome: "replied_elsewhere", replied_from, replied_at}. Any item may carry joins: [{account, thread_id}] (threads the mirror shows share an RFC Message-ID with this one). Strict: any other field is 400. Body at most 64 KB.' },
        ],
        responseExample: {
          saved: [{ thread_key: 'string', outcome: '"drafted"|"needs_thought"|"mike_edited"|"failed"|"short_drafted"|"replied_elsewhere"' }],
          refused: [{ thread_key: 'string', reason: '"draft_money"|"draft_time"|"draft_scope"|"draft_shape"|"read_shape"|"suggested_money"|"suggested_time"|"suggested_scope"|"suggested_shape"|"short_money"|"short_time"|"short_scope"|"short_shape"|"stale"|"stale_draft"|"duplicate"|"no_draft"|"bad_replied_at"|"bad_key"', status: '409 (only on "stale")' }],
          action_id: 'string (uuid)|null (one keeper home_actions row when something was drafted)',
          line: 'string|null (the quiet line Mike sees)',
          skipped: '"home_off" (the owner is not on the home view; nothing written)',
        },
        responseNotes: 'Owner only. The commitment checks run again here; a body, read or suggested answer that fails is refused and listed. A short draft is checked the same way with the tighter cap (at most 2 sentences and 40 words) and needs Bast\'s full draft on the row. A newest_ask_id that is no longer the newest open ask on the thread is refused 409 stale and nothing is written for it. joins store joined_to_key on the non-primary rows (the primary is the thread whose newest inbound message is newest); a replied_elsewhere item hides the conversation until a newer message from them and writes one keeper line. Writes only the owner\'s home_owed_thread rows, one home_keeper_runs row per day (kind owed_reply) and one home_actions row (source keeper); never an email ask, task or outbox row, and nothing is sent.',
      },
    ],
  },
  {
    path: '/api/bast-chat/worker/home-watch',
    group: 'bast-chat',
    methods: [
      {
        method: 'GET',
        summary: 'Chat lane: the sites the site-down second check should look at, and the owner\'s open site incidents (dry run)',
        auth: 'required',
        roles: WORKER,
        responseExample: {
          dry_run: true,
          checks: [{ key: 'string (site:<uuid>)', site_id: 'string (uuid)', domain: 'string (host of a Site of an active client)' }],
          open: [{ key: 'string', site_id: 'string (uuid)', domain: 'string', source: '"kuma"|"uptime_mail"', started_at: 'ISO-8601', last_checked_at: 'ISO-8601|null', last_check_up: 'boolean|null', ask_ids: ['string (uuid)'] }],
          would_post: [{ id: 'string (<row id>:<kind>, or new:<item key> for an item not tracked yet)', kind: '"first"|"again"|"lifeline"', text: 'string (one plain line)' }],
          skipped: '"home_off" (only when the owner is not an active admin on the home view; then checks, open and would_post are [])',
        },
        responseNotes: 'Owner only; takes no user id. Lists only hosts of Sites of active clients; no domain taken from mail text is ever listed. would_post is what a real run would hand out now (at most 6; [] when the owner\'s emergency_slack switch is off). Writes nothing.',
      },
      {
        method: 'POST',
        summary: 'Chat lane: save one site-down check report (the crontab wrapper)',
        auth: 'required',
        roles: WORKER,
        bodySchema: [
          { name: 'kuma', type: 'object', required: false, description: 'null (the watchdog state could not be read, nothing is closed) or at most 200 of {monitor, domain, client_id?, started, escalated?}.' },
          { name: 'checks', type: 'object', required: false, description: 'At most 100 of {key: "site:<uuid>", up, summary? (500 at most), checked_at}. Strict: any other field is 400. Body at most 64 KB.' },
          { name: 'caps', type: 'string[]', required: false, description: 'What the script can do. Lines are handed out only when this lists "slack" (at most 10 entries). The 6a script sends none.' },
        ],
        responseExample: { lines: [{ id: 'string (<row id>:<kind>)', kind: '"first"|"again"|"lifeline"', text: 'string (one plain line, for Mike only)' }], counts: { opened: 0, updated: 0, closed: 0, ignored: 0 }, skipped: '"home_off" (nothing written)' },
        responseNotes: 'Owner only. Also tracks the owner\'s Needs you now on every run (home_emergency_watch). lines holds at most 6 and is non-empty only when the owner\'s emergency_slack switch is on and the body carries caps ["slack"]; each returned line is marked claimed at that moment, a claimed line not acknowledged within 15 minutes is offered once more, then never again. Writes only the owner\'s home_site_incident rows, home_emergency_watch rows and their "answers again" home_actions lines; never an email ask, task, site or outbox row, and nothing is requested or sent. A check for a site that was not asked about is ignored.',
      },
    ],
  },
  {
    path: '/api/bast-chat/worker/home-watch/ack',
    group: 'bast-chat',
    methods: [
      {
        method: 'POST',
        summary: 'Chat lane: acknowledge the Slack lines the machine posted (stops them being offered again)',
        auth: 'required',
        roles: WORKER,
        bodySchema: [{ name: 'ids', type: 'string[]', required: true, description: '1 to 20 line ids from the lines of a home-watch run. Strict: any other field is 400. Body at most 8 KB.' }],
        responseExample: { acked: 1, ignored: 0 },
        responseNotes: 'Owner only. An id that is unknown, malformed or not the owner\'s changes nothing (counted in ignored). Writes only the owner\'s home_emergency_watch rows; nothing is sent.',
      },
    ],
  },
  {
    path: '/api/bast-chat/worker/ops',
    group: 'bast-chat',
    methods: [
      {
        method: 'POST',
        summary: 'Chat daemon: one named operation on the owner\'s home screen, a task comment, an email ask, a wait or a project, or the start of a project or a quote',
        auth: 'required',
        roles: WORKER,
        bodySchema: [
          { name: 'conversation_id', type: 'uuid', required: true, description: 'The owner\'s conversation; it must not be closed' },
          { name: 'op', type: 'string', required: true, description: 'home | comment | email_ask | wait | project | start_project | start_quote (anything else is 400)' },
          { name: 'input', type: 'object', required: true, description: 'Strict per op. home: the home screen\'s own act body, one of {action: not_now|matters_more|not_emergency|done_pin|stop (+ note: string|null)|pin (+ switch?)|arc_add (+ group_key, origin: in_view|search|created)|arc_remove (+ group_key)|arc_reorder (group_key, step_keys)|swap|lighter (to_group_key)}, item_key from today. comment: {task_id, text (max 2000)}. email_ask: {ask_id, state: handled|dismissed|open}. wait: {wait_id, action: redate (due_at) | extend (business_days 1 to 15, or until) | pause (until) | resume | reassign (owner_user_id) | complete | cancel}. project: {project_id, status: quote|queue|ready|in_progress|review|done|suspended|cancelled}. start_project: {client_id | new_client (exactly one), what (max 2000), name? (max 255), site? (id or name among the client\'s sites), message (the owner\'s words, max 4000)}. start_quote: {client_id | lead_name | lead_business | lead_email | email_ask_id (at least one; client_id not with lead_*), what (max 2000), message (max 4000)}. A user or owner id anywhere is 400.' },
        ],
        responseExample: { action_id: 'uuid', status: 'applied', line: 'string (the sentence Mike sees)', undo_until: 'ISO-8601|null', can_undo: 'boolean', result: 'object (small: ids and the new state)' },
        responseNotes: 'Strict body, 256 KB cap. 200 when written and recorded (one write counted). 202 {action_id, status: "proposed", proposal_kind: bast_start|client_show, line} with header X-Bast-Chat-Action when the change would start Bast or show a client something: nothing is written but the proposal (one write counted), and Mike\'s tap decides. 400 unknown op, extra fields, a bad shape. 404 a conversation that is not the owner\'s. 409 a conversation that is not running (closed, idle or queued: Open the chat first), the chat switched off, a home screen that is off, a change since the read, a no-op. 429 daily limit. Every failure is {error}. The owner is always the configured owner. Undo is the panel\'s (owner session). A finished wait (complete, cancel) cannot be undone: can_undo is false and the line says so. Completing a wait opens the next step of its chain, so it is a proposal when that step is Bast\'s or sends to a client. Reopening an email ask does not restore the draft marker and link, and the line says so. A comment is always internal and written as Bast. start_project applies at once in one transaction: an optional new client (name only; refused when an active client has that name), a project in status queue (hidden from the client; no billing, budget, rate or plan folder) and a kickoff task for the owner (tags from-chat, kickoff; no project; checklist of three lines); result {project_id, task_id, client_id, client_created, site_id}; the chat record has target_type project_start; Undo (24 h) cancels the project and abandons the task only while the project is still queue and the task is still the owner\'s, not started, with nothing waiting on it; a created client stays. start_quote applies at once: a deal (Accord, status lead, owner the owner, no value, no Proposal) and a pricing task for the owner (tags from-chat, quote; linked to the deal; no project); with email_ask_id the sender, subject and thread come from that email ask on the server; result {deal_id, task_id, client_id}; target_type quote_start; Undo marks the deal lost (reason: Started by mistake from the chat) and abandons the task under the same condition. Neither sends anything or sets a price.',
      },
    ],
  },
];
