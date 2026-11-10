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
const RUNNER = ['design-track'];
const NOTES = ['design-notes'];

const sessionIdParam: ParamDef = { name: 'id', type: 'uuid', required: true, description: 'Design session id (path)' };
const trackIdParam: ParamDef = { name: 'id', type: 'uuid', required: true, description: 'Design track id (path)' };

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
  track: { id: 'uuid', stage: 'research|art_direction|home_build|refine|rest_build|review|done|cancelled', busy: 'boolean', busy_line: 'string|null', preview_alias: 'string', preview_url: 'string|null', finish: { green: 'boolean', finished_at: 'ISO-8601|null' } },
};

const trackAssetExample = {
  id: 'uuid', kind: 'upload|render|ref_fold|ref_full|brief_image|approval_shot|spot_shot', content_type: 'string', width: 'number|null', height: 'number|null',
  page: 'number|null', page_path: 'string|null', viewport_w: 'number|null', status: 'pending|ready|rejected', reject_reason: 'string|null',
  url: 'string|null (the session-scoped read route; null for PDF and SVG originals and job logs)',
};
const markupExample = { id: 'uuid', reference_id: 'uuid', asset_id: 'uuid', rect: { x: 'number', y: 'number', w: 'number', h: 'number' }, sentiment: 'like|dislike|note', category: 'string', note: 'string|null', created_at: 'ISO-8601' };
const referenceExample = {
  id: 'uuid', source: 'bast_pick|client_named|designer_url|designer_upload|indelible_site', url: 'string|null', title: 'string', why_md: 'string|null', decision: 'pending|yes|no',
  decided_at: 'ISO-8601|null', decision_note: 'string|null', capture_status: 'none|queued|captured|failed|blocked', capture_error: 'string|null',
  captures: { desktop_fold: trackAssetExample, desktop_full: trackAssetExample, phone_fold: trackAssetExample, phone_full: trackAssetExample },
  uploads: [{ asset: trackAssetExample, renders: [trackAssetExample] }], extracted: 'object|null', sort_order: 'number', markups: [markupExample],
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
  track: { id: 'uuid', slug: 'string (16 base32)', branch: 'string', preview_alias: 'string', stage: 'string', busy: 'boolean' },
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
  preview_url: 'string|null',
  preview_sha: 'string|null',
  head_sha: 'string|null',
  lib_index_sha: 'string|null',
  last_heartbeat_at: 'ISO-8601|null',
  next_poll_ms: 'number',
  last_seq: 'number',
  has_more: 'boolean',
};

