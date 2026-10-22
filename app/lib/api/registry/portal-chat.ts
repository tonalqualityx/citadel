import type { ApiEndpoint } from './index';

// Portal client chat controls. Admins and the Bast token (pm/admin roles) only.
const authFields = { auth: 'required' as const, roles: ['pm', 'admin'] };

export const portalChatEndpoints: ApiEndpoint[] = [
  {
    path: '/api/portal-chat/status',
    group: 'portal-chat',
    methods: [
      {
        method: 'GET',
        summary: 'Portal chat mode, runner health, today\'s job counts and spend, and the active caps.',
        ...authFields,
        responseExample: {
          mode: 'off|pilot|on',
          pilot_contact_count: 'number',
          runner: { last_seen_at: 'ISO-8601|null', last_claim_at: 'ISO-8601|null', dead: 'boolean (no runner heartbeat for 3 minutes)' },
          today: {
            jobs: { queued: 'number', claimed: 'number', done: 'number', failed: 'number', expired: 'number' },
            spend_usd: 'number',
          },
          caps: {
            daily_cap_usd: 'number',
            jobs_per_conversation: 'number',
            jobs_per_contact_day: 'number',
            jobs_per_client_day: 'number',
            spend_per_client_day_usd: 'number',
          },
        },
      },
    ],
  },
  {
    path: '/api/portal-chat/sweep',
    group: 'portal-chat',
    methods: [
      {
        method: 'POST',
        summary: 'Portal phase C: the walk-away sweep (runner, every 60 seconds). Queues the away email once per open question after 10 minutes of silence (3 once the tab is closed), the staff-reply email when the client is away, catches stalls, closes answered question chats. Idempotent; never a reminder.',
        ...authFields,
        bodySchema: [
          { name: 'conversation_ids', type: 'string[]', required: false, description: 'Limit the pass to these conversations (tests). Omit to sweep everything (cron).' },
          { name: 'created_after', type: 'string', required: false, description: 'ISO-8601; limit the pass to conversations created at or after this time (tests).' },
        ],
        responseExample: { away: 'number', staff: 'number', stalled: 'number', email_failed: 'number', closed: 'number', filed_unconfirmed: 'number', waits_closed: 'number' },
      },
    ],
  },
  {
    path: '/api/portal-chat/inbound',
    group: 'portal-chat',
    methods: [
      {
        method: 'POST',
        summary: 'Portal phase C: a parsed email reply for a chat (ingest_replies.py). Verifies the sender is a person on the conversation and the mail passed DKIM or DMARC, stores the message idempotently on the RFC Message-ID, queues a chat_email_reply job. An unverified sender is kept as an internal note and never shown to the client.',
        ...authFields,
        bodySchema: [
          { name: 'token', type: 'string', required: false, description: 'The conversation token from the bast+c-{token} address' },
          { name: 'task_id', type: 'string', required: false, description: 'uuid; used when the reply was matched by thread instead of token' },
          { name: 'from_email', type: 'string', required: true, description: 'Sender address' },
          { name: 'text', type: 'string', required: true, description: 'Reply text with quoted history and signature already cut' },
          { name: 'raw', type: 'string', required: false, description: 'Full body, staff view only' },
          { name: 'gmail_id', type: 'string', required: true, description: 'Gmail message id' },
          { name: 'rfc_message_id', type: 'string', required: true, description: 'RFC Message-ID (idempotency)' },
          { name: 'gmail_thread_id', type: 'string', required: false, description: 'Gmail thread id' },
          { name: 'auth_pass', type: 'boolean', required: true, description: 'dkim=pass or dmarc=pass for the From domain, or Google same-domain delivery' },
          { name: 'auth_basis', type: 'string', required: false, description: 'authentication_results | google_internal (only valid for becomeindelible.com senders)' },
          { name: 'attachment_ids', type: 'string[]', required: false, description: 'Ids from /inbound/attachments' },
        ],
        responseExample: { status: 'ingested|repeat|quarantined|no_conversation', conversation_id: 'uuid', comment_id: 'uuid', route: 'job|person', job_id: 'uuid|null' },
      },
    ],
  },
  {
    path: '/api/portal-chat/inbound/attachments',
    group: 'portal-chat',
    methods: [
      {
        method: 'POST',
        summary: 'Portal phase C: stage one email attachment under the verified sender (multipart: file, from_email, token or task_id). Same allowlist as portal uploads.',
        ...authFields,
        responseExample: { attachment: { id: 'uuid', name: 'string', type: 'string', size: 'number' } },
      },
    ],
  },
  {
    path: '/api/portal-chat/settings',
    group: 'portal-chat',
    methods: [
      {
        method: 'GET',
        summary: 'Admin: the chat settings page data. Mode, daily cap, pilot contact ids, every site with its chat switch, and the contacts that can join the pilot.',
        auth: 'required',
        roles: ['admin'],
        responseExample: {
          mode: 'off|pilot|on',
          daily_cap_usd: 'number',
          pilot_contact_ids: 'string[]',
          sites: [{ id: 'uuid', name: 'string', url: 'string|null', client: 'string|null', portal_chat_enabled: 'boolean' }],
          contacts: [{ id: 'uuid', name: 'string', email: 'string|null', role: 'owner|member|viewer', client: 'string' }],
        },
      },
      {
        method: 'PUT',
        summary: 'Admin sets mode, pilot contacts and daily cap. The Bast token may only set mode to off.',
        ...authFields,
        bodySchema: [
          { name: 'mode', type: 'string', required: false, description: 'off | pilot | on' },
          { name: 'pilot_contact_ids', type: 'string[]', required: false, description: 'Contact ids (uuid) in the pilot' },
          { name: 'daily_cap_usd', type: 'number', required: false, description: 'Daily spend cap in USD' },
        ],
        responseExample: { mode: 'off|pilot|on', pilot_contact_ids: 'string[]', daily_cap_usd: 'number' },
      },
    ],
  },
  {
    path: '/api/tasks/{id}/chat',
    group: 'portal-chat',
    methods: [
      {
        method: 'GET',
        summary: 'Portal phase C: the chat on a task for staff. State, slots, the drafted handoff note, attachments, jobs, runs, tool calls (arguments and totals) and cost.',
        auth: 'required',
        responseExample: { state: 'string', mode: 'string', jobs: 'object[]', tool_calls: 'object[]', cost_usd: 'number' },
      },
    ],
  },
  {
    path: '/api/tasks/{id}/chat/hand-back',
    group: 'portal-chat',
    methods: [
      {
        method: 'POST',
        summary: 'Portal phase C: hand a conversation back to the assistant. 409 when it is not with a person.',
        auth: 'required',
        responseExample: { ok: true },
      },
    ],
  },
  {
    path: '/api/tasks/{id}/chat/clear-ask',
    group: 'portal-chat',
    methods: [
      {
        method: 'POST',
        summary: 'Portal phase C: clear an open ask on a question chat (no away email; it closes as an answered question). Posts nothing to the client. 409 not_a_question for a request.',
        auth: 'required',
        responseExample: { ok: true, status: 'cleared', question_closed: true },
      },
    ],
  },
  {
    path: '/api/attachments/{id}',
    group: 'portal-chat',
    methods: [
      {
        method: 'GET',
        summary: 'Portal phase C: a client attachment for staff. nosniff; images inline, the rest a download.',
        auth: 'required',
      },
    ],
  },
];
