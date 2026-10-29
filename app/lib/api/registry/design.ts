import type { ApiEndpoint, ParamDef } from './index';

/**
 * Designer Portal (design section 7): every route under app/api/design/**. Roles are the DB roles the route
 * enforces (designer = own sessions only; pm = read-only where a route allows it). The design worker is a
 * service API key on the design-worker lane (requireWorker), not a user role. Every non-worker route needs a
 * signed-in session (API keys get 403 session_required, W8.2 H7), except the routes listed in lib/design/operator.ts,
 * which also accept an admin's design:operator-setup or design:operator-publish key (Mike, 2026-10-29; granted
 * only from a signed-in admin session, never on a lane key). A designer acts only while she is on the session's project
 * (removed = 404), and designer bodies are strict (an unknown field is 400).
 * The publish lane is two steps: POST publishes/intent (step 1) then POST publishes/:id/confirm (step 2).
 */

const DESIGNER = ['designer', 'admin'];
const READERS = ['designer', 'admin', 'pm'];
const ADMIN = ['admin'];
const ADMIN_PM = ['admin', 'pm'];
const WORKER = ['design-worker'];

const sessionIdParam: ParamDef = { name: 'id', type: 'uuid', required: true, description: 'Design session id (path)' };

const sessionExample = {
  id: 'uuid',
  task_id: 'uuid',
  site_id: 'uuid',
  project_id: 'uuid|null',
  designer_id: 'uuid',
  status: 'pending|active|awaiting_input|paused_budget|stopped|publishing|closed|abandoned',
  stale: 'boolean',
  branch: 'string',
  preview_alias: 'string',
  preview_url: 'string|null',
  preview_sha: 'string|null',
  base_sha: 'string|null',
  head_sha: 'string|null',
  cost_usd: 'number',
  budget_usd: 'number',
  live_text: 'string|null',
  live_action: 'string|null',
  last_seq: 'number',
  last_heartbeat_at: 'ISO-8601|null',
  last_turn_at: 'ISO-8601|null',
  lib_index: 'object|null',
  diff_summary: 'object|null',
  diff_asset_id: 'uuid|null',
  publish_requested_at: 'ISO-8601|null',
  last_publish_id: 'uuid|null',
  publish_precheck: { head_sha: 'string', gates_ok: 'boolean', gates: 'object[]', files_changed: 'number', pages_affected: 'string[]' },
  created_at: 'ISO-8601',
  updated_at: 'ISO-8601',
  closed_at: 'ISO-8601|null',
};

const pinExample = {
  id: 'uuid',
  status: 'pending|sent|resolved|followup|discarded',
  note: 'string',
  page_path: 'string',
  data_lib: 'string|null',
  lib_stack: 'string[]',
  data_shape: 'string|null',
  selector: 'string',
  tag: 'string|null',
  classes: 'string[]',
  text_quote: 'string|null',
  bbox: { x: 'number', y: 'number', w: 'number', h: 'number' },
  viewport_width: 'number',
  viewport_height: 'number|null',
  blast_radius: { pages: 'number', sample: 'string[] (<=5 page paths)' },
  preview_sha: 'string|null',
  crop_asset_id: 'uuid|null',
  apply_event_seq: 'number|null',
  followup_task_id: 'uuid|null',
  created_at: 'ISO-8601',
  updated_at: 'ISO-8601',
};

const changeExample = {
  id: 'uuid',
  apply_event_seq: 'number|null',
  commit_sha: 'string',
  parent_sha: 'string|null',
  summary: 'string',
  files: 'string[]',
  data_libs: 'string[]',
  pages: 'string[]',
  render_count: 'number|null',
  edit_scope: "'instance'|'component'|null",
  pin_ids: 'uuid[]',
  before_asset_ids: 'uuid[]',
  after_asset_ids: 'uuid[]',
  gates: 'object[]|null',
  is_restore: 'boolean',
  restored_from: 'string|null',
  decision: 'pending|accepted|denied',
  designer_note: 'string|null',
  decided_at: 'ISO-8601|null',
  created_at: 'ISO-8601',
};

const publishExample = {
  id: 'uuid',
  session_id: 'uuid',
  site_id: 'uuid',
  task_id: 'uuid',
  kind: 'publish|rollback',
  rolls_back_id: 'uuid|null',
  actor_id: 'uuid',
  actor_role: 'string',
  publish_mode: 'per_site|pre_launch_only|off',
  main_role: 'client_preview|production',
  site_designer_publish: 'boolean',
  confirmation_shown: 'object|null',
  confirmation_typed: 'string|null',
  confirm_requested_at: 'ISO-8601|null',
  confirmed_at: 'ISO-8601|null',
  status: 'awaiting_confirmation|expired|queued|running|published|blocked_gates|blocked_policy|conflict|failed|rolled_back',
  head_sha: 'string|null',
  from_main_sha: 'string|null',
  result_sha: 'string|null',
  deploy_id: 'string|null',
  deploy_url: 'string|null',
  alias_url: 'string|null',
  gates: 'object[]|null',
  diff_summary: 'object|null',
  change_ids: 'uuid[]',
  cost_usd: 'number|null',
  error: 'string|null',
  notified_at: 'ISO-8601|null',
  rolled_back_at: 'ISO-8601|null',
  rolled_back_by_id: 'uuid|null',
  created_at: 'ISO-8601',
  started_at: 'ISO-8601|null',
  finished_at: 'ISO-8601|null',
};


const workerSessionExample = {
  id: 'uuid',
  task_id: 'uuid',
  site_id: 'uuid',
  status: 'pending|active|awaiting_input|paused_budget|stopped|publishing|closed|abandoned',
  sdk_session_id: 'string|null',
  cost_usd: 'number',
  budget_usd: 'number',
  branch: 'string',
  preview_alias: 'string',
  worktree_path: 'string|null',
  base_sha: 'string|null',
  head_sha: 'string|null',
  preview_url: 'string|null',
  preview_deploy_url: 'string|null',
  preview_sha: 'string|null',
  model: 'string',
  effort: 'low|medium|high|xhigh|max',
  last_publish_id: 'uuid|null',
  last_seq: 'number',
  lib_index: 'object|null',
  diff_summary: 'object|null',
  publish_precheck: 'object|null',
};

const feedExample = {
  events: [{ seq: 'number', role: 'designer|assistant|tool|system', kind: 'text|apply|thought|action|result|screenshot|gate|cost|plan|status|followup|client_files|change|publish (lib_index events are not listed)', payload: 'object', created_at: 'ISO-8601' }],
  live: { text: 'string|null', action: 'string|null' },
  status: 'string',
  stale: 'boolean',
  publish: {
    can_publish: 'boolean',
    reason: 'string (only when can_publish is false)',
    main_role: 'client_preview|production',
    precheck: 'object|null',
    running_publish_id: 'uuid (only while one is running)',
  },
  timer: { running: 'boolean', elapsed_s: 'number' },
  cost_usd: 'number',
  budget_usd: 'number',
  preview_url: 'string|null',
  preview_sha: 'string|null',
  head_sha: 'string|null',
  lib_index_sha: 'string|null',
  last_heartbeat_at: 'ISO-8601|null',
  next_poll_ms: 'number',
  last_seq: 'number',
  has_more: 'boolean',
};

