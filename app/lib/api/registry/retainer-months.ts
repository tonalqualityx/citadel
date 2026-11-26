import type { ApiEndpoint, ParamDef } from './index';

const itemResponse = {
  id: 'uuid', title: 'string', estimate_min_low: 'number (minutes)', estimate_min_high: 'number (minutes)',
  task_id: 'uuid|null', recurring_work_id: 'uuid|null', position: 'number', used_minutes: 'number (counted time on the item\'s task)',
};

const monthResponse = {
  id: 'uuid', charter_id: 'uuid', charter_name: 'string', client_id: 'uuid', client_name: 'string', month: 'YYYY-MM',
  state: 'planning|planned|closed', hours_allotted: 'number', planning_task_id: 'uuid|null', created_at: 'ISO-8601 (when drafted)', planned_at: 'ISO-8601|null',
  planned_by_id: 'uuid|null (null = the draft stood)', note: 'string|null',
  used_minutes: 'number (frozen when closed)', outside_minutes: 'number (counted time on tasks no item covers)',
  unassigned_minutes: 'number (client time on retainer-work tasks with no charter, when the client has two or more monthly charters; not counted)',
  frozen: 'boolean',
  outside: [{ id: 'uuid', title: 'string', minutes: 'number' }],
  items: [itemResponse],
};

const itemFields: ParamDef[] = [
  { name: 'title', type: 'string', required: true, description: 'Named work, max 200 (on PATCH optional)' },
  { name: 'estimate_min_low', type: 'number', required: true, description: 'Minutes; must be <= estimate_min_high (on PATCH optional)' },
  { name: 'estimate_min_high', type: 'number', required: true, description: 'Minutes (on PATCH optional)' },
  { name: 'task_id', type: 'uuid', required: false, description: 'The task that does it; time on it counts as this item\'s used' },
  { name: 'recurring_work_id', type: 'uuid', required: false, description: 'The recurring row it comes from' },
  { name: 'position', type: 'number', required: false, description: 'Order; defaults to the end' },
];

export const retainerMonthEndpoints: ApiEndpoint[] = [
  {
    path: '/api/retainer-months',
    group: 'retainer-months',
    methods: [
      {
        method: 'GET',
        summary: 'Every active monthly charter\'s retainer month for one month (default: this month), with used against allotment, items, and time outside the plan.',
        auth: 'required',
        queryParams: [{ name: 'month', type: 'string', required: false, description: 'YYYY-MM; defaults to the current month' }],
        responseExample: { month: 'YYYY-MM', retainers: [monthResponse], upcoming: [monthResponse] },
        responseNotes: 'upcoming holds the following month\'s rows (drafted from the 25th), so a plan waiting to be confirmed shows before its month starts.',
      },
    ],
  },
  {
    path: '/api/retainer-months/:id',
    group: 'retainer-months',
    methods: [{ method: 'GET', summary: 'One retainer month with its items, used and outside-the-plan time.', auth: 'required', responseExample: monthResponse }],
  },
  {
    path: '/api/retainer-months/:id/confirm',
    group: 'retainer-months',
    methods: [
      {
        method: 'POST',
        summary: '"Use this plan": the month becomes planned (planned_at, planned_by) and its planning task is marked done if still open. 409 on a closed month.',
        auth: 'required',
        roles: ['pm', 'admin'],
        responseExample: monthResponse,
      },
    ],
  },
  {
    path: '/api/retainer-months/:id/items',
    group: 'retainer-months',
    methods: [
      {
        method: 'POST',
        summary: 'Add named work to the month\'s plan. 400 when low > high; 409 on a closed month.',
        auth: 'required',
        roles: ['pm', 'admin'],
        bodySchema: itemFields,
        responseExample: itemResponse,
      },
    ],
  },
  {
    path: '/api/retainer-months/:id/items/:itemId',
    group: 'retainer-months',
    methods: [
      {
        method: 'PATCH',
        summary: 'Change an item (any field). 400 when low > high; 409 on a closed month.',
        auth: 'required',
        roles: ['pm', 'admin'],
        bodySchema: itemFields.map((f) => ({ ...f, required: false })),
        responseExample: itemResponse,
      },
      { method: 'DELETE', summary: 'Remove an item from the plan. 409 on a closed month.', auth: 'required', roles: ['pm', 'admin'], responseExample: { success: true } },
    ],
  },
  {
    path: '/api/charters/:id/retainer-months',
    group: 'retainer-months',
    methods: [
      {
        method: 'GET',
        summary: 'A charter\'s current retainer month in full, next month\'s plan when it exists, and its past months as one line of data each.',
        auth: 'required',
        responseExample: {
          charter_id: 'uuid', billing_period: 'monthly|annually', current: monthResponse, upcoming: 'same shape as current, or null when next month has no row yet',
          past: [{ id: 'uuid', month: 'YYYY-MM', state: 'string', hours_allotted: 'number', used_minutes: 'number', outside_minutes: 'number' }],
        },
      },
    ],
  },
  {
    path: '/api/cron/retainer-months',
    group: 'retainer-months',
    methods: [
      {
        method: 'POST',
        summary: 'Daily retainer month cycle (cron): drafts next month from the 25th, drafts a missing current month, lets an unconfirmed plan stand after the 1st, closes past months.',
        auth: 'cron',
        responseExample: { success: true, drafted: 'number', planningTasks: 'number', autoPlanned: 'number', closed: 'number', errors: ['string'] },
        responseNotes: 'Requires x-cron-secret header matching CRON_SECRET env var. A current month drafted after its 1st is created planned with no planning task.',
      },
    ],
  },
];
