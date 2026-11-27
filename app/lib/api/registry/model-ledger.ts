import type { ApiEndpoint } from './index';

const line = {
  model: 'string (haiku|sonnet|opus|fable|unknown)', task_type: 'string', runs: 'number', cards: 'number', finished: 'number',
  first_try: 'number', escalations: 'number', cost_usd: 'number (estimate at API list prices)',
  first_try_rate: 'number|null (first_try / cards)', cost_per_finished_card: 'number|null (cost_usd / finished)',
};

export const modelLedgerEndpoints: ApiEndpoint[] = [
  {
    path: '/api/model-ledger/days',
    group: 'model-ledger',
    methods: [
      {
        method: 'GET',
        summary: 'The model ledger rollup over the last N days (Eastern, counting today): totals per model and task type, most expensive first.',
        auth: 'required',
        queryParams: [{ name: 'days', type: 'number', required: false, description: '1 to 90, default 7' }],
        responseExample: { window_days: 'number', since: 'YYYY-MM-DD', latest_day: 'YYYY-MM-DD|null', total_cost_usd: 'number', total_runs: 'number', lines: [line] },
      },
      {
        method: 'POST',
        summary: 'The Bast machine\'s daily rollup (model-ledger.py rollup --push). Upserts each (day, model, task_type) row, replacing that row\'s numbers; never deletes. 1 to 500 rows; a duplicate key in one push is a 400.',
        auth: 'required',
        roles: ['pm', 'admin'],
        bodySchema: [
          { name: 'rows', type: 'object', required: true, description: 'Each: day (YYYY-MM-DD), model, task_type, runs, cards, finished, first_try, escalations, cost_usd, unpriced_runs' },
        ],
        responseExample: { upserted: 'number' },
      },
    ],
  },
];