const budgetPutBody: ParamDef[] = [
  { name: 'monthly_cap_usd', type: 'number', required: false, description: 'Monthly spend cap in USD (0 to 100000), or null to clear' },
  { name: 'session_raise_cap_usd', type: 'number', required: false, description: 'Per-session raise cap in USD (0 to 5000), or null to clear' },
];

const settingsPatchBody: ParamDef[] = [
  { name: 'enabled', type: 'boolean', required: false, description: 'Designer Portal on/off' },
  { name: 'owner_user_id', type: 'uuid', required: false, description: 'Active user who owns publish notices; null clears' },
  { name: 'designer_publish_mode', type: 'string', required: false, description: 'per_site | pre_launch_only | off' },
  { name: 'confirmation_ttl_minutes', type: 'number', required: false, description: 'Publish confirmation window, 1 to 60' },
  { name: 'default_session_budget_usd', type: 'number', required: false, description: 'Default session budget, 0.01 to 1000' },
  { name: 'designer_raise_cap_usd', type: 'number', required: false, description: 'Max a designer may raise one session, 0.01 to 1000 (must not exceed hard_session_cap_usd)' },
  { name: 'hard_session_cap_usd', type: 'number', required: false, description: 'Absolute session cap, 0.01 to 5000' },
  { name: 'default_monthly_cap_usd', type: 'number', required: false, description: 'Default monthly cap per designer, or null' },
  { name: 'model', type: 'string', required: false, description: 'Worker model: opus, sonnet, haiku or a full id (claude-opus-*, claude-sonnet-*, claude-haiku-*), case-insensitive; anything else (best, default, fable, mythos) is 400' },
  { name: 'effort', type: 'string', required: false, description: 'low | medium | high | xhigh | max' },
  { name: 'idle_close_minutes', type: 'number', required: false, description: 'Idle minutes before auto-close, 1 to 240' },
  { name: 'auto_timer_enabled', type: 'boolean', required: false, description: 'Automatic time tracking while a designer is present' },
  { name: 'auto_timer_lapse_minutes', type: 'number', required: false, description: 'Minutes of absence before the auto timer stops, 1 to 60' },
  { name: 'auto_timer_billable', type: 'boolean', required: false, description: 'Deprecated, ignored. Auto entries are billable only for ad-hoc work (task without a project) of a client with no retainer; otherwise non-billable' },
  { name: 'max_live_sessions', type: 'number', required: false, description: 'Concurrent live sessions, 1 to 20' },
];

const pinPostBody: ParamDef[] = [
  { name: 'type', type: 'string', required: false, description: 'Literal dp:packet when sent by the overlay' },
  { name: 'path', type: 'string', required: true, description: 'Page path, starts with a single /' },
  { name: 'sha', type: 'string', required: false, description: 'Preview commit sha, max 64 chars, or null' },
  { name: 'data_lib', type: 'string', required: false, description: 'Registry id of the data-lib component, or null' },
  { name: 'lib_stack', type: 'string[]', required: false, description: 'Up to 8 library ids' },
  { name: 'data_shape', type: 'string', required: false, description: 'Shape attribute, max 60 chars (stored 50)' },
  { name: 'selector', type: 'string', required: true, description: 'CSS selector, 1 to 500 chars' },
  { name: 'tag', type: 'string', required: true, description: 'Element tag, 1 to 40 chars' },
  { name: 'classes', type: 'string[]', required: false, description: 'Up to 20 class names' },
  { name: 'text_quote', type: 'string', required: false, description: 'Quoted element text, max 200 chars, or null' },
  { name: 'bbox', type: 'object', required: true, description: '{x, y, w, h} finite numbers' },
  { name: 'viewport', type: 'object', required: true, description: '{w, h} integers, 1 to 10000' },
  { name: 'note', type: 'string', required: false, description: 'Designer note, max 4000 chars' },
];

const applyBody: ParamDef[] = [
  { name: 'client_ref', type: 'uuid', required: true, description: 'Idempotency key; a repeat returns 200' },
  { name: 'pin_ids', type: 'uuid', required: true, description: 'Unique pin ids to apply, 1 to MAX_APPLY_PINS' },
  { name: 'note', type: 'string', required: false, description: 'Designer note, max 4000 chars' },
  { name: 'files', type: 'object', required: false, description: 'Client-folder files attached: [{id, name, mime}] (max MAX_APPLY_FILES)' },
  { name: 'allow_stale', type: 'boolean', required: false, description: 'Apply even when pins point at a stale preview' },
];

const publishIntentBody: ParamDef[] = [
  { name: 'head_sha', type: 'string', required: true, description: 'Git commit sha, 7 to 64 hex chars' },
];

const confirmBody: ParamDef[] = [
  { name: 'confirmation_token', type: 'string', required: false, description: 'One-time token from step 1 (max 200 chars)' },
  { name: 'typed_confirmation', type: 'string', required: false, description: 'The typed main branch name (max 100 chars)' },
];

const workerPublishPatchBody: ParamDef[] = [
  { name: 'status', type: 'string', required: true, description: 'running | published | blocked_gates | conflict | failed' },
  { name: 'from_main_sha', type: 'string', required: false, description: 'Main sha the merge started from' },
  { name: 'result_sha', type: 'string', required: false, description: 'Sha of the published tree' },
  { name: 'deploy_id', type: 'string', required: false, description: 'Deploy id, max 128 chars' },
  { name: 'deploy_url', type: 'string', required: false, description: 'Deploy URL' },
  { name: 'alias_url', type: 'string', required: false, description: 'Alias URL' },
  { name: 'gates', type: 'object', required: false, description: 'Gate results, max 32 KB' },
  { name: 'diff_summary', type: 'object', required: false, description: 'Diff summary, max 32 KB' },
  { name: 'change_ids', type: 'uuid', required: false, description: 'Change ids included in this publish' },
  { name: 'error', type: 'string', required: false, description: 'Error text, max 4000 chars' },
];

