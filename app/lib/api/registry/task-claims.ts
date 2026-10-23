import type { ApiEndpoint } from './index';

// Fleet item 3: atomic task claims with leases. Exactly one live owner per task.
const claimExample = { task_id: 'uuid', holder: 'worker:run-123', token: 'uuid (keep it)', claimed_at: 'ISO-8601', lease_until: 'ISO-8601' };

export const taskClaimEndpoints: ApiEndpoint[] = [
  {
    path: '/api/tasks/:id/claim',
    group: 'task-claims',
    methods: [
      {
        method: 'POST',
        summary: 'Claim a task with a lease. One compare-and-set UPDATE: of two callers racing, exactly one wins.',
        auth: 'required',
        roles: ['pm', 'admin'],
        bodySchema: [
          { name: 'holder', type: 'string', required: true, description: 'Who is claiming, for example worker:<run id>. Max 200.' },
          { name: 'ttl_seconds', type: 'number', required: false, description: 'Lease length. Clamped to 60..21600, default 1800.' },
          { name: 'set_in_progress', type: 'boolean', required: false, description: 'Move a not_started or blocked task to in_progress in the same statement.' },
        ],
        responseExample: claimExample,
        responseNotes:
          '409 code claim_taken (body has holder and lease_until) when another holder has a live lease. 409 code closed when the task is done or abandoned. The same holder claiming again keeps its token and extends the lease. An expired lease can be taken by anyone. The token is the proof of ownership: send it as X-Claim-Token on /staged, /live and status PATCHes.',
      },
      {
        method: 'GET',
        summary: 'Who holds the task and until when. Never returns the token.',
        auth: 'required',
        roles: ['pm', 'admin'],
        responseExample: { task_id: 'uuid', status: 'in_progress', holder: 'string|null', claimed_at: 'ISO-8601|null', lease_until: 'ISO-8601|null', live: 'boolean' },
      },
    ],
  },
  {
    path: '/api/tasks/:id/claim/renew',
    group: 'task-claims',
    methods: [
      {
        method: 'POST',
        summary: 'Extend a live lease. Needs the claim token.',
        auth: 'required',
        roles: ['pm', 'admin'],
        bodySchema: [
          { name: 'token', type: 'string', required: true, description: 'The claim token from the claim call' },
          { name: 'ttl_seconds', type: 'number', required: false, description: 'New lease length from now. Clamped to 60..21600, default 1800.' },
        ],
        responseExample: claimExample,
        responseNotes: '409 code claim_lost when the token is wrong or the lease already lapsed.',
      },
    ],
  },
  {
    path: '/api/tasks/:id/claim/release',
    group: 'task-claims',
    methods: [
      {
        method: 'POST',
        summary: 'Give a claim up, optionally moving the task to a status in the same statement.',
        auth: 'required',
        roles: ['pm', 'admin'],
        bodySchema: [
          { name: 'token', type: 'string', required: true, description: 'The claim token' },
          { name: 'status', type: 'string', required: false, description: 'not_started, in_progress, review or blocked. done and abandoned go through their own routes.' },
        ],
        responseExample: { released: 'boolean' },
        responseNotes: 'A wrong token changes nothing and answers released:false.',
      },
    ],
  },
  {
    path: '/api/tasks/claims/renew-holder',
    group: 'task-claims',
    methods: [
      {
        method: 'POST',
        summary: 'Extend every live lease one holder owns (the worker background renewer).',
        auth: 'required',
        roles: ['pm', 'admin'],
        bodySchema: [
          { name: 'holder', type: 'string', required: true, description: 'The holder string' },
          { name: 'ttl_seconds', type: 'number', required: false, description: 'Clamped to 60..21600, default 1800' },
        ],
        responseExample: { renewed: 'number' },
      },
    ],
  },
  {
    path: '/api/tasks/claims/release-holder',
    group: 'task-claims',
    methods: [
      {
        method: 'POST',
        summary: 'Release every claim one holder owns (the worker cleanup trap).',
        auth: 'required',
        roles: ['pm', 'admin'],
        bodySchema: [{ name: 'holder', type: 'string', required: true, description: 'The holder string' }],
        responseExample: { released: 'number' },
      },
    ],
  },
];
