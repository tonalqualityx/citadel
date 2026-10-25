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
        ],
        responseExample: claimExample,
        responseNotes:
          '400 when the task id is not a uuid. 409 code claim_taken (body has holder and lease_until) when another holder has a live lease. 409 code closed when the task is done or abandoned. The same holder claiming again keeps its token and extends the lease. An expired lease can be taken by anyone. The response carries `token` (the spec should list it). The token is the proof of ownership: send it as X-Claim-Token on /staged, /live and any PATCH that carries a status. A claim never changes the task status. A pm or admin on a browser session may move a claimed task without the token (the claim is then cleared and an activity line is written); API keys stay under the check.',
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
        responseNotes: "400 when the task id is not a uuid. 409 code claim_lost when the token is wrong or the lease already lapsed.",
      },
    ],
  },
  {
    path: '/api/tasks/:id/claim/release',
    group: 'task-claims',
    methods: [
      {
        method: 'POST',
        summary: 'Give a claim up. Clears the claim only; the status is never changed here.',
        auth: 'required',
        roles: ['pm', 'admin'],
        bodySchema: [
          { name: 'token', type: 'string', required: true, description: 'The claim token' },
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
