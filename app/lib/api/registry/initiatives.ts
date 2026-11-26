import type { ApiEndpoint, ParamDef } from './index';

const numberFields: ParamDef[] = [
  { name: 'label', type: 'string', required: true, description: 'What is counted (max 120)' },
  { name: 'unit', type: 'string', required: true, description: 'count | percent | dollars | hours' },
  { name: 'direction', type: 'string', required: true, description: 'up | down' },
  { name: 'target_value', type: 'number', required: true, description: 'The value to reach' },
  { name: 'target_by', type: 'string', required: true, description: 'Date the target is due (YYYY-MM-DD)' },
  { name: 'baseline_value', type: 'number', required: false, description: 'Where it stands today; when omitted the first reading becomes the baseline' },
  { name: 'baseline_at', type: 'ISO-8601', required: false, description: 'When the baseline was read (defaults to now when a baseline_value is given)' },
  { name: 'source', type: 'string', required: false, description: 'manual (default) | citadel:<key> | ga4 | gsc (max 40). citadel:<key> numbers are read nightly by /api/cron/initiative-numbers.' },
  { name: 'position', type: 'number', required: false, description: 'Order among the initiative\'s numbers (defaults to the next slot)' },
];

const numberResponse = {
  id: 'uuid', initiative_id: 'uuid', label: 'string', unit: 'string', direction: 'string',
  baseline_value: 'number|null', baseline_at: 'ISO-8601|null', target_value: 'number', target_by: 'ISO-8601',
  source: 'string', last_value: 'number|null', last_read_at: 'ISO-8601|null', position: 'number',
};

const initiativeResponse = {
  id: 'uuid', name: 'string', bet: 'string', nightmare: 'string|null', prevention: 'string|null', repair: 'string|null',
  cost_of_waiting: 'string|null', stop_condition: 'string|null', check_date: 'ISO-8601|null', check_every_days: 'number|null',
  next_decision: 'string|null', status: 'proposed|active|paused|done|stopped', health: 'on_track|behind|unchecked',
  health_reason: 'string|null', owner_id: 'uuid', client_id: 'uuid|null', sort_order: 'number', activated_at: 'ISO-8601|null',
  closed_at: 'ISO-8601|null', closed_reason: 'string|null', created_by_id: 'uuid', created_at: 'ISO-8601', updated_at: 'ISO-8601',
  numbers: [numberResponse],
  latest_check_in: { id: 'uuid', health: 'string', note: 'string|null', author_id: 'uuid', created_at: 'ISO-8601' },
};

const fieldParams: ParamDef[] = [
  { name: 'name', type: 'string', required: true, description: 'Max 120' },
  { name: 'bet', type: 'string', required: false, description: 'What we believe will happen if we do this. Required non-empty to activate.' },
  { name: 'nightmare', type: 'string', required: false, description: 'The worst realistic outcome' },
  { name: 'prevention', type: 'string', required: false, description: 'What keeps the nightmare from happening' },
  { name: 'repair', type: 'string', required: false, description: 'What we do if it happens anyway' },
  { name: 'cost_of_waiting', type: 'string', required: false, description: 'What doing nothing costs' },
  { name: 'stop_condition', type: 'string', required: false, description: 'When to stop' },
  { name: 'check_date', type: 'string', required: false, description: 'Next date the bet is looked at (YYYY-MM-DD)' },
  { name: 'check_every_days', type: 'number', required: false, description: 'Cadence; a check-in rolls check_date forward by this many days' },
  { name: 'next_decision', type: 'string', required: false, description: 'The one decision that keeps it moving (max 300)' },
  { name: 'status', type: 'string', required: false, description: 'proposed (default) | active | paused | done | stopped. Active needs a bet and one number; at most five active (409 initiative_cap). active sets activated_at; done and stopped set closed_at.' },
  { name: 'health_reason', type: 'string', required: false, description: 'One line (max 200); recomputed on every reading or check-in' },
  { name: 'owner_id', type: 'uuid', required: false, description: 'Defaults to the caller' },
  { name: 'client_id', type: 'uuid', required: false, description: 'Indelible by default (null)' },
  { name: 'sort_order', type: 'number', required: false, description: 'Display order' },
  { name: 'closed_reason', type: 'string', required: false, description: 'Why it was closed' },
];

