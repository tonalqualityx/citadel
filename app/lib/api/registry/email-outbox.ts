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
        summary: 'List unsent outbox mail, oldest first (max 50). Bodies are not included; claim returns the full row. Superseded rows are not listed.',
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
        summary: 'Claim one unsent row (sets claimed_at) and return it with its body (including reply_to and reply_to_gmail_id for portal_chat rows). 409 if already claimed in the last 10 minutes, already sent, or a portal_chat recipient is no longer a person on that chat. After the claim the send-time recheck reads the govern block of the row again: when the governing record made the send wrong, the row is stamped superseded and the answer is 409 with code superseded and a reason. That is final; never retry it. Rows without govern pass and are logged as ungoverned.',
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
  {
    path: '/api/sends/recheck',
    group: 'email-outbox',
    methods: [
      {
        method: 'POST',
        summary: 'Send-time recheck for a send outside the outbox (a worker reply on the client\'s own email thread). Reads the governing record again and says whether the send is still right; with claim it also claims the notice so only the first channel tells the client.',
        ...authFields,
        bodySchema: [
          { name: 'govern', type: 'object', required: true, description: 'The governing record: {intent, task_id|proposal_id|contract_id, snapshot}. Intents: approval_request, approval_mail, golive, magic_link, invite, proposal, contract, chat, notice_internal, none.' },
          { name: 'claim', type: 'string', required: false, description: "'live' (go-live-notified) or 'preview' (preview-notified:<sha1 of the url>). Claimed only when the check passes." },
          { name: 'claim_token', type: 'string', required: false, description: "The preview url, required for claim 'preview'." },
        ],
        responseExample: { ok: true, reason: 'string (when ok is false)', severity: 'definitive|heuristic', mode: 'off|shadow|enforce', claimed: true },
        responseNotes: 'ok:false with reason already_notified and claimed:false means another channel told the client first. Heuristic rules (preview_changed) only drop when AppSettings.send_recheck_heuristics is enforce; in shadow they pass with would_drop.',
      },
    ],
  },
];
