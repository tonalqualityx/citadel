import type { ApiEndpoint } from './index';

// Outbound mail queue drained by the Bast machine (see lib/services/email.ts).
const authFields = { auth: 'required' as const, roles: ['pm', 'admin'] };

export const emailOutboxEndpoints: ApiEndpoint[] = [
  {
    path: '/api/email-outbox',
    group: 'email-outbox',
    methods: [
      {
        method: 'GET',
        summary: 'List unsent outbox mail, oldest first (max 50). Bodies are not included; claim returns the full row.',
        ...authFields,
        responseExample: {
          items: [{
            id: 'uuid', to: 'string', cc: 'string|null', subject: 'string',
            kind: 'magic_link|invite|proposal|contract|notification|portal_chat|other', from_account: 'string',
            allow_external: 'boolean', attempts: 'number', claimed_at: 'ISO-8601|null',
            created_at: 'ISO-8601', last_error: 'string|null', reply_to: 'string|null', task_id: 'uuid|null',
          }],
        },
      },
    ],
  },
  {
    path: '/api/email-outbox/{id}/claim',
    group: 'email-outbox',
    methods: [
      {
        method: 'POST',
        summary: 'Claim one unsent row (sets claimed_at) and return it with its body (including reply_to and reply_to_gmail_id for portal_chat rows). 409 if already claimed in the last 10 minutes, already sent, or a portal_chat recipient is no longer a person on that chat.',
        ...authFields,
        responseExample: {
          id: 'uuid', to: 'string', cc: 'string|null', subject: 'string', text: 'string', html: 'string|null',
          from_account: 'string', kind: 'string', allow_external: 'boolean', claimed_at: 'ISO-8601',
        },
      },
    ],
  },
  {
    path: '/api/email-outbox/{id}/sent',
    group: 'email-outbox',
    methods: [
      {
        method: 'POST',
        summary: 'Record a delivered message. Idempotent. Scrubs the stored body.',
        ...authFields,
        bodySchema: [
          { name: 'message_id', type: 'string', required: false, description: 'Gmail message id from the send' },
          { name: 'rfc_message_id', type: 'string', required: false, description: 'RFC Message-ID of the sent message (portal_chat rows)' },
          { name: 'gmail_thread_id', type: 'string', required: false, description: 'Gmail thread id of the sent message (portal_chat rows)' },
        ],
        responseExample: { id: 'uuid', sent_at: 'ISO-8601', message_id: 'string|null' },
      },
    ],
  },
  {
    path: '/api/email-outbox/{id}/failed',
    group: 'email-outbox',
    methods: [
      {
        method: 'POST',
        summary: 'Record a failed send: attempts + 1, last_error set, claim released.',
        ...authFields,
        bodySchema: [{ name: 'last_error', type: 'string', required: true, description: 'Why the send failed' }],
        responseExample: { id: 'uuid', attempts: 'number', last_error: 'string' },
      },
    ],
  },
];
