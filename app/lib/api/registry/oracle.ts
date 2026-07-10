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
          'running/waiting session absent from the snapshot and unseen for 5+ minutes flips to stale. ' +
          'Unknown event kinds are stored, never rejected. Capped at 500 events/call and ~32KB per ' +
          'event/agent payload blob (2MB total body); opportunistically prunes OracleEvent rows older ' +
          'than 7 days on every call.',
        bodySchema: [
          { name: 'machine', type: 'object', required: true, description: '{ name (unique machine key), hostname? }' },
          { name: 'sent_at', type: 'ISO-8601', required: false, description: 'Heartbeat/call timestamp; updates machine.last_heartbeat_at' },
          { name: 'events', type: 'object', required: false, description: 'Array of hook events (max 500): { kind, external_id, source, ts, title?, cwd?, model?, tokens_total?, payload? }' },
          { name: 'snapshot', type: 'object', required: false, description: '{ sessions: [{ external_id, source, title?, cwd?, model?, status?, needs_attention?, attention_reason?, started_at?, last_event_at?, ended_at?, tokens_total?, meta?, agents?: [...] }] }' },
        ],
        responseExample: {
          success: true,
          machine_id: 'uuid',
          events_ingested: 'number',
          sessions_upserted: 'number',
          agents_upserted: 'number',
          reconciled_stale: 'number',
          pruned_events: 'number',
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
          'Sessions are running|waiting|stale always, plus ended sessions from the last 24h. Machine ' +
          '`stale` is derived at read time (last_heartbeat_at gap > 3 minutes), never a stored status. ' +
          '1.5a: admin-only (was pm-or-admin) — the oracle service bot is unaffected since ingest ' +
          'authorizes via isOracleBot, not role. `commands` (1.5b) is each machine\'s last 24h of ' +
          'spawn_session commands, newest first, capped at 20.',
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
                  status: 'running|waiting|ended|stale',
                  needs_attention: 'boolean',
                  attention_reason: 'string|null',
                  started_at: 'ISO-8601|null',
                  last_event_at: 'ISO-8601|null',
                  ended_at: 'ISO-8601|null',
                  tokens_total: 'number',
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
];