const settingsPatchBody: ParamDef[] = [
  { name: 'enabled', type: 'boolean', required: false, description: 'Designer Portal on/off' },
  { name: 'owner_user_id', type: 'uuid', required: false, description: 'Active user who owns publish notices; null clears' },
  { name: 'designer_publish_mode', type: 'string', required: false, description: 'per_site | pre_launch_only | off' },
  { name: 'confirmation_ttl_minutes', type: 'number', required: false, description: 'Publish confirmation window, 1 to 60' },
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
        responseNotes: 'Only tasks on design-enabled eleventy sites in visible project statuses appear. Done and abandoned tasks are excluded. Bast-run tasks (tag design-runner) never appear. Each task carries track_stage (the design track\'s stage on a design-stage task, null otherwise); a stage task shows the track\'s latest session chip.',
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
            track_stage: 'string|null',
            status: 'string',
            last_publish: { id: 'uuid', status: 'string', finished_at: 'ISO-8601|null' },
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
        responseNotes: 'Returns { session } in the projectSession shape (track is null for an untracked session). The daemon builds the worktree asynchronously (status pending). A design-stage task opens its design track\'s one session, pointing at the track\'s current stage task, with the track\'s branch, alias and preview URL copied on. 404 for a Bast-run task (design-runner); 409 track_not_ready when the project has no open design track; 409 session_owned when another designer holds the track\'s session.',
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
        responseNotes: '201. 404 unknown site or designer not on a project for it; 409 site not design-enabled or not eleventy, portal off, site not served by the box, or no open project (ready, in_progress or review) for the site. The task carries tag design-work. 409 track_live when the site has an open design track (nothing is created).',
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
        responseNotes: 'Returns { seq }. 201 when new, 200 on a repeat. 429 rate_limited past 30 designer messages (text or apply) per session per minute. On a design track: 409 track_busy while Bast is building, 409 track_done once the design review is finished.',
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
        responseNotes: 'Returns 201 { pin } in the projectPin shape. On a design track: 409 track_busy while Bast is building, 409 track_done once the design review is finished.',
      },
    ],
  },
  {
    path: '/api/design/sessions/:id/apply',
    group: 'design',
    methods: [
      {
        method: 'POST',
        summary: 'Apply pending pins: checks stale pins, then records one apply event for the daemon.',
        auth: 'required',
        roles: DESIGNER,
        queryParams: [sessionIdParam],
        bodySchema: applyBody,
        responseNotes: 'Returns { seq }: 201 when applied, 200 on a repeat client_ref. Refusals return the ApplyRefusal body and status. On a design track: 409 track_busy while Bast is building, 409 track_done once the design review is finished.',
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
        responseNotes: 'Returns 201 with the confirmation token (only its sha256 is stored) and the exact confirm-dialog content. Signed-in session only, same-origin JSON. On a design track: 409 track_busy while Bast is building (stays open after the review is finished: this is the launch merge).',
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
        responseNotes: 'Returns 409 publish_allowed when the designer may already publish. Not an approval step. On a design track: 409 track_busy while Bast is building.',
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
        responseNotes: 'Returns 202 { command_id }. On a design track: 409 track_busy while Bast is building, 409 track_done once the design review is finished.',
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

  // ---- Admin: settings, per-site and per-client/project switches ----
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
            model: 'string',
            effort: 'low|medium|high|xhigh|max',
            max_live_sessions: 'number',
            updated_at: 'ISO-8601|null',
          },
        },
        responseNotes: 'Refused 400 bad_owner for an inactive owner.',
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
          new_sessions: [{ id: 'uuid', task_id: 'uuid', site_id: 'uuid', status: 'pending', track: 'object|null (same shape as the worker session track; null = untracked)' }],
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
    path: '/api/design/worker/sessions/:id/context',
    group: 'design',
    methods: [
      {
        method: 'GET',
        summary: 'Read one part of the design track the session works on: the brief, the board, the art direction, the client statements or the page list. Tracked sessions only. Design-worker lane only.',
        auth: 'required',
        roles: WORKER,
        queryParams: [
          sessionIdParam,
          { name: 'part', type: 'string', required: true, description: 'brief, board, direction, client_statements or pages' },
          { name: 'ids', type: 'string', required: false, description: 'Comma separated uuids, at most 20; narrows board, client_statements and pages' },
        ],
        responseExample: { part: 'direction', track: { id: 'uuid', stage: 'art_direction', busy: false }, direction: null },
        responseNotes: '404 for an untracked session. 400 bad_part, bad_ids or too_many_ids. Asset views carry ids only, never a URL or a storage key.',
      },
    ],
  },
  {
    path: '/api/design/worker/sessions/:id/art-direction',
    group: 'design',
    methods: [
      {
        method: 'PATCH',
        summary: 'Merge a patch into the open art direction draft of the session\'s track, with the same validation as the designer route. The worker can never sign or revise. Design-worker lane only.',
        auth: 'required',
        roles: WORKER,
        queryParams: [sessionIdParam],
        bodySchema: [
          { name: 'patch', type: 'object', required: true, description: 'JSON merge patch on the art direction body' },
          { name: 'base_version', type: 'number', required: false, description: 'The version the worker read; omitted means the open draft' },
        ],
        responseExample: { direction: { version: 1, status: 'draft' } },
        responseNotes: '409 direction_signed on a signed version, 409 version_moved on a stale base_version, 413 direction_too_large over 128 KB.',
      },
    ],
  },
  {
    path: '/api/design/worker/sessions/:id/track-assets/:assetId',
    group: 'design',
    methods: [
      {
        method: 'GET',
        summary: 'Read the bytes of an asset of the session\'s track (a reference shot or an upload) for the worker. Design-worker lane only.',
        auth: 'required',
        roles: WORKER,
        queryParams: [sessionIdParam, { name: 'assetId', type: 'uuid', required: true, description: 'Track asset id (path)' }],
        responseExample: {
          note: 'Binary body, not JSON. Content-Type is always application/octet-stream.',
          status: 200,
          cache_control: 'private, no-store',
        },
        responseNotes: 'An asset of another track is 404.',
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
        responseNotes: '409 publish_not_final when completing a publish or rollback before its publish is final. Portal v2: completing an adopt_branch command also closes its job, moves the track head and runs the stage effects of the job kind; completing a finish_gates command stores the result and finishes the track when green and the head has not moved. Results of these two verbs may be up to 256 KB (others 8 KB).',
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

  {
    path: '/api/design/sessions/:id/home-ready',
    group: 'design',
    methods: [
      {
        method: 'POST',
        summary: 'The designer taps "Home is ready" (portal v2, SPEC 2.5): refine -> rest_build. Completes and approves her refine task, sets the track busy and queues the rest_build job. Tracked sessions only.',
        auth: 'required',
        roles: DESIGNER,
        queryParams: [sessionIdParam],
        responseExample: { stage: 'rest_build', busy: true, job_id: 'uuid' },
        responseNotes: '202. Strict empty body. 404 for an untracked session; 409 illegal_transition unless the track is in refine; 409 build_running if a build job is already active.',
      },
    ],
  },
  {
    path: '/api/design/sessions/:id/preview-link',
    group: 'design',
    methods: [
      {
        method: 'POST',
        summary: 'Email the preview link for the page the designer is on to her own Citadel address (portal v2, SPEC 4.10). The link is built on the server from the session\'s stored preview address and the checked path; the address is never taken from the request.',
        auth: 'required',
        roles: DESIGNER,
        queryParams: [sessionIdParam],
        bodySchema: [
          { name: 'path', type: 'string', required: true, description: 'The page path, one leading slash, at most 512 characters. Query and hash are dropped.' },
        ],
        responseExample: { sent: true },
        responseNotes: 'Strict body: an email or to field is 400. 400 bad_path for a path that is not plain; 409 no_preview before the first preview; 404 for another designer\'s session; 403 for a pm; 429 over 10 per hour per user.',
      },
    ],
  },
  // Designer Portal v2 (SPEC 4.11 rows 1 to 13): brief, board, uploads, art direction. All session-scoped and tracked-only
  // (404 for an untracked session or another designer's session); every write is also 409 track_done once the track is done.
  {
    path: '/api/design/sessions/:id/brief',
    group: 'design',
    methods: [
      {
        method: 'GET',
        summary: 'The published brief of the session\'s track, the caller\'s own card reactions and the client\'s own words as client_statements (portal v2, SPEC 4.1).',
        auth: 'required',
        roles: READERS,
        queryParams: [sessionIdParam],
        responseExample: {
          brief: { id: 'uuid', version: 'number', published_at: 'ISO-8601', body: 'object (SPEC 4.1; the top-level client key is returned as client_name)' },
          assets: [trackAssetExample],
          reactions: [{ card_id: 'string', reaction: 'useful|not_relevant', note: 'string|null' }],
          client_statements: [{ id: 'uuid', quote: 'string', speaker_name: 'string', speaker_role: 'string', source_date: 'ISO-8601', source_kind: 'string', is_paraphrase: 'boolean', subject: 'string', category: 'string', polarity: 'string', status: 'string' }],
        },
        responseNotes: 'brief is null before the brief is published. 404 for an untracked session.',
      },
    ],
  },
  {
    path: '/api/design/sessions/:id/brief/reactions',
    group: 'design',
    methods: [
      {
        method: 'POST',
        summary: 'Mark one brief card useful or not relevant, with an optional one-line note. One reaction per card per person (upsert).',
        auth: 'required',
        roles: DESIGNER,
        queryParams: [sessionIdParam],
        bodySchema: [
          { name: 'card_id', type: 'string', required: true, description: 'A card id of the published brief' },
          { name: 'reaction', type: 'string', required: true, description: 'useful | not_relevant' },
          { name: 'note', type: 'string', required: false, description: 'At most 200 characters' },
        ],
        responseExample: { reaction: { card_id: 'string', reaction: 'useful|not_relevant', note: 'string|null' } },
        responseNotes: '409 no_brief before a brief is published; 404 unknown_card; 409 track_done.',
      },
    ],
  },
  {
    path: '/api/design/sessions/:id/references',
    group: 'design',
    methods: [
      {
        method: 'GET',
        summary: 'Mood board cards of the session\'s track with live markups, capture states and the renders of uploads (portal v2, SPEC 4.3).',
        auth: 'required',
        roles: READERS,
        queryParams: [sessionIdParam],
        responseExample: { references: [referenceExample] },
      },
      {
        method: 'POST',
        summary: 'Add a site to the board by https URL (parsed and validated server side, nothing fetched here; one capture job queued) or group board uploads into a card.',
        auth: 'required',
        roles: DESIGNER,
        queryParams: [sessionIdParam],
        bodySchema: [
          { name: 'url', type: 'string', required: false, description: 'https URL; or send upload_asset_ids instead' },
          { name: 'upload_asset_ids', type: 'string[]', required: false, description: 'Board uploads of this track (1 to 20)' },
          { name: 'title', type: 'string', required: false, description: 'At most 200 characters' },
        ],
        responseExample: { reference: referenceExample },
        responseNotes: '201. 400 bad_url for a non-https, credentialed, IP-literal or local address; 409 duplicate_url; 409 upload_in_use; 400 bad_upload_ids.',
      },
    ],
  },
  {
    path: '/api/design/sessions/:id/references/:refId',
    group: 'design',
    methods: [
      {
        method: 'PATCH',
        summary: 'Decide a board card (yes, no, pending), add a note, or reorder it.',
        auth: 'required',
        roles: DESIGNER,
        queryParams: [sessionIdParam, { name: 'refId', type: 'uuid', required: true, description: 'Reference id (path)' }],
        bodySchema: [
          { name: 'decision', type: 'string', required: false, description: 'pending | yes | no' },
          { name: 'decision_note', type: 'string', required: false, description: 'At most 500 characters, or null' },
          { name: 'sort_order', type: 'number', required: false, description: 'Integer 0 to 10000' },
        ],
        responseExample: { reference: referenceExample },
        responseNotes: '404 for a reference of another track.',
      },
    ],
  },
  {
    path: '/api/design/sessions/:id/markups',
    group: 'design',
    methods: [
      {
        method: 'POST',
        summary: 'Draw a markup box on a shot or upload of a board card, as fractions of the image.',
        auth: 'required',
        roles: DESIGNER,
        queryParams: [sessionIdParam],
        bodySchema: [
          { name: 'reference_id', type: 'uuid', required: true, description: 'Board card' },
          { name: 'asset_id', type: 'uuid', required: true, description: 'A capture, raster upload or render on that card' },
          { name: 'rect', type: 'object', required: true, description: '{x, y, w, h}, each 0 to 1, inside the image' },
          { name: 'sentiment', type: 'string', required: true, description: 'like | dislike | note' },
          { name: 'category', type: 'string', required: true, description: 'type | colour | layout | density | imagery | nav | decoration | motion | feature | tone | other' },
          { name: 'note', type: 'string', required: false, description: 'At most 500 characters' },
        ],
        responseExample: { markup: markupExample },
        responseNotes: '201. 400 bad_rect or bad_asset; 409 markup_limit at 50 live boxes on a card.',
      },
    ],
  },
  {
    path: '/api/design/sessions/:id/markups/:markupId',
    group: 'design',
    methods: [
      {
        method: 'PATCH',
        summary: 'Edit a markup box, or remove it with deleted: true (false restores it).',
        auth: 'required',
        roles: DESIGNER,
        queryParams: [sessionIdParam, { name: 'markupId', type: 'uuid', required: true, description: 'Markup id (path)' }],
        bodySchema: [
          { name: 'rect', type: 'object', required: false, description: '{x, y, w, h}' },
          { name: 'sentiment', type: 'string', required: false, description: 'like | dislike | note' },
          { name: 'category', type: 'string', required: false, description: 'Category chip' },
          { name: 'note', type: 'string', required: false, description: 'At most 500 characters, or null' },
          { name: 'deleted', type: 'boolean', required: false, description: 'true removes the box' },
        ],
        responseExample: { markup: markupExample },
        responseNotes: '404 for a markup of another track.',
      },
    ],
  },
  {
    path: '/api/design/sessions/:id/uploads',
    group: 'design',
    methods: [
      {
        method: 'POST',
        summary: 'Upload a sample, an image or decoration art (multipart file + purpose). The type comes from the bytes; the original is stored pending and a process_upload job is queued (portal v2, SPEC 3.3).',
        auth: 'required',
        roles: DESIGNER,
        queryParams: [sessionIdParam],
        bodySchema: [
          { name: 'file', type: 'file', required: true, description: 'multipart/form-data file' },
          { name: 'purpose', type: 'string', required: true, description: 'board (PNG JPEG WebP GIF, PDF without active content) | image (PNG JPEG WebP) | decor (PNG WebP, SVG up to 1 MB)' },
        ],
        responseExample: { asset: trackAssetExample },
        responseNotes: '201 with status pending. 25 MB cap (413 asset_too_large; a declared length over 25 MB + 64 KB is 413 before the body is read). 400 bad_type, active_content, bad_svg, empty_file. 409 upload_limit (100 per track), upload_bytes_limit (1 GB per track). 429 rate_limited (20 a minute). Multipart content type only (415 otherwise).',
      },
    ],
  },
  {
    path: '/api/design/sessions/:id/track-assets/:assetId',
    group: 'design',
    methods: [
      {
        method: 'GET',
        summary: 'Stream one track asset image from private storage: capture shots, brief images, renders, approval and spot shots, and raster upload originals only.',
        auth: 'required',
        roles: READERS,
        queryParams: [sessionIdParam, { name: 'assetId', type: 'uuid', required: true, description: 'Track asset id (path)' }],
        responseExample: { note: 'Binary image, not JSON.', status: 200, cache_control: 'private, no-store' },
        responseNotes: 'Headers: nosniff, Content-Security-Policy default-src none; sandbox, inline. PDF and SVG originals, job logs, rejected uploads and assets of another track are 404.',
      },
    ],
  },
  {
    path: '/api/design/sessions/:id/art-direction',
    group: 'design',
    methods: [
      {
        method: 'GET',
        summary: 'The open art direction draft, or the latest signed version, plus the client requests the record still does not answer (portal v2, SPEC 4.4).',
        auth: 'required',
        roles: READERS,
        queryParams: [sessionIdParam],
        responseExample: {
          direction: { id: 'uuid', version: 'number', status: 'draft|signed|superseded', body: 'object (SPEC 4.4; free text is named detail)', drafted_by: 'worker|designer|job', signed_at: 'ISO-8601|null' },
          signed: { id: 'uuid', version: 'number', signed_at: 'ISO-8601' },
          missing_client_requests: [{ id: 'uuid', quote: 'string', subject: 'string', polarity: 'require|avoid' }],
          sign_gaps: ['nav.desktop|nav.mobile|container'],
        },
        responseNotes: 'direction is null before any draft exists.',
      },
      {
        method: 'PATCH',
        summary: 'Edit the open draft with a JSON merge patch (null removes a key, arrays are replaced). Strict: an unknown key, notes included, is 400.',
        auth: 'required',
        roles: DESIGNER,
        queryParams: [sessionIdParam],
        bodySchema: [
          { name: 'patch', type: 'object', required: true, description: 'Merge patch of the SPEC 4.4 record' },
          { name: 'base_version', type: 'number', required: true, description: 'The draft version the caller saw (0 when no draft exists yet)' },
        ],
        responseExample: { direction: { id: 'uuid', version: 'number', status: 'draft', body: 'object' } },
        responseNotes: '409 version_moved on a stale base; 409 direction_signed on a signed version; 409 track_busy while a build runs; 409 track_done.',
      },
    ],
  },
  {
    path: '/api/design/sessions/:id/art-direction/sign',
    group: 'design',
    methods: [
      {
        method: 'POST',
        summary: 'Sign the art direction (the session\'s designer only). Freezes the draft; first sign-off moves the track to home_build and queues the build, module and client_brief_email jobs.',
        auth: 'required',
        roles: DESIGNER,
        queryParams: [sessionIdParam],
        bodySchema: [
          { name: 'base_version', type: 'number', required: true, description: 'The draft version being signed' },
          { name: 'mode', type: 'string', required: false, description: 'Later versions only: refinements (default) | rebuild' },
        ],
        responseExample: { direction: { id: 'uuid', version: 'number', status: 'signed', body: 'object' }, stage: 'home_build', build_job_id: 'uuid|null', client_email_job_id: 'uuid' },
        responseNotes: '403 designer_only for an admin; 409 direction_signed, version_moved, no_draft, direction_incomplete (nav and container unfilled), client_requests_missing, illegal_transition, track_done.',
      },
    ],
  },
  {
    path: '/api/design/sessions/:id/art-direction/revise',
    group: 'design',
    methods: [
      {
        method: 'POST',
        summary: 'Start a new art direction draft from the signed version. Allowed in refine and review, and in home_build only after the build failed for good.',
        auth: 'required',
        roles: DESIGNER,
        queryParams: [sessionIdParam],
        responseExample: { direction: { id: 'uuid', version: 'number', status: 'draft', body: 'object' } },
        responseNotes: '201. Strict empty body. 409 track_busy while a build runs; 409 draft_exists; 409 illegal_transition; 409 track_done.',
      },
    ],
  },
  // Designer Portal v2 Bast runner (SPEC 6.1a): the design-track lane, exactly these 12 routes. Key: lane:design-track +
  // scope-mode:enforce (always enforced), minted for the Bast user. requireTrackRunner() gates every one.
  {
    path: '/api/design/runner/candidates',
    group: 'design',
    methods: [
      {
        method: 'GET',
        summary: 'Tasks the runner may start tracks from (design-job:provision or research, not_started, site design_path portal) and design-import tasks on tracked projects with no import row. Design-track lane only.',
        auth: 'required',
        roles: RUNNER,
        responseExample: { candidates: [{ task_id: 'uuid', title: 'string', kind: 'provision|research|import', site_id: 'uuid', project_id: 'uuid', track_id: 'uuid (imports only)', blocked_reason: 'bast_enabled_false|design_portal_enabled_false|site_not_configured|null' }] },
      },
    ],
  },
  {
    path: '/api/design/runner/tracks',
    group: 'design',
    methods: [
      {
        method: 'POST',
        summary: "Start the site's design track from a provision or research task: 200 with the open track, 201 with a new one (queues provision and research). Design-track lane only.",
        auth: 'required',
        roles: RUNNER,
        bodySchema: [{ name: 'task_id', type: 'uuid', required: true, description: 'A task tagged design-job:provision or design-job:research' }],
        responseExample: { track: { id: 'uuid', slug: 'string', stage: 'research', branch: 'design/t-<slug>', preview_alias: 'design-t-<slug>' }, created: 'boolean' },
        responseNotes: '409 not_candidate; 409 site_not_ready (the message names the reason).',
      },
    ],
  },
  {
    path: '/api/design/runner/tracks/:id',
    group: 'design',
    methods: [
      {
        method: 'GET',
        summary: 'The track row plus any of the requested includes. Design-track lane only.',
        auth: 'required',
        roles: RUNNER,
        queryParams: [
          trackIdParam,
          { name: 'include', type: 'string', required: false, description: 'Comma list of brief, references, direction, client_statements, brand_profile, pages, imports, recipients. client_statements here includes active and superseded notes with superseded_by_id, reference_url and source_ref (runner only; designers get active notes without them). brand_profile is the client\'s {voice_profile, brand_tokens, figma_url, component_library_ref} or null' },
        ],
        responseExample: { track: { id: 'uuid', stage: 'string', busy_job_id: 'uuid|null', head_sha: 'string|null', preview_url: 'string|null' }, recipients: [{ contact_id: 'uuid', name: 'string|null', email: 'string', basis: 'grant|client_fallback' }], client_statements: [{ id: 'uuid', quote: 'string', speaker_name: 'string', speaker_role: 'string', source_date: 'ISO-8601', source_kind: 'string', is_paraphrase: 'boolean', subject: 'string', category: 'string', polarity: 'string', status: 'active|superseded', superseded_by_id: 'uuid|null', reference_url: 'string|null', source_ref: 'string' }], brand_profile: { voice_profile: 'json|null', brand_tokens: 'json|null', figma_url: 'string|null', component_library_ref: 'string|null' } },
        responseNotes: 'Statements are ordered by source_date, created_at, id; group a superseded note under the note whose id is its superseded_by_id. Recipients are computed by Citadel (owner or member grants; client contacts who can initiate work when the project has no grants; other email domains only with a grant).',
      },
    ],
  },
  {
    path: '/api/design/runner/claims',
    group: 'design',
    methods: [
      {
        method: 'POST',
        summary: 'Claim the oldest claimable job with a 10 minute lease (attempts + 1). Expired leases are returned to the queue first. Design-track lane only.',
        auth: 'required',
        roles: RUNNER,
        bodySchema: [
          { name: 'runner_id', type: 'string', required: true, description: 'Recorded as claimed_by' },
          { name: 'kinds', type: 'string[]', required: false, description: 'Only claim these job kinds' },
        ],
        responseExample: { job: { id: 'uuid', track_id: 'uuid', kind: 'string', status: 'claimed', attempts: 'number', error: 'string|null', lease_until: 'ISO-8601' }, track: { id: 'uuid', stage: 'string' } },
        responseNotes: '204 when nothing is claimable. A job with a task sets the task in_progress and assigns the key user when it has no assignee.',
      },
    ],
  },
  {
    path: '/api/design/runner/jobs/:id',
    group: 'design',
    methods: [
      {
        method: 'PATCH',
        summary: 'Renew the lease, or report a job done or failed. Design-track lane only.',
        auth: 'required',
        roles: RUNNER,
        queryParams: [{ name: 'id', type: 'uuid', required: true, description: 'Job id (path)' }],
        bodySchema: [
          { name: 'action', type: 'string', required: true, description: 'renew | done | failed' },
          { name: 'runner_id', type: 'string', required: false, description: 'Must match the claim when sent' },
          { name: 'result', type: 'object', required: false, description: 'done only, at most 256 KB' },
          { name: 'error', type: 'string', required: false, description: 'failed only, at most 8,000 chars' },
          { name: 'cost_usd', type: 'number', required: false, description: 'done or failed' },
          { name: 'log_asset_id', type: 'uuid', required: false, description: 'A job_log asset of the same track' },
        ],
        responseExample: { job: { id: 'uuid', kind: 'string', status: 'queued|claimed|running|done|failed', attempts: 'number' } },
        responseNotes: '409 adopt_pending for done on a job that adopts a branch (it closes when its adopt command completes); 409 job_not_active. failed with attempts left returns the job to the queue; at attempts 2 it stays failed, the task gets the needs-mike tag and an error comment, and busy is cleared.',
      },
    ],
  },
  {
    path: '/api/design/runner/tracks/:id/assets',
    group: 'design',
    methods: [
      {
        method: 'POST',
        summary: 'Runner upload of captures, renders, brief images, spot shots and job logs (SPEC 3.3). The type comes from the bytes. Design-track lane only.',
        auth: 'required',
        roles: RUNNER,
        queryParams: [trackIdParam],
        bodySchema: [
          { name: 'file', type: 'file', required: true, description: 'multipart/form-data: PNG or WebP up to 20 MB, or a text job log up to 1 MB' },
          { name: 'kind', type: 'string', required: true, description: 'ref_fold | ref_full | brief_image | render | spot_shot | job_log' },
          { name: 'parent_asset_id', type: 'uuid', required: false, description: 'Render only, required: the upload it came from (marks that upload ready)' },
          { name: 'page', type: 'number', required: false, description: 'Render only: PDF page 1 to 10' },
          { name: 'page_path', type: 'string', required: false, description: 'Spot shot only' },
          { name: 'viewport_w', type: 'number', required: false, description: 'Viewport width 200 to 4000' },
        ],
        responseExample: { asset: { id: 'uuid', track_id: 'uuid', kind: 'string', parent_asset_id: 'uuid|null', status: 'ready', content_type: 'string', bytes: 'number', sha256: 'string', width: 'number|null', height: 'number|null' } },
        responseNotes: '201. 400 bad_type, bad_parent, bad_field; 413 asset_too_large; 415 for a non-multipart body; 404 for an unknown track.',
      },
    ],
  },
  {
    path: '/api/design/runner/tracks/:id/assets/:assetId',
    group: 'design',
    methods: [
      {
        method: 'GET',
        summary: 'Bytes of any asset of the track (SPEC 3.3). Design-track lane only.',
        auth: 'required',
        roles: RUNNER,
        queryParams: [trackIdParam, { name: 'assetId', type: 'uuid', required: true, description: 'Track asset id (path)' }],
        responseExample: { note: 'Binary body, not JSON. Content-Type application/octet-stream; X-Design-Asset-Kind and X-Design-Asset-Type carry the kind and the sniffed type.' },
        responseNotes: '404 for an asset of another track.',
      },
      {
        method: 'PATCH',
        summary: 'Reject a pending upload (SPEC 3.3). Design-track lane only.',
        auth: 'required',
        roles: RUNNER,
        queryParams: [trackIdParam, { name: 'assetId', type: 'uuid', required: true, description: 'Track asset id (path)' }],
        bodySchema: [
          { name: 'status', type: 'string', required: true, description: 'Only "rejected"' },
          { name: 'reject_reason', type: 'string', required: true, description: 'too_many_pixels, not_an_image, type_not_allowed, pdf_failed, svg_refused, svg_failed, timeout, too_large or processing_failed' },
        ],
        responseExample: { asset: { id: 'uuid', track_id: 'uuid', kind: 'upload', status: 'rejected', content_type: 'string', bytes: 'number' } },
        responseNotes: '200. A pending upload becomes rejected; one already rejected is returned unchanged (the first reason stays). 409 already_ready (the upload has renders), 409 not_upload; 400 for any other body; 404 for an asset of another track.',
      },
    ],
  },
  {
    path: '/api/design/runner/tracks/:id/references',
    group: 'design',
    methods: [
      {
        method: 'POST',
        summary: 'Add up to 20 Bast picks or client-named sites; Citadel queues one capture job per reference with a URL. Design-track lane only.',
        auth: 'required',
        roles: RUNNER,
        queryParams: [trackIdParam],
        bodySchema: [{ name: 'references', type: 'object', required: true, description: '[{source: bast_pick|client_named|indelible_site, url? (https), title, why_md? (800)}], 1 to 20' }],
        responseExample: { references: [{ id: 'uuid', url: 'string|null', capture_status: 'queued|none' }], skipped: ['url already on the track'] },
      },
    ],
  },
  {
    path: '/api/design/runner/references/:id',
    group: 'design',
    methods: [
      {
        method: 'PATCH',
        summary: 'Record a reference capture result: status, error, the four capture asset ids, extracted style data. Design-track lane only.',
        auth: 'required',
        roles: RUNNER,
        queryParams: [{ name: 'id', type: 'uuid', required: true, description: 'Reference id (path)' }],
        bodySchema: [
          { name: 'capture_status', type: 'string', required: true, description: 'captured | failed | blocked' },
          { name: 'capture_error', type: 'string', required: false, description: 'Max 500 chars' },
          { name: 'desktop_fold_asset_id', type: 'uuid', required: false, description: 'Track asset of the same track' },
          { name: 'extracted', type: 'object', required: false, description: 'At most 16 KB' },
        ],
        responseExample: { reference: { id: 'uuid', capture_status: 'captured|failed|blocked' } },
      },
    ],
  },
  {
    path: '/api/design/runner/tracks/:id/briefs',
    group: 'design',
    methods: [
      {
        method: 'POST',
        summary: 'Publish a brief that passes the SPEC 4.1 schema; it supersedes the previous version and may complete research -> art_direction. Design-track lane only.',
        auth: 'required',
        roles: RUNNER,
        queryParams: [trackIdParam],
        bodySchema: [
          { name: 'body', type: 'object', required: true, description: 'The brief body (SPEC 4.1), at most 512 KB' },
          { name: 'job_id', type: 'uuid', required: false, description: 'The brief job' },
        ],
        responseExample: { brief: { id: 'uuid', version: 'number', status: 'published' }, entered_art_direction: 'boolean' },
        responseNotes: '409 illegal_stage once the track is past art_direction.',
      },
    ],
  },
  {
    path: '/api/design/runner/tracks/:id/adopt',
    group: 'design',
    methods: [
      {
        method: 'POST',
        summary: 'Ask the daemon to adopt a job branch: creates the adopt_branch command (payload built by Citadel from the track and job rows). Design-track lane only.',
        auth: 'required',
        roles: RUNNER,
        queryParams: [trackIdParam],
        bodySchema: [
          { name: 'job_id', type: 'uuid', required: true, description: 'A claimed or running job of an adopting kind (wireframe, home_build, rest_build, module, bulk_import, fact_fix)' },
          { name: 'job_branch', type: 'string', required: true, description: 'design/t-<this track slug>-job-<n>' },
          { name: 'expected_base', type: 'string', required: true, description: '40 hex characters' },
        ],
        responseExample: { command: { id: 'uuid', verb: 'adopt_branch', status: 'pending', payload: 'object' }, created: 'boolean' },
        responseNotes: '201 new command, 200 when the job already has a pending or claimed one. 409 bad_job_kind, job_not_active.',
      },
    ],
  },
  {
    path: '/api/design/runner/tracks/:id/imports',
    group: 'design',
    methods: [
      {
        method: 'POST',
        summary: 'Register a DesignImport from a design-import task of the track project. Design-track lane only.',
        auth: 'required',
        roles: RUNNER,
        queryParams: [trackIdParam],
        bodySchema: [
          { name: 'task_id', type: 'uuid', required: true, description: 'The design-import task' },
          { name: 'template_page_path', type: 'string', required: true, description: 'Starts with /' },
          { name: 'source_paths', type: 'string[]', required: true, description: '1 to 200 paths' },
          { name: 'expected_count', type: 'number', required: true, description: 'Integer' },
          { name: 'mapping_path', type: 'string', required: false, description: 'Per-import column mapping' },
          { name: 'required_for_launch', type: 'boolean', required: false, description: 'Default true' },
        ],
        responseExample: { import: { id: 'uuid', status: 'waiting', expected_count: 'number' } },
        responseNotes: '409 import_exists when the task already has one.',
      },
    ],
  },
  // Designer Portal v2 intake (SPEC 8.1, W0.4): the design-notes lane, exactly these 3 routes. Key: lane:design-notes +
  // scope-mode:enforce (always enforced), minted for the Bast user. requireDesignNotesKey() gates every one. Not designer
  // routes: a designer only ever sees notes as client_statements inside the brief.
  {
    path: '/api/clients/:id/design-notes',
    group: 'design',
    methods: [
      {
        method: 'POST',
        summary: "Save a batch of a client's design statements from intake. Idempotent on client_id, source_ref and quote_sha: a repeat creates nothing and reports the duplicates as skipped. Design-notes lane only.",
        auth: 'required',
        roles: NOTES,
        queryParams: [{ name: 'id', type: 'uuid', required: true, description: 'Client id (path)' }],
        bodySchema: [
          { name: 'notes', type: 'object', required: true, description: '1 to 100 notes, body at most 1 MB. Each: source_kind (meeting|email|call_notes|document|portal|backfill), source_ref (at most 300), source_date (ISO-8601), speaker_name, speaker_role (client|mike|indelible|other), quote (at most 600 characters), category, polarity (like|dislike|require|avoid|idea|neutral), subject (at most 200), confidence (0 to 1), extracted_by (at most 60); optional project_id, site_id (of this client), is_paraphrase, reference_url (http or https), quote_sha (must match the quote)' },
        ],
        responseExample: { created: [{ index: 0, id: 'uuid', source_ref: 'string', quote_sha: 'sha256 hex' }], skipped: [{ index: 1, id: 'uuid (the existing note)', source_ref: 'string', quote_sha: 'sha256 hex' }] },
        responseNotes: '201 even when every note is a duplicate. quote_sha is computed by Citadel (sha256 of the quote with whitespace collapsed). 404 unknown client; 400 more than 100 notes, an unknown enum value, or a project or site of another client; 413 body over 1 MB. Writes in shadow mode as well as live.',
      },
      {
        method: 'GET',
        summary: "A client's design notes, every status, oldest first, for dedupe and backfill dry runs. Design-notes lane only.",
        auth: 'required',
        roles: NOTES,
        queryParams: [
          { name: 'id', type: 'uuid', required: true, description: 'Client id (path)' },
          { name: 'source_ref', type: 'string', required: false, description: 'Exact match' },
          { name: 'since', type: 'string', required: false, description: 'ISO-8601 date-time: notes created at or after it' },
        ],
        responseExample: { notes: [{ id: 'uuid', client_id: 'uuid', source_kind: 'meeting', source_ref: 'string', quote: 'string', quote_sha: 'string', category: 'string', polarity: 'string', subject: 'string', status: 'active|superseded|withdrawn', superseded_by_id: 'uuid|null' }] },
        responseNotes: '404 unknown client; 400 a malformed since.',
      },
    ],
  },
  {
    path: '/api/design-notes/:id',
    group: 'design',
    methods: [
      {
        method: 'PATCH',
        summary: 'Mark a design note superseded or withdrawn (never back to active). Design-notes lane only.',
        auth: 'required',
        roles: NOTES,
        queryParams: [{ name: 'id', type: 'uuid', required: true, description: 'Design note id (path)' }],
        bodySchema: [
          { name: 'status', type: 'string', required: true, description: 'superseded | withdrawn' },
          { name: 'superseded_by_id', type: 'uuid', required: false, description: 'status superseded only: another active note of the same client' },
        ],
        responseExample: { note: { id: 'uuid', status: 'superseded', superseded_by_id: 'uuid|null' } },
        responseNotes: '404 unknown note; 400 superseded_by_id on a withdrawn note, itself, an inactive note, or a note of another client.',
      },
    ],
  },
];