export const initiativeEndpoints: ApiEndpoint[] = [
  {
    path: '/api/initiatives',
    group: 'initiatives',
    methods: [
      {
        method: 'GET',
        summary: 'List initiatives (not deleted) with their numbers and latest check-in.',
        auth: 'required',
        queryParams: [{ name: 'status', type: 'string', required: false, description: 'proposed | active | paused | done | stopped' }],
        responseExample: { initiatives: [initiativeResponse], total: 'number' },
      },
      {
        method: 'POST',
        summary: 'Create an initiative with 0 to 3 numbers. 409 number_cap for a fourth; 409 initiative_cap, 422 bet_required or number_required when created active and a rule fails.',
        auth: 'required',
        roles: ['pm', 'admin'],
        bodySchema: [
          ...fieldParams,
          { name: 'numbers', type: 'object', required: false, description: 'Array of 0 to 3 numbers: ' + numberFields.map((f) => f.name).join(', ') },
        ],
        responseExample: initiativeResponse,
      },
    ],
  },
  {
    path: '/api/initiatives/:id',
    group: 'initiatives',
    methods: [
      { method: 'GET', summary: 'Get one initiative with its numbers and latest check-in.', auth: 'required', responseExample: initiativeResponse },
      {
        method: 'PATCH',
        summary: 'Update any field, including status. Same activation rules as create; changing check_date recomputes health.',
        auth: 'required',
        roles: ['pm', 'admin'],
        bodySchema: fieldParams.map((f) => ({ ...f, required: false })),
        responseExample: initiativeResponse,
      },
      { method: 'DELETE', summary: 'Soft delete (is_deleted).', auth: 'required', roles: ['pm', 'admin'], responseExample: { success: true } },
    ],
  },
  {
    path: '/api/initiatives/:id/numbers',
    group: 'initiatives',
    methods: [
      {
        method: 'POST',
        summary: 'Add a number. 409 number_cap when the initiative already has three.',
        auth: 'required',
        roles: ['pm', 'admin'],
        bodySchema: numberFields,
        responseExample: numberResponse,
      },
    ],
  },
  {
    path: '/api/initiatives/:id/numbers/:numberId',
    group: 'initiatives',
    methods: [
      {
        method: 'PATCH',
        summary: 'Update a number; health is recomputed.',
        auth: 'required',
        roles: ['pm', 'admin'],
        bodySchema: numberFields.map((f) => ({ ...f, required: false })),
        responseExample: numberResponse,
      },
      {
        method: 'DELETE',
        summary: 'Delete a number and its readings. 422 number_required when it is the last number of an active initiative.',
        auth: 'required',
        roles: ['pm', 'admin'],
        responseExample: { success: true },
      },
    ],
  },
  {
    path: '/api/initiatives/:id/readings',
    group: 'initiatives',
    methods: [
      {
        method: 'POST',
        summary: 'Record a reading for one number. Updates last_value and last_read_at, takes the first reading as the baseline when there is none, and recomputes health.',
        auth: 'required',
        roles: ['pm', 'admin'],
        bodySchema: [
          { name: 'number_id', type: 'uuid', required: true, description: 'A number of this initiative' },
          { name: 'value', type: 'number', required: true, description: 'The value read' },
          { name: 'read_at', type: 'ISO-8601', required: false, description: 'Defaults to now' },
          { name: 'source', type: 'string', required: false, description: 'manual (default) | chat | citadel | ga4 | gsc (max 40)' },
        ],
        responseExample: { reading: { id: 'uuid', number_id: 'uuid', value: 'number', read_at: 'ISO-8601', source: 'string' }, number: numberResponse, initiative: initiativeResponse },
      },
    ],
  },
  {
    path: '/api/initiatives/:id/check-ins',
    group: 'initiatives',
    methods: [
      {
        method: 'POST',
        summary: 'Record a check-in (the owner\'s read). A check-in newer than the newest reading decides health until the next check date. With check_every_days set, check_date rolls forward.',
        auth: 'required',
        roles: ['pm', 'admin'],
        bodySchema: [
          { name: 'health', type: 'string', required: true, description: 'on_track | behind | unchecked' },
          { name: 'note', type: 'string', required: false, description: 'One line (max 300)' },
        ],
        responseExample: { check_in: { id: 'uuid', health: 'string', note: 'string|null', author_id: 'uuid', created_at: 'ISO-8601' }, initiative: initiativeResponse },
      },
    ],
  },
  {
    path: '/api/initiatives/:id/attach',
    group: 'initiatives',
    methods: [
      {
        method: 'POST',
        summary: 'link one project, one task or one recurring work row to this initiative. Send exactly one of project_id, task_id or recurring_work_id. An item already on another initiative moves here (moved_from names the old one). 404 for an unknown initiative, project or task.',
        auth: 'required',
        roles: ['pm', 'admin'],
        bodySchema: [
          { name: 'project_id', type: 'uuid', required: false, description: 'The project to attach (send exactly one of project_id, task_id, recurring_work_id)' },
          { name: 'task_id', type: 'uuid', required: false, description: 'The task to attach' },
          { name: 'recurring_work_id', type: 'uuid', required: false, description: 'The recurring work row to attach' },
        ],
        responseExample: { attached: 'boolean', kind: 'project|task|recurring_work', id: 'uuid', name: 'string', initiative_id: 'uuid', moved_from: 'uuid|null' },
      },
    ],
  },
  {
    path: '/api/initiatives/:id/detach',
    group: 'initiatives',
    methods: [
      {
        method: 'POST',
        summary: 'Unlink one project, one task or one recurring work row, only when it points at this initiative. Send exactly one of project_id, task_id or recurring_work_id. 409 not_attached_here when it is attached elsewhere or nowhere.',
        auth: 'required',
        roles: ['pm', 'admin'],
        bodySchema: [
          { name: 'project_id', type: 'uuid', required: false, description: 'The project to detach (send exactly one of project_id, task_id, recurring_work_id)' },
          { name: 'task_id', type: 'uuid', required: false, description: 'The task to detach' },
          { name: 'recurring_work_id', type: 'uuid', required: false, description: 'The recurring work row to detach' },
        ],
        responseExample: { attached: 'boolean', kind: 'project|task|recurring_work', id: 'uuid', name: 'string', initiative_id: 'null' },
      },
    ],
  },
  {
    path: '/api/cron/initiative-numbers',
    group: 'initiatives',
    methods: [
      {
        method: 'POST',
        summary: 'Nightly read of Citadel-computed initiative numbers (source citadel:<key>) and a health refresh of every non-deleted initiative (cron).',
        auth: 'cron',
        responseExample: { success: true, read: 'number', skipped: [{ number_id: 'uuid', source: 'string', reason: 'string' }], refreshed: 'number' },
        responseNotes: 'Requires x-cron-secret header matching CRON_SECRET env var. Keys: projects_signed, proposals_sent, charters_active, retainer_hours_sold. One reading per number per UTC day; unknown keys are listed in skipped.',
      },
    ],
  },
];
