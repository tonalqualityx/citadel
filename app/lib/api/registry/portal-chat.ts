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
];
