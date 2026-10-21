import type { ApiEndpoint } from './index';

// Engine runner: claims portal-chat jobs and reads what the portal shows the job's contact.
// Requires a bearer API key carrying the `engine` scope; staff cookies and ordinary keys are refused.
const authFields = { auth: 'required' as const };

export const engineEndpoints: ApiEndpoint[] = [
  {
    path: '/api/engine/claim',
    group: 'engine',
    methods: [
      {
        method: 'POST',
        summary: 'Claim the oldest fresh queued job (FOR UPDATE SKIP LOCKED) with a 120 s lease. 204 when nothing is queued. Response header X-Engine-Active = conversations with a client message in the last 5 minutes.',
        ...authFields,
        bodySchema: [
          { name: 'types', type: 'string[]', required: false, description: 'Job types to claim: chat_reply | chat_email_reply' },
        ],
        responseExample: {
          job: { id: 'uuid', type: 'string', attempts: 'number', conversation_id: 'uuid', task_id: 'uuid', lease_until: 'ISO-8601', payload: 'object' },
          context: 'object (context bundle, spec section 10)',
          scope: 'object (tool server scope: job_id, client_id, contact_id, can_see_analytics, can_see_billing, sites[{id,domain,ga4_property,gsc_property}])',
        },
      },
    ],
  },
  {
    path: '/api/engine/jobs/{id}/heartbeat',
    group: 'engine',
    methods: [
      {
        method: 'POST',
        summary: 'Extend the job lease by 60 s, at most twice. 409 when the job is not claimed and live.',
        ...authFields,
        responseExample: { lease_until: 'ISO-8601' },
      },
    ],
  },
  {
    path: '/api/engine/jobs/{id}/tool-calls',
    group: 'engine',
    methods: [
      {
        method: 'POST',
        summary: 'Log one tool call before the result goes back to the model. Result is stored capped at 20 KB. 409 if job not live; 429 over 6 calls a job or 40 analytics calls a client a day.',
        ...authFields,
        bodySchema: [
          { name: 'tool', type: 'string', required: true, description: 'Chat tool: ga4_report | search_console | citadel_read | site_pages' },
          { name: 'args', type: 'object', required: true, description: 'Arguments the tool was called with' },
          { name: 'row_count', type: 'number', required: false, description: 'Rows returned' },
          { name: 'latency_ms', type: 'number', required: false, description: 'Tool call latency in milliseconds' },
          { name: 'error', type: 'string', required: false, description: 'Error message if the call failed' },
          { name: 'result', type: 'object', required: false, description: 'Tool result (stored capped at 20 KB)' },
        ],
        responseExample: { id: 'uuid', tool_call_id: 'uuid' },
      },
    ],
  },
  {
    path: '/api/engine/jobs/{id}/read/{kind}',
    group: 'engine',
    methods: [
      {
        method: 'GET',
        summary: 'Returns exactly what the portal shows the job\'s contact. Valid only while the job is claimed and unexpired. kind: requests | work_item | projects | project | retainer | history | reports | invoices | site_pages. site_pages searches this client\'s own site pages (title, path, section heading). invoices need a billing role (403 otherwise).',
        ...authFields,
        queryParams: [
          { name: 'task_id', type: 'uuid', required: false, description: 'Task id' },
          { name: 'project_id', type: 'uuid', required: false, description: 'Project id' },
          { name: 'days', type: 'number', required: false, description: 'Look-back window in days (max 120)' },
          { name: 'site_id', type: 'uuid', required: false, description: 'site_pages: one of the client\'s sites (404 for any other)' },
          { name: 'q', type: 'string', required: false, description: 'site_pages: search text' },
        ],
        responseExample: { kind: 'string', data: 'object' },
      },
    ],
  },
  {
    path: '/api/engine/isolation-names',
    group: 'engine',
    methods: [
      {
        method: 'GET',
        summary: "Every client display name and site domain: the list the runner's isolation check probes a client run against. Engine scope only.",
        auth: 'required',
        responseExample: { names: ['string'], domains: ['string'] },
      },
    ],
  },
];
