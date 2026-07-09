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
        summary: 'PM/Admin: full fleet snapshot for the Oracle visualizer, shaped for one call.',
        auth: 'required',
        roles: ['pm', 'admin'],
        responseNotes:
          'Sessions are running|waiting|stale always, plus ended sessions from the last 24h. Machine ' +
          '`stale` is derived at read time (last_heartbeat_at gap > 3 minutes), never a stored status.',
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
            },
          ],
          counts: { machines: 'number', sessions: 'number', agents: 'number' },
          generated_at: 'ISO-8601',
        },
      },
    ],
  },
];
