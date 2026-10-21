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
          runner: { last_claim_at: 'ISO-8601|null', dead: 'boolean' },
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
