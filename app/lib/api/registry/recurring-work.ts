import type { ApiEndpoint, ParamDef } from './index';

const recurringResponse = {
  id: 'uuid', kind: 'citadel_task|machine_job|engine', title: 'string|null (falls back to the SOP title)',
  charter_id: 'uuid|null', charter: { id: 'uuid', name: 'string' }, charter_ware_id: 'uuid|null',
  sop_id: 'uuid|null', sop: { id: 'uuid', title: 'string' }, cadence: 'weekly|monthly|quarterly|semi_annually|annually|null',
  schedule_text: 'string|null', cron_expr: 'string|null', job_key: 'string|null', source_kind: 'string|null', source_id: 'uuid|null',
  owner_id: 'uuid|null', owner: { id: 'uuid', name: 'string' }, produces: 'string|null',
  client_id: 'uuid|null', client: { id: 'uuid', name: 'string' }, site_id: 'uuid|null', site: { id: 'uuid', name: 'string' },
  initiative_id: 'uuid|null', initiative: { id: 'uuid', name: 'string' }, is_plumbing: 'boolean',
  last_run_at: 'ISO-8601|null', last_run_ok: 'boolean|null', last_run_note: 'string|null', next_run_at: 'ISO-8601|null',
  paused_on_purpose: 'boolean', sort_order: 'number', is_active: 'boolean', created_at: 'ISO-8601', updated_at: 'ISO-8601',
};

const fieldParams: ParamDef[] = [
  { name: 'title', type: 'string', required: false, description: 'Max 200; for citadel_task it falls back to the SOP title' },
  { name: 'charter_id', type: 'uuid', required: false, description: 'Charter this row belongs to; client_id and site_id come from it when not given' },
  { name: 'charter_ware_id', type: 'uuid', required: false, description: 'Charter ware this row serves' },
  { name: 'sop_id', type: 'uuid', required: false, description: 'Required for citadel_task' },
  { name: 'cadence', type: 'string', required: false, description: 'weekly | monthly | quarterly | semi_annually | annually. Required for citadel_task' },
  { name: 'schedule_text', type: 'string', required: false, description: 'Human words, max 120: "every weekday at 7am"' },
  { name: 'cron_expr', type: 'string', required: false, description: 'Required for machine_job (max 60)' },
  { name: 'job_key', type: 'string', required: false, description: 'Job watch id; required for machine_job, unique (max 120)' },
  { name: 'source_kind', type: 'string', required: false, description: 'Required for engine: troubador_schedule | maintenance_plan' },
  { name: 'source_id', type: 'uuid', required: false, description: 'Required for engine: the id of the schedule or plan' },
  { name: 'owner_id', type: 'uuid', required: false, description: 'The person or bot who answers for it' },
  { name: 'produces', type: 'string', required: false, description: 'What each run produces (max 300)' },
  { name: 'client_id', type: 'uuid', required: false, description: 'Client; a non-charter citadel_task row with none generates for Indelible' },
  { name: 'site_id', type: 'uuid', required: false, description: 'Site' },
  { name: 'initiative_id', type: 'uuid', required: false, description: 'Optional initiative this serves' },
  { name: 'is_plumbing', type: 'boolean', required: false, description: 'Background job with no output Mike reads (hidden from the list by default)' },
  { name: 'paused_on_purpose', type: 'boolean', required: false, description: 'Stopped on purpose' },
  { name: 'sort_order', type: 'number', required: false, description: 'Display order' },
  { name: 'is_active', type: 'boolean', required: false, description: 'false deactivates; there is no hard delete' },
];

export const recurringWorkEndpoints: ApiEndpoint[] = [
  {
    path: '/api/recurring-work',
    group: 'recurring-work',
    methods: [
      {
        method: 'GET',
        summary: 'List recurring work (charter scheduled tasks are the same rows). Plumbing rows are hidden unless include_plumbing=true.',
        auth: 'required',
        queryParams: [
          { name: 'kind', type: 'string', required: false, description: 'citadel_task | machine_job | engine' },
          { name: 'client_id', type: 'uuid', required: false, description: 'Filter by client' },
          { name: 'charter_id', type: 'uuid', required: false, description: 'Filter by charter' },
          { name: 'initiative_id', type: 'uuid', required: false, description: 'Filter by initiative' },
          { name: 'owner_id', type: 'uuid', required: false, description: 'Filter by owner' },
          { name: 'is_active', type: 'boolean', required: false, description: 'true | false' },
          { name: 'include_plumbing', type: 'boolean', required: false, description: 'true to include background plumbing rows' },
        ],
        responseExample: { recurring_work: [recurringResponse], total: 'number' },
      },
      {
        method: 'POST',
        summary: 'Create a recurring work record. citadel_task needs sop_id and cadence; machine_job needs cron_expr and job_key; engine needs source_kind and source_id. 404 for an unknown charter, SOP, owner, client, site or initiative.',
        auth: 'required',
        roles: ['pm', 'admin'],
        bodySchema: [{ name: 'kind', type: 'string', required: false, description: 'citadel_task (default) | machine_job | engine' }, ...fieldParams],
        responseExample: recurringResponse,
      },
    ],
  },
  {
    path: '/api/recurring-work/:id',
    group: 'recurring-work',
    methods: [
      { method: 'GET', summary: 'One recurring work record with owner, initiative, SOP, charter, client and site names.', auth: 'required', responseExample: recurringResponse },
      {
        method: 'PATCH',
        summary: 'Update any field except kind. Deactivate with is_active: false (no hard delete). The kind\'s required fields must stay set.',
        auth: 'required',
        roles: ['pm', 'admin'],
        bodySchema: fieldParams,
        responseExample: recurringResponse,
      },
    ],
  },
];