export const designEndpoints: ApiEndpoint[] = [
  // ---- Designer workspace: sessions, tasks, feed, pins, changes ----
  {
    path: '/api/design/tasks',
    group: 'design',
    methods: [
      {
        method: 'GET',
        summary: 'Designer Portal drawer: tasks the caller may open a design session on. Designers see their own visible tasks; admin and pm see all.',
        auth: 'required',
        roles: ['designer', 'admin', 'pm'],
        queryParams: [{ name: 'project_id', type: 'uuid', required: false, description: 'Limit to one project' }],
        responseExample: {
          tasks: [{ id: 'uuid', title: 'string', project: { id: 'uuid', name: 'string' }, site: { id: 'uuid', name: 'string' }, session: { id: 'uuid', status: 'string' } }],
          sites: [{ id: 'uuid', name: 'string' }],
        },
        responseNotes: 'Only tasks on design-enabled eleventy sites in visible project statuses appear. Done and abandoned tasks are excluded.',
      },
    ],
  },
  {
    path: '/api/design/sessions/:id/site-tasks',
    group: 'design',
    methods: [
      {
        method: 'GET',
        summary: 'Open tasks on the session\'s site (the workspace Tasks tab). Signed-in session only (API keys 403). A designer sees tasks on projects she is on; admin and pm see all. Another designer\'s session is 404.',
        auth: 'required',
        roles: ['designer', 'admin', 'pm'],
        queryParams: [sessionIdParam, { name: 'mine', type: 'string', required: false, description: '"1" = only tasks assigned to the caller' }],
        responseExample: { tasks: [{ id: 'uuid', title: 'string', status: 'string', due_date: 'iso|null', description: 'string|null (max 1000)', assignee_first_name: 'string|null', mine: true, project: { id: 'uuid', name: 'string' } }], mine: true },
        responseNotes: 'Explicit field allowlist: no billing, time, estimate or client fields. At most 100 tasks.',
      },
    ],
  },
  {
    path: '/api/design/sessions',
    group: 'design',
    methods: [
      {
        method: 'GET',
        summary: 'List the caller\'s design sessions (designers see their own, admin sees all). Signed-in session only (API keys 403). pm and tech get 403.',
        auth: 'required',
        roles: DESIGNER,
        queryParams: [{ name: 'status', type: 'string', required: false, description: 'Filter by DesignSessionStatus' }],
        responseExample: {
          sessions: [{
            id: 'uuid',
            task: { id: 'uuid', title: 'string' },
            site: { name: 'string' },
            status: 'string',
            last_publish: { id: 'uuid', status: 'string', finished_at: 'ISO-8601|null' },
            cost_usd: 'number',
            budget_usd: 'number',
            updated_at: 'ISO-8601',
          }],
        },
        responseNotes: 'Up to 200 sessions, newest first.',
      },
      {
        method: 'POST',
        summary: 'Create (or get) the design session for a task. Idempotent per task: 201 when created, 200 when it already exists.',
        auth: 'required',
        roles: DESIGNER,
        bodySchema: [{ name: 'task_id', type: 'uuid', required: true, description: 'Task to design on' }],
        responseNotes: 'Returns { session } in the projectSession shape. The daemon builds the worktree asynchronously (status pending).',
      },
    ],
  },
  {
    path: '/api/design/work',
    group: 'design',
    methods: [
      {
        method: 'POST',
        summary: 'Start new design work on a site that has no task yet: creates a task on the site\'s open project, assigned to the caller, then its design session. Signed-in session only (API keys 403).',
        auth: 'required',
        roles: DESIGNER,
        bodySchema: [
          { name: 'site_id', type: 'uuid', required: true, description: 'A design-enabled eleventy site (a designer must be on a project for it)' },
          { name: 'title', type: 'string', required: true, description: 'What needs doing, max 120 characters' },
          { name: 'detail', type: 'string', required: false, description: 'More detail, max 2000 characters' },
        ],
        responseExample: { session_id: 'uuid' },
        responseNotes: '201. 404 unknown site or designer not on a project for it; 409 site not design-enabled or not eleventy, portal off, site not served by the box, or no open project (ready, in_progress or review) for the site. The task carries tag design-work.',
      },
    ],
  },
  {
    path: '/api/design/sessions/:id',
    group: 'design',
    methods: [
      {
        method: 'GET',
        summary: 'Full workspace load for one design session: session, task, site, pins, changes and worker state. Designer (own), admin, pm (read-only). Also accepts an admin\'s design:operator-publish API key, which acts as an admin publisher on the same path (Bast on Mike\'s instruction; lib/design/operator.ts).',
        auth: 'required',
        roles: READERS,
        queryParams: [sessionIdParam],
        responseExample: {
          session: sessionExample,
          task: { id: 'uuid', title: 'string', description: 'object|null', requirements: 'object|null' },
          site: { name: 'string' },
          pins: [pinExample],
          changes: [changeExample],
          worker: { online: 'boolean', paused: 'boolean', pause_reason: 'string|null', last_heartbeat_at: 'ISO-8601|null' },
        },
        responseNotes: 'Discarded pins are excluded. Opening the workspace starts or resumes the automatic timer.',
      },
    ],
  },
  {
    path: '/api/design/sessions/:id/feed',
    group: 'design',
    methods: [
      {
        method: 'GET',
        summary: 'Poll the session feed after a sequence number. Also reports what the caller may do (publish gate) and the poll interval. Also accepts an admin\'s design:operator-publish API key, which acts as an admin publisher on the same path (Bast on Mike\'s instruction; lib/design/operator.ts).',
        auth: 'required',
        roles: READERS,
        queryParams: [
          sessionIdParam,
          { name: 'after', type: 'number', required: false, description: 'Return events with seq greater than this (default 0)' },
          { name: 'limit', type: 'number', required: false, description: 'Events per page, 1 to the feed maximum (default 200)' },
          { name: 'visible', type: 'boolean', required: false, description: 'Pass 1 when the tab is visible; keeps the automatic timer alive' },
        ],
        responseExample: feedExample,
        responseNotes: 'next_poll_ms is 1500 while active, pending or undelivered, otherwise 5000. Timer output is only running and elapsed_s.',
      },
    ],
  },
  {
    path: '/api/design/sessions/:id/messages',
    group: 'design',
    methods: [
      {
        method: 'POST',
        summary: 'Send a designer message (steering or chat) into the session. Idempotent on client_ref.',
        auth: 'required',
        roles: DESIGNER,
        queryParams: [sessionIdParam],
        bodySchema: [
          { name: 'client_ref', type: 'uuid', required: true, description: 'Client idempotency key' },
          { name: 'text', type: 'string', required: true, description: 'Message text, 1 to 8000 chars' },
        ],
        responseNotes: 'Returns { seq }. 201 when new, 200 on a repeat. 429 rate_limited past 30 designer messages (text or apply) per session per minute.',
      },
    ],
  },
  {
    path: '/api/design/sessions/:id/pins',
    group: 'design',
    methods: [
      {
        method: 'POST',
        summary: 'Create a pin from the preview overlay (dp:packet fields). The pin lands in the designer tray as pending.',
        auth: 'required',
        roles: DESIGNER,
        queryParams: [sessionIdParam],
        bodySchema: pinPostBody,
        responseNotes: 'Returns 201 { pin } in the projectPin shape.',
      },
    ],
  },
  {
    path: '/api/design/sessions/:id/apply',
    group: 'design',
    methods: [
      {
        method: 'POST',
        summary: 'Apply pending pins: checks budget and stale pins, then records one apply event for the daemon.',
        auth: 'required',
        roles: DESIGNER,
        queryParams: [sessionIdParam],
        bodySchema: applyBody,
        responseNotes: 'Returns { seq }: 201 when applied, 200 on a repeat client_ref. Refusals return the ApplyRefusal body and status.',
      },
    ],
  },
  {
    path: '/api/design/sessions/:id/assets/:assetId',
    group: 'design',
    methods: [
      {
        method: 'GET',
        summary: 'Stream one session asset (screenshot or text) from private storage. Anyone who may not see the session gets 404.',
        auth: 'required',
        roles: READERS,
        queryParams: [sessionIdParam, { name: 'assetId', type: 'uuid', required: true, description: 'Asset id (path)' }],
        responseExample: {
          note: 'Binary body, not JSON. Content-Type is image/png or text/plain; charset=utf-8, otherwise application/octet-stream.',
          status: 200,
          cache_control: 'private, max-age=3600',
        },
        responseNotes: 'Served inline with nosniff. Text is always served as text/plain.',
      },
    ],
  },
  {
    path: '/api/design/sessions/:id/budget',
    group: 'design',
    methods: [
      {
        method: 'POST',
        summary: 'Raise a session budget. Raises only: designers up to their raise cap, admin up to the hard session cap.',
        auth: 'required',
        roles: DESIGNER,
        queryParams: [sessionIdParam],
        bodySchema: [{ name: 'budget_usd', type: 'number', required: true, description: 'New budget in USD, greater than 0, max 100000' }],
        responseNotes: 'Returns { session } in the projectSession shape.',
      },
    ],
  },
  {
    path: '/api/design/sessions/:id/client-files/refresh',
    group: 'design',
    methods: [
      {
        method: 'POST',
        summary: 'Ask the daemon to re-list the client Drive folder. Idempotent while one refresh is pending.',
        auth: 'required',
        roles: DESIGNER,
        queryParams: [sessionIdParam],
        responseNotes: 'Returns 202 { command_id, created }. 409 when the session is closed.',
      },
    ],
  },
  {
    path: '/api/design/sessions/:id/publish',
    group: 'design',
    methods: [
      {
        method: 'POST',
        summary: 'Publish step 1 of 2: create a publish intent and a one-time confirmation token. Queues nothing; step 2 is publishes/:id/confirm. Also accepts an admin\'s design:operator-publish API key, which acts as an admin publisher on the same path (Bast on Mike\'s instruction; lib/design/operator.ts).',
        auth: 'required',
        roles: DESIGNER,
        queryParams: [sessionIdParam],
        bodySchema: publishIntentBody,
        responseNotes: 'Returns 201 with the confirmation token (only its sha256 is stored) and the exact confirm-dialog content. Signed-in session only, same-origin JSON.',
      },
    ],
  },
  {
    path: '/api/design/sessions/:id/request-publish',
    group: 'design',
    methods: [
      {
        method: 'POST',
        summary: 'Send an FYI publish request to the owner. Only where an admin override has turned designer publish off for this site.',
        auth: 'required',
        roles: DESIGNER,
        queryParams: [sessionIdParam],
        bodySchema: [{ name: 'note', type: 'string', required: false, description: 'Note to the owner, max 2000 chars' }],
        responseNotes: 'Returns 409 publish_allowed when the designer may already publish. Not an approval step.',
      },
    ],
  },
  {
    path: '/api/design/sessions/:id/restore',
    group: 'design',
    methods: [
      {
        method: 'POST',
        summary: 'Restore the worktree to an earlier commit of this session (DesignCommand restore).',
        auth: 'required',
        roles: DESIGNER,
        queryParams: [sessionIdParam],
        bodySchema: [{ name: 'to_sha', type: 'string', required: true, description: 'Commit sha, 7 to 64 hex chars; must belong to this session' }],
        responseNotes: 'Returns 202 { command_id }.',
      },
    ],
  },
  {
    path: '/api/design/sessions/:id/stop',
    group: 'design',
    methods: [
      {
        method: 'POST',
        summary: 'Stop the running turn (DesignCommand stop). Idempotent while one is pending.',
        auth: 'required',
        roles: DESIGNER,
        queryParams: [sessionIdParam],
        responseNotes: 'Returns 202 { command_id, created }. 409 when the session is closed.',
      },
    ],
  },
  {
    path: '/api/design/sessions/:id/close',
    group: 'design',
    methods: [
      {
        method: 'POST',
        summary: 'Close the session. The daemon does the real cleanup; when the daemon is offline the server closes it now (closed if any publish succeeded, otherwise abandoned).',
        auth: 'required',
        roles: DESIGNER,
        queryParams: [sessionIdParam],
        bodySchema: [{ name: 'reason', type: 'string', required: false, description: 'Reason, max 500 chars' }],
        responseNotes: 'Returns { session }. 409 publish_in_progress while a publish is running. Stops the automatic timer.',
      },
    ],
  },
  {
    path: '/api/design/pins/:id',
    group: 'design',
    methods: [
      {
        method: 'PATCH',
        summary: 'Edit a pin: note, or status pending | discarded | followup. Only pending pins change. followup_assign_to_me files a follow-up task.',
        auth: 'required',
        roles: DESIGNER,
        queryParams: [{ name: 'id', type: 'uuid', required: true, description: 'Pin id (path)' }],
        bodySchema: [
          { name: 'note', type: 'string', required: false, description: 'Note, max 4000 chars' },
          { name: 'status', type: 'string', required: false, description: 'pending | discarded | followup' },
          { name: 'followup_assign_to_me', type: 'boolean', required: false, description: 'Assign the follow-up task to the designer' },
        ],
        responseExample: { pin: pinExample },
        responseNotes: 'Another designer\'s pin is 404. Requires at least one of note or status.',
      },
    ],
  },
  {
    path: '/api/design/changes/:id',
    group: 'design',
    methods: [
      {
        method: 'PATCH',
        summary: 'Accept or deny a worker change. A denial reaches the worker as a designer event.',
        auth: 'required',
        roles: DESIGNER,
        queryParams: [{ name: 'id', type: 'uuid', required: true, description: 'Change id (path)' }],
        bodySchema: [
          { name: 'decision', type: 'string', required: true, description: 'accepted | denied' },
          { name: 'note', type: 'string', required: false, description: 'Designer note, max 4000 chars' },
        ],
        responseExample: { change: changeExample },
      },
    ],
  },

  // ---- Publishes ----
  {
    path: '/api/design/publishes/:id',
    group: 'design',
    methods: [
      {
        method: 'GET',
        summary: 'Publish page (the FYI notice target): what was confirmed and whether the caller may roll it back. Admin, pm, or the session designer; others 404. Also accepts an admin\'s design:operator-publish API key, which acts as an admin publisher on the same path (Bast on Mike\'s instruction; lib/design/operator.ts).',
        auth: 'required',
        roles: ADMIN_PM.concat('designer'),
        queryParams: [{ name: 'id', type: 'uuid', required: true, description: 'Publish id (path)' }],
        responseExample: {
          publish: publishExample,
          session: { id: 'uuid', task: { id: 'uuid', title: 'string' }, designer: { name: 'string' } },
          changes: [{ id: 'uuid', summary: 'string', data_libs: 'string[]', pages: 'string[]', before_asset_ids: 'uuid[]', after_asset_ids: 'uuid[]', decision: 'string' }],
          can_rollback: 'boolean',
          rollback_reason: 'string (only when can_rollback is false)',
        },
      },
    ],
  },
  {
    path: '/api/design/publishes/:id/confirm',
    group: 'design',
    methods: [
      {
        method: 'POST',
        summary: 'Publish step 2 of 2: confirm with the one-time token and the typed main branch name. Queues the publish and moves the session to publishing. Also accepts an admin\'s design:operator-publish API key, which acts as an admin publisher on the same path (Bast on Mike\'s instruction; lib/design/operator.ts).',
        auth: 'required',
        roles: DESIGNER,
        queryParams: [{ name: 'id', type: 'uuid', required: true, description: 'Publish id (path)' }],
        bodySchema: confirmBody,
        responseNotes: 'Returns 202. 400 when the token or typed name is missing; 409 when wrong, expired, reused, foreign, or when head, gates, main_role or live URL changed. Same actor as step 1.',
      },
    ],
  },
  {
    path: '/api/design/publishes/:id/rollback',
    group: 'design',
    methods: [
      {
        method: 'POST',
        summary: 'Roll back a site publish to the state before it. Admin or the original publish actor only; only the site\'s latest successful publish. Also accepts an admin\'s design:operator-publish API key, which acts as an admin publisher on the same path (Bast on Mike\'s instruction; lib/design/operator.ts).',
        auth: 'required',
        roles: DESIGNER,
        queryParams: [{ name: 'id', type: 'uuid', required: true, description: 'Publish id (path)' }],
        bodySchema: [{ name: 'reason', type: 'string', required: false, description: 'Reason, max 500 chars' }],
        responseNotes: 'Returns 202. pm gets 403; anyone else 404 (including a publisher no longer a designer or no longer on the project); a designer gets 403 designer_publish_off where designer publish is switched off for the site; 409 not_latest when this is not the latest successful publish.',
      },
    ],
  },
  {
    path: '/api/design/admin/publishes',
    group: 'design',
    methods: [
      {
        method: 'GET',
        summary: 'Read-only publish history across all sites. Admin and pm. Also accepts an admin\'s design:operator-setup API key (Bast; lib/design/operator.ts).',
        auth: 'required',
        roles: ADMIN_PM,
        queryParams: [
          { name: 'site_id', type: 'uuid', required: false, description: 'Filter by site' },
          { name: 'status', type: 'string', required: false, description: 'Filter by DesignPublishStatus' },
          { name: 'since', type: 'ISO-8601', required: false, description: 'Only publishes created at or after this date' },
        ],
        responseExample: {
          publishes: [{
            id: 'uuid',
            kind: 'publish|rollback',
            status: 'string',
            site: { name: 'string' },
            actor: { name: 'string', role: 'string' },
            main_role: 'client_preview|production',
            created_at: 'ISO-8601',
            finished_at: 'ISO-8601|null',
            deploy_url: 'string|null',
          }],
        },
        responseNotes: 'Up to 200 rows, newest first.',
      },
    ],
  },
  {
    path: '/api/design/admin/sessions',
    group: 'design',
    methods: [
      {
        method: 'GET',
        summary: 'Design session overview across designers and sites. Admin and pm; signed-in session only. Also accepts an admin\'s design:operator-setup API key (Bast; lib/design/operator.ts).',
        auth: 'required',
        roles: ADMIN_PM,
        queryParams: [
          { name: 'status', type: 'string', required: false, description: 'Filter by DesignSessionStatus' },
          { name: 'site_id', type: 'uuid', required: false, description: 'Filter by site' },
          { name: 'publish_requested', type: 'boolean', required: false, description: 'Pass true to show only sessions with a publish request' },
        ],
        responseExample: {
          sessions: [{
            id: 'uuid',
            task: { id: 'uuid', title: 'string' },
            site: { name: 'string' },
            designer: { name: 'string' },
            status: 'string',
            cost_usd: 'number',
            budget_usd: 'number',
            updated_at: 'ISO-8601',
            last_publish: { id: 'uuid', status: 'string', finished_at: 'ISO-8601|null' },
            publish_requested_at: 'ISO-8601|null',
            publish_precheck: 'object|null',
            timer: { running: 'boolean', elapsed_s: 'number' },
          }],
        },
        responseNotes: 'Up to 200 rows, most recently updated first.',
      },
    ],
  },

  // ---- Admin: budgets, settings, per-site and per-client/project switches ----
  {
    path: '/api/design/admin/budgets',
    group: 'design',
    methods: [
      {
        method: 'GET',
        summary: 'Designer budgets: each active designer (and anyone with a budget row) with this month\'s spend. Admin only, signed-in session. Also accepts an admin\'s design:operator-setup API key (Bast; lib/design/operator.ts).',
        auth: 'required',
        roles: ADMIN,
        responseExample: {
          budgets: [{
            user: { id: 'uuid', name: 'string' },
            monthly_cap_usd: 'number|null',
            session_raise_cap_usd: 'number|null',
            effective_session_raise_cap_usd: 'number',
            month_spend_usd: 'number',
          }],
        },
      },
    ],
  },
  {
    path: '/api/design/admin/budgets/:userId',
    group: 'design',
    methods: [
      {
        method: 'PUT',
        summary: 'Set one designer\'s budget caps. Admin only, signed-in session. Fields left out are unchanged. Also accepts an admin\'s design:operator-setup API key (Bast; lib/design/operator.ts).',
        auth: 'required',
        roles: ADMIN,
        queryParams: [{ name: 'userId', type: 'uuid', required: true, description: 'Designer user id (path)' }],
        bodySchema: budgetPutBody,
        responseExample: {
          budget: {
            user: { id: 'uuid', name: 'string' },
            monthly_cap_usd: 'number|null',
            session_raise_cap_usd: 'number|null',
          },
        },
      },
      {
        method: 'PATCH',
        summary: 'Same as PUT: merge the budget caps for one designer. Admin only, signed-in session. Also accepts an admin\'s design:operator-setup API key (Bast; lib/design/operator.ts).',
        auth: 'required',
        roles: ADMIN,
        queryParams: [{ name: 'userId', type: 'uuid', required: true, description: 'Designer user id (path)' }],
        bodySchema: budgetPutBody,
        responseExample: {
          budget: {
            user: { id: 'uuid', name: 'string' },
            monthly_cap_usd: 'number|null',
            session_raise_cap_usd: 'number|null',
          },
        },
      },
    ],
  },
  {
    path: '/api/design/admin/settings',
    group: 'design',
    methods: [
      {
        method: 'GET',
        summary: 'Designer Portal settings and live worker state. Admin only, signed-in session. Also accepts an admin\'s design:operator-setup API key (Bast; lib/design/operator.ts).',
        auth: 'required',
        roles: ADMIN,
        responseExample: {
          settings: {
            enabled: 'boolean',
            owner_user_id: 'uuid|null',
            designer_publish_mode: 'per_site|pre_launch_only|off',
            confirmation_ttl_minutes: 'number',
            default_session_budget_usd: 'number',
            designer_raise_cap_usd: 'number',
            hard_session_cap_usd: 'number',
            default_monthly_cap_usd: 'number|null',
            model: 'string',
            effort: 'low|medium|high|xhigh|max',
            idle_close_minutes: 'number',
            auto_timer_enabled: 'boolean',
            auto_timer_lapse_minutes: 'number',
            auto_timer_billable: 'boolean',
            max_live_sessions: 'number',
            updated_at: 'ISO-8601|null',
          },
          worker_state: {
            last_heartbeat_at: 'ISO-8601|null',
            version: 'string|null',
            sdk_version: 'string|null',
            paused: 'boolean',
            pause_reason: 'string|null',
            configured_site_ids: 'uuid[]',
            site_main_roles: 'object',
            site_live_urls: 'object',
            live_sessions: 'number',
          },
        },
        responseNotes: 'worker_state is null before the worker first heartbeats.',
      },
      {
        method: 'PATCH',
        summary: 'Update Designer Portal settings. Admin only, signed-in session. Any field may be left out; the model must be opus, sonnet, haiku or a full id of those. Also accepts an admin\'s design:operator-setup API key (Bast; lib/design/operator.ts).',
        auth: 'required',
        roles: ADMIN,
        bodySchema: settingsPatchBody,
        responseExample: {
          settings: {
            enabled: 'boolean',
            owner_user_id: 'uuid|null',
            designer_publish_mode: 'per_site|pre_launch_only|off',
            hard_session_cap_usd: 'number',
            designer_raise_cap_usd: 'number',
            model: 'string',
            effort: 'low|medium|high|xhigh|max',
            max_live_sessions: 'number',
            updated_at: 'ISO-8601|null',
          },
        },
        responseNotes: 'Refused 400 bad_caps when designer_raise_cap_usd exceeds hard_session_cap_usd, 400 bad_owner for an inactive owner.',
      },
    ],
  },
  {
    path: '/api/design/admin/sites',
    group: 'design',
    methods: [
      {
        method: 'GET',
        summary: 'Every live site with its design switches (design_portal_enabled, designer_publish, design_auto_timer), the effective designer-publish verdict and the site main_role. Admin and pm; signed-in session only. Also accepts an admin\'s design:operator-setup API key (Bast; lib/design/operator.ts).',
        auth: 'required',
        roles: ADMIN_PM,
        responseExample: {
          sites: [{
            id: 'uuid',
            name: 'string',
            url: 'string|null',
            design_portal_enabled: 'boolean',
            designer_publish: 'boolean',
            design_auto_timer: 'boolean',
            effective_designer_publish: 'boolean',
            main_role: 'client_preview|production',
          }],
        },
      },
    ],
  },
  {
    path: '/api/design/admin/sites/:id',
    group: 'design',
    methods: [
      {
        method: 'PATCH',
        summary: 'Set the design switches on one site: design_portal_enabled, designer_publish, design_auto_timer. The only writer of those fields. Admin only, signed-in session. Also accepts an admin\'s design:operator-setup API key (Bast; lib/design/operator.ts).',
        auth: 'required',
        roles: ADMIN,
        queryParams: [{ name: 'id', type: 'uuid', required: true, description: 'Site id (path)' }],
        bodySchema: [
          { name: 'design_portal_enabled', type: 'boolean', required: false, description: 'Site is available in the Designer Portal' },
          { name: 'designer_publish', type: 'boolean', required: false, description: 'Designers may publish this site themselves' },
          { name: 'design_auto_timer', type: 'boolean', required: false, description: 'Automatic time tracking for design sessions on this site' },
        ],
        responseExample: {
          site: {
            id: 'uuid',
            design_portal_enabled: 'boolean',
            designer_publish: 'boolean',
            design_auto_timer: 'boolean',
            effective_designer_publish: 'boolean',
            main_role: 'client_preview|production',
          },
        },
      },
    ],
  },
  {
    path: '/api/design/admin/clients/:id',
    group: 'design',
    methods: [
      {
        method: 'GET',
        summary: 'Read the Drive folder id on a client (the admin form twin of PATCH). Admin only, signed-in session. Also accepts an admin\'s design:operator-setup API key (Bast; lib/design/operator.ts).',
        auth: 'required',
        roles: ADMIN,
        queryParams: [{ name: 'id', type: 'uuid', required: true, description: 'Client id (path)' }],
        responseExample: { id: 'uuid', drive_folder_id: 'string|null' },
      },
      {
        method: 'PATCH',
        summary: 'Set or clear the Drive folder id on a client. The only writer of client.drive_folder_id. Admin only, signed-in session. Also accepts an admin\'s design:operator-setup API key (Bast; lib/design/operator.ts).',
        auth: 'required',
        roles: ADMIN,
        queryParams: [{ name: 'id', type: 'uuid', required: true, description: 'Client id (path)' }],
        bodySchema: [{ name: 'drive_folder_id', type: 'string', required: true, description: 'Drive folder id (20 to 100 chars of letters, digits, _ or -), or null to clear' }],
        responseExample: { client: { id: 'uuid', drive_folder_id: 'string|null' } },
      },
    ],
  },
  {
    path: '/api/design/admin/projects/:id',
    group: 'design',
    methods: [
      {
        method: 'GET',
        summary: 'Read the Drive folder id on a project (the admin form twin of PATCH). Admin only, signed-in session. Also accepts an admin\'s design:operator-setup API key (Bast; lib/design/operator.ts).',
        auth: 'required',
        roles: ADMIN,
        queryParams: [{ name: 'id', type: 'uuid', required: true, description: 'Project id (path)' }],
        responseExample: { id: 'uuid', drive_folder_id: 'string|null' },
      },
      {
        method: 'PATCH',
        summary: 'Set or clear the Drive folder id on a project. The only writer of project.drive_folder_id. Admin only, signed-in session. Also accepts an admin\'s design:operator-setup API key (Bast; lib/design/operator.ts).',
        auth: 'required',
        roles: ADMIN,
        queryParams: [{ name: 'id', type: 'uuid', required: true, description: 'Project id (path)' }],
        bodySchema: [{ name: 'drive_folder_id', type: 'string', required: true, description: 'Drive folder id (20 to 100 chars of letters, digits, _ or -), or null to clear' }],
        responseExample: { project: { id: 'uuid', drive_folder_id: 'string|null' } },
      },
    ],
  },

  // ---- Design worker lane (service API key, requireWorker) ----
  {
    path: '/api/design/worker/heartbeat',
    group: 'design',
    methods: [
      {
        method: 'POST',
        summary: 'Worker heartbeat: version, pause state, configured sites, live sessions. Design-worker lane only.',
        auth: 'required',
        roles: WORKER,
        bodySchema: [
          { name: 'version', type: 'string', required: false, description: 'Worker version, max 40 chars' },
          { name: 'sdk_version', type: 'string', required: false, description: 'Agent SDK version, max 40 chars' },
          { name: 'paused', type: 'boolean', required: false, description: 'Worker is paused' },
          { name: 'pause_reason', type: 'string', required: false, description: 'Pause reason, max 100 chars, or null' },
          { name: 'configured_site_ids', type: 'uuid', required: true, description: 'Sites this worker serves (max 500)' },
          { name: 'site_main_roles', type: 'object', required: false, description: 'Map of site id to main role' },
          { name: 'site_live_urls', type: 'object', required: false, description: 'Map of site id to live URL' },
          { name: 'sessions', type: 'object', required: false, description: 'Live sessions [{id, alive, status}] (max 100)' },
        ],
        responseNotes: 'Returns the recordHeartbeat result (worker state after the update).',
      },
    ],
  },
  {
    path: '/api/design/worker/inbox',
    group: 'design',
    methods: [
      {
        method: 'GET',
        summary: 'Worker inbox: pending commands, designer messages, and new sessions to start. Design-worker lane only.',
        auth: 'required',
        roles: WORKER,
        queryParams: [{ name: 'max', type: 'number', required: false, description: 'Maximum items, 1 to 200 (default 50)' }],
        responseExample: {
          commands: [{ id: 'uuid', session_id: 'uuid|null', verb: 'stop|publish|rollback|restore|close|resume|refresh_client_files|share_drive_folder|unshare_drive_folder', payload: 'object (share verbs: {folder_id, email, role: writer}; session_id is null for them)', status: 'pending|claimed|done|failed', publish: 'object|undefined' }],
          messages: [{ seq: 'number', session_id: 'uuid', text: 'string', created_at: 'ISO-8601' }],
          new_sessions: [{ id: 'uuid', task_id: 'uuid', site_id: 'uuid', status: 'pending' }],
          settings: { enabled: 'boolean', idle_close_minutes: 'number', max_live_sessions: 'number' },
        },
        responseNotes: 'Empty lists when the portal is disabled.',
      },
    ],
  },
  {
    path: '/api/design/worker/sessions',
    group: 'design',
    methods: [
      {
        method: 'GET',
        summary: 'Startup reconcile: the non-terminal design sessions Citadel believes are live. Design-worker lane only.',
        auth: 'required',
        roles: WORKER,
        queryParams: [{ name: 'status', type: 'string', required: false, description: 'Comma-separated non-terminal statuses (default: all live)' }],
        responseExample: { sessions: [workerSessionExample] },
        responseNotes: 'Up to 500 sessions, oldest first. 400 when a status is terminal or unknown.',
      },
    ],
  },
  {
    path: '/api/design/worker/sessions/:id',
    group: 'design',
    methods: [
      {
        method: 'GET',
        summary: 'One session as the worker sees it. Design-worker lane only.',
        auth: 'required',
        roles: WORKER,
        queryParams: [sessionIdParam],
        responseExample: { session: workerSessionExample },
      },
      {
        method: 'PATCH',
        summary: 'Worker writes session state: status (worker-owned transitions), sha and preview fields, cost, live text, diff and precheck. Design-worker lane only.',
        auth: 'required',
        roles: WORKER,
        queryParams: [sessionIdParam],
        bodySchema: [
          { name: 'status', type: 'string', required: false, description: 'pending | active | awaiting_input | paused_budget | stopped | publishing | closed | abandoned (transition table enforced)' },
          { name: 'sdk_session_id', type: 'string', required: false, description: 'Agent SDK session id, max 100 chars' },
          { name: 'base_sha', type: 'string', required: false, description: 'Base commit sha' },
          { name: 'head_sha', type: 'string', required: false, description: 'Head commit sha' },
          { name: 'preview_sha', type: 'string', required: false, description: 'Preview commit sha' },
          { name: 'preview_url', type: 'string', required: false, description: 'Preview URL' },
          { name: 'preview_deploy_url', type: 'string', required: false, description: 'Preview deploy URL' },
          { name: 'worktree_path', type: 'string', required: false, description: 'Worktree path, max 500 chars' },
          { name: 'cost_usd', type: 'number', required: false, description: 'Cumulative cost in USD' },
          { name: 'live_text', type: 'string', required: false, description: 'Live text, max 40000 chars, or null' },
          { name: 'live_action', type: 'string', required: false, description: 'Live action label, max 200 chars, or null' },
          { name: 'lib_index', type: 'object', required: false, description: 'Library index, max 64 KB' },
          { name: 'diff_summary', type: 'object', required: false, description: 'Diff summary, max 64 KB' },
          { name: 'diff_asset_id', type: 'uuid', required: false, description: 'Asset id of the full diff, or null' },
          { name: 'publish_precheck', type: 'object', required: false, description: 'Precheck result, max 64 KB' },
          { name: 'last_heartbeat_at', type: 'ISO-8601', required: false, description: 'Heartbeat time' },
        ],
        responseExample: { session: workerSessionExample },
        responseNotes: 'Status moves follow the session transition table. Closed and abandoned are decided by publish history, not by the caller.',
      },
    ],
  },
  {
    path: '/api/design/worker/sessions/:id/assets',
    group: 'design',
    methods: [
      {
        method: 'POST',
        summary: 'Upload a session asset (pin crop or screenshot) as multipart/form-data. Design-worker lane only.',
        auth: 'required',
        roles: WORKER,
        queryParams: [sessionIdParam],
        bodySchema: [
          { name: 'file', type: 'file', required: true, description: 'PNG (magic bytes checked) or text/plain; 4 MB image, 1 MB text' },
          { name: 'kind', type: 'string', required: true, description: 'Asset kind label (e.g. before, after, crop)' },
          { name: 'width', type: 'number', required: false, description: 'Viewport width in pixels for screenshots' },
        ],
        responseExample: { asset_id: 'uuid' },
        responseNotes: 'Returns 201 { asset_id }. 413 asset_too_large over the limit.',
      },
    ],
  },
  {
    path: '/api/design/worker/sessions/:id/assets/:assetId',
    group: 'design',
    methods: [
      {
        method: 'GET',
        summary: 'Read a session asset (pin crop or earlier screenshot) for a resumed session. Session-scoped; no storage key leaves the server. Design-worker lane only.',
        auth: 'required',
        roles: WORKER,
        queryParams: [sessionIdParam, { name: 'assetId', type: 'uuid', required: true, description: 'Asset id (path)' }],
        responseExample: {
          note: 'Binary body, not JSON. Content-Type is the stored asset type.',
          status: 200,
          cache_control: 'private, no-store',
        },
      },
    ],
  },
  {
    path: '/api/design/worker/sessions/:id/changes',
    group: 'design',
    methods: [
      {
        method: 'POST',
        summary: 'Record a worker change (a commit on the session branch) and mark its pins resolved. Unique per session and commit: a repeat returns 200. Design-worker lane only.',
        auth: 'required',
        roles: WORKER,
        queryParams: [sessionIdParam],
        bodySchema: [
          { name: 'commit_sha', type: 'string', required: true, description: 'Commit sha, 7 to 64 hex chars' },
          { name: 'parent_sha', type: 'string', required: false, description: 'Parent commit sha, or null' },
          { name: 'summary', type: 'string', required: true, description: 'Change summary, 1 to 500 chars' },
          { name: 'files', type: 'string[]', required: false, description: 'Changed files (max 500)' },
          { name: 'data_libs', type: 'string[]', required: false, description: 'Data-lib ids touched (max 200)' },
          { name: 'pages', type: 'string[]', required: false, description: 'Pages affected (max 1000)' },
          { name: 'render_count', type: 'number', required: false, description: 'Rendered page count, or null' },
          { name: 'edit_scope', type: 'string', required: false, description: "'instance' (one occurrence, via parameters or a registered variant) or 'component' (the library component everywhere). Restores send none." },
          { name: 'pin_ids', type: 'uuid', required: false, description: 'Pins this change resolves (max 100)' },
          { name: 'gates', type: 'object', required: false, description: 'Gate results (max 50)' },
          { name: 'apply_event_seq', type: 'number', required: false, description: 'Seq of the apply event this change answers' },
          { name: 'is_restore', type: 'boolean', required: false, description: 'True when this change is a restore' },
          { name: 'restored_from', type: 'string', required: false, description: 'Sha restored from, or null' },
        ],
        responseExample: { change: changeExample },
        responseNotes: 'Returns 201 when new, 200 for a repeat commit.',
      },
    ],
  },
  {
    path: '/api/design/worker/sessions/:id/events',
    group: 'design',
    methods: [
      {
        method: 'POST',
        summary: 'Append worker events to the session feed and acknowledge designer events. Design-worker lane only.',
        auth: 'required',
        roles: WORKER,
        queryParams: [sessionIdParam],
        bodySchema: [
          { name: 'acks', type: 'number', required: false, description: 'Designer event seq numbers the worker has delivered (max 500)' },
          { name: 'events', type: 'object', required: false, description: 'Events [{role: assistant|tool|system, kind, payload, turn?}]; kind is one of text, thought, action, result, screenshot, gate, cost, plan, status, followup, client_files, change, publish, lib_index ({sha, index:{<data_lib>:{pages, sample[<=5]}}, truncated?})' },
        ],
        responseExample: { last_seq: 'number' },
        responseNotes: 'Body up to 4 MB. 413 when a batch exceeds the per-post cap.',
      },
    ],
  },
  {
    path: '/api/design/worker/sessions/:id/scope-flags',
    group: 'design',
    methods: [
      {
        method: 'POST',
        summary: 'File a follow-up task from the worker (flag_scope). The server builds the task; the lane creates no other kind. Design-worker lane only.',
        auth: 'required',
        roles: WORKER,
        queryParams: [sessionIdParam],
        bodySchema: [
          { name: 'title', type: 'string', required: true, description: 'Follow-up title, 1 to 200 chars' },
          { name: 'detail', type: 'string', required: false, description: 'Detail, max 4000 chars' },
          { name: 'pin_ids', type: 'uuid', required: false, description: 'Related pins (max 30)' },
          { name: 'asset_ids', type: 'uuid', required: false, description: 'Related assets (max 10)' },
          { name: 'project_id', type: 'uuid', required: false, description: 'Project for the follow-up task' },
          { name: 'assign_to_designer', type: 'boolean', required: false, description: 'Assign the task to the session designer' },
        ],
        responseExample: { task_id: 'uuid' },
        responseNotes: 'Returns 201 { task_id }.',
      },
    ],
  },
  {
    path: '/api/design/worker/changes/:id',
    group: 'design',
    methods: [
      {
        method: 'PATCH',
        summary: 'Attach before and after screenshot assets and gate results to a recorded change. Design-worker lane only.',
        auth: 'required',
        roles: WORKER,
        queryParams: [{ name: 'id', type: 'uuid', required: true, description: 'Change id (path)' }],
        bodySchema: [
          { name: 'before_asset_ids', type: 'uuid', required: false, description: 'Before-screenshot asset ids (max 10)' },
          { name: 'after_asset_ids', type: 'uuid', required: false, description: 'After-screenshot asset ids (max 10)' },
          { name: 'gates', type: 'object', required: false, description: 'Gate results (max 50)' },
        ],
        responseExample: { change: changeExample },
        responseNotes: 'Assets must belong to the change session (400 bad_assets otherwise).',
      },
    ],
  },
  {
    path: '/api/design/worker/pins/:id',
    group: 'design',
    methods: [
      {
        method: 'PATCH',
        summary: 'Worker marks a pin resolved or as a follow-up, and attaches its crop asset. Design-worker lane only.',
        auth: 'required',
        roles: WORKER,
        queryParams: [{ name: 'id', type: 'uuid', required: true, description: 'Pin id (path)' }],
        bodySchema: [
          { name: 'crop_asset_id', type: 'uuid', required: false, description: 'Crop asset of this pin\'s session' },
          { name: 'status', type: 'string', required: false, description: 'resolved | followup' },
          { name: 'followup_task_id', type: 'uuid', required: false, description: 'Follow-up task id' },
        ],
        responseExample: { pin: pinExample },
      },
    ],
  },
  {
    path: '/api/design/worker/commands/:id',
    group: 'design',
    methods: [
      {
        method: 'PATCH',
        summary: 'Claim a designer command, or complete it. A publish or rollback command completes only after its publish reached a final state. Design-worker lane only.',
        auth: 'required',
        roles: WORKER,
        queryParams: [{ name: 'id', type: 'uuid', required: true, description: 'Command id (path)' }],
        bodySchema: [
          { name: 'action', type: 'string', required: true, description: 'claim | complete' },
          { name: 'status', type: 'string', required: false, description: 'done | failed (complete only)' },
          { name: 'result', type: 'object', required: false, description: 'Result payload (complete only)' },
          { name: 'error', type: 'string', required: false, description: 'Error text, max 2000 chars (complete only)' },
        ],
        responseExample: {
          command: { id: 'uuid', session_id: 'uuid', verb: 'string', status: 'pending|claimed|done|failed', payload: 'object', result: 'object|null', error: 'string|null' },
        },
        responseNotes: '409 publish_not_final when completing a publish or rollback before its publish is final.',
      },
    ],
  },
  {
    path: '/api/design/worker/publishes/:id',
    group: 'design',
    methods: [
      {
        method: 'PATCH',
        summary: 'Worker reports publish progress and result. Strict: the lane cannot touch actor, mode, main role, confirmation fields, kind or session. Design-worker lane only.',
        auth: 'required',
        roles: WORKER,
        queryParams: [{ name: 'id', type: 'uuid', required: true, description: 'Publish id (path)' }],
        bodySchema: workerPublishPatchBody,
        responseExample: { publish: publishExample },
        responseNotes: 'Only queued or running rows move forward; a row in awaiting_confirmation cannot be moved by the lane.',
      },
    ],
  },
];
