import type { ApiEndpoint } from './index';

// KPI records and onboarding checklists (Saturday 10-24 run, item 3; specs/citadel-shape-SPEC.md
// 3.4, 3.12, 3.15). Staff only. Nothing here is client-visible; the portal reads a separate
// allow-listed projection behind the PORTAL_KPI_VIEWS and PORTAL_ONBOARD_CHECKLIST switches.
const kpiExample = {
  id: 'uuid',
  client_id: 'uuid',
  site_id: 'uuid|null',
  accord_id: 'uuid|null',
  charter_id: 'uuid|null',
  metric: 'sessions|leads|revenue|uptime|rank:<keyword>',
  label: 'string',
  direction: 'up|down',
  baseline_value: 'number|null',
  baseline_at: 'ISO-8601|null',
  target_value: 'number|null',
  target_by: 'YYYY-MM-DD|null',
  source: 'ga4|gsc|kuma|manual',
  status: 'proposed|confirmed|retired',
  confirmed_at: 'ISO-8601|null',
  last_value: 'number|null',
  last_checked_at: 'ISO-8601|null',
};

const proposalItem = {
  metric: 'string (1 to 60 characters)',
  label: 'string (1 to 200 characters)',
  direction: 'up|down',
  baseline_value: 'number (optional)',
  target_value: 'number (optional)',
  target_by: 'YYYY-MM-DD (optional)',
  source: 'ga4|gsc|kuma|manual',
  site_id: 'uuid (optional)',
};

const checklistExample = {
  id: 'uuid',
  kind: 'onboarding|offboarding|takeover',
  client_id: 'uuid',
  accord_id: 'uuid|null',
  charter_id: 'uuid|null',
  project_id: 'uuid|null',
  started_at: 'ISO-8601',
  done_at: 'ISO-8601|null',
  done: 'boolean',
  blocking_keys: ['people.approver'],
  items: [
    {
      key: 'assets.logo',
      label: 'Logo received',
      client_label: 'Your logo file',
      group: 'access|assets|people|reference|billing|meeting',
      required: 'boolean',
      gate: 'before_work|before_launch|none',
      state: 'missing|received|verified|waived|not_applicable',
      verified_by_id: 'uuid|null',
      verified_at: 'ISO-8601|null',
      evidence: 'string|null',
    },
  ],
};

export const kpiChecklistEndpoints: ApiEndpoint[] = [
  {
    path: '/api/site-kpis',
    group: 'kpis',
    methods: [
      {
        method: 'GET',
        summary: 'List KPI rows for a client or a site. Retired rows are left out unless status is retired or all.',
        auth: 'required',
        roles: ['pm', 'admin'],
        queryParams: [
          { name: 'client_id', type: 'uuid', required: false, description: 'Give client_id or site_id' },
          { name: 'site_id', type: 'uuid', required: false, description: 'Give client_id or site_id' },
          { name: 'status', type: 'string', required: false, description: 'proposed, confirmed, retired, or all. Default: everything except retired.' },
        ],
        responseExample: { data: [kpiExample], meta: { count: 'number' } },
      },
      {
        method: 'POST',
        summary: 'Create one KPI row. Proposed by default; send status confirmed to confirm it at once.',
        auth: 'required',
        roles: ['pm', 'admin'],
        bodySchema: [
          { name: 'client_id', type: 'uuid', required: true, description: 'The client' },
          { name: 'site_id', type: 'uuid', required: false, description: 'A site of that client' },
          { name: 'accord_id', type: 'uuid', required: false, description: 'An accord of that client' },
          { name: 'charter_id', type: 'uuid', required: false, description: 'A charter of that client' },
          { name: 'metric', type: 'string', required: true, description: 'sessions, leads, revenue, uptime, or rank:<keyword> (up to 60 characters)' },
          { name: 'label', type: 'string', required: true, description: 'The goal in plain words (up to 200 characters)' },
          { name: 'direction', type: 'string', required: true, description: 'up or down' },
          { name: 'source', type: 'string', required: true, description: 'ga4, gsc, kuma or manual' },
          { name: 'baseline_value', type: 'number', required: false, description: 'Where it started' },
          { name: 'baseline_at', type: 'ISO-8601', required: false, description: 'When the baseline was taken' },
          { name: 'target_value', type: 'number', required: false, description: 'The target' },
          { name: 'target_by', type: 'string', required: false, description: 'YYYY-MM-DD' },
          { name: 'status', type: 'string', required: false, description: 'proposed (default) or confirmed' },
        ],
        responseExample: kpiExample,
        responseNotes: '201 when created. A linked site, accord or charter that is not the client\'s answers 400.',
      },
    ],
  },
  {
    path: '/api/site-kpis/{id}',
    group: 'kpis',
    methods: [
      { method: 'GET', summary: 'One KPI row.', auth: 'required', roles: ['pm', 'admin'], responseExample: kpiExample },
      {
        method: 'PATCH',
        summary: 'Edit a KPI row. The metric and the client never change.',
        auth: 'required',
        roles: ['pm', 'admin'],
        bodySchema: [
          { name: 'label', type: 'string', required: false, description: 'Plain words' },
          { name: 'direction', type: 'string', required: false, description: 'up or down' },
          { name: 'source', type: 'string', required: false, description: 'ga4, gsc, kuma or manual' },
          { name: 'site_id', type: 'uuid', required: false, description: 'A site of the client; null clears it' },
          { name: 'charter_id', type: 'uuid', required: false, description: 'A charter of the client; null clears it' },
          { name: 'baseline_value', type: 'number', required: false, description: 'null clears it' },
          { name: 'baseline_at', type: 'ISO-8601', required: false, description: 'null clears it' },
          { name: 'target_value', type: 'number', required: false, description: 'null clears it' },
          { name: 'target_by', type: 'string', required: false, description: 'YYYY-MM-DD; null clears it' },
          { name: 'status', type: 'string', required: false, description: 'proposed, confirmed or retired' },
          { name: 'last_value', type: 'number', required: false, description: 'Latest reading' },
          { name: 'last_checked_at', type: 'ISO-8601', required: false, description: 'When it was read' },
        ],
        responseExample: kpiExample,
        responseNotes: 'Unknown fields answer 400.',
      },
      {
        method: 'DELETE',
        summary: 'Retire the KPI. Never a hard delete: the row stays with status retired.',
        auth: 'required',
        roles: ['pm', 'admin'],
        responseExample: { ...kpiExample, status: 'retired' },
      },
    ],
  },
  {
    path: '/api/accords/{id}/kpi-proposal',
    group: 'kpis',
    methods: [
      {
        method: 'GET',
        summary: 'The KPI proposal stored on the accord (null when none).',
        auth: 'required',
        roles: ['pm', 'admin'],
        responseExample: { accord_id: 'uuid', kpi_proposal: [proposalItem] },
      },
      {
        method: 'PUT',
        summary: 'Replace the KPI proposal. Validated; send null to clear it.',
        auth: 'required',
        roles: ['pm', 'admin'],
        bodySchema: [{ name: 'kpi_proposal', type: 'object', required: true, description: 'Array of KPI items (up to 20), or null to clear. Item: metric, label, direction up|down, source ga4|gsc|kuma|manual; optional baseline_value, target_value, target_by (YYYY-MM-DD), site_id.' }],
        responseExample: { accord_id: 'uuid', kpi_proposal: [proposalItem] },
        responseNotes: '400 with code invalid_proposal and a details list of every problem.',
      },
    ],
  },
  {
    path: '/api/accords/{id}/kpis/confirm',
    group: 'kpis',
    methods: [
      {
        method: 'POST',
        summary: 'Confirm the accord\'s KPI proposal into SiteKpi rows. Idempotent. No body.',
        auth: 'required',
        roles: ['pm', 'admin'],
        responseExample: { created: 'number', confirmed: 'number', unchanged: 'number', rows: ['uuid'] },
        responseNotes: '201 when rows were created, 200 on a repeat. 409 when the accord has no client (no_client), no proposal (no_proposal) or an invalid stored proposal. A retired row stays retired. Nothing calls this from the signing route today.',
      },
    ],
  },
  {
    path: '/api/checklists',
    group: 'checklists',
    methods: [
      {
        method: 'GET',
        summary: 'A client\'s checklists, newest first, with items.',
        auth: 'required',
        roles: ['pm', 'admin'],
        queryParams: [{ name: 'client_id', type: 'uuid', required: true, description: 'The client' }],
        responseExample: { data: [checklistExample], meta: { count: 'number' } },
      },
      {
        method: 'POST',
        summary: 'Create a checklist from a template. Idempotent: an open checklist of the same kind and links is returned.',
        auth: 'required',
        roles: ['pm', 'admin'],
        bodySchema: [
          { name: 'kind', type: 'string', required: true, description: 'onboarding, offboarding or takeover' },
          { name: 'client_id', type: 'uuid', required: true, description: 'The client' },
          { name: 'template', type: 'string', required: true, description: 'Template key. Today: onboarding.build (a draft item set).' },
          { name: 'accord_id', type: 'uuid', required: false, description: 'Link' },
          { name: 'charter_id', type: 'uuid', required: false, description: 'Link' },
          { name: 'project_id', type: 'uuid', required: false, description: 'Link' },
        ],
        responseExample: checklistExample,
        responseNotes: '201 when created, 200 when the open one is returned. 400 for an unknown template or a template of another kind. Offboarding never deletes.',
      },
    ],
  },
  {
    path: '/api/checklists/{id}',
    group: 'checklists',
    methods: [
      {
        method: 'GET',
        summary: 'One checklist with items, the gate of each item, and the keys still holding it open.',
        auth: 'required',
        roles: ['pm', 'admin'],
        responseExample: checklistExample,
        responseNotes: 'Done means every required before_work item is verified, received, waived or not_applicable. before_launch items (GA4, Search Console, DNS) do not hold it open.',
      },
    ],
  },
  {
    path: '/api/checklists/{id}/items/{key}',
    group: 'checklists',
    methods: [
      {
        method: 'PATCH',
        summary: 'Set one item\'s state with evidence. The signed-in user is recorded as the verifier.',
        auth: 'required',
        roles: ['pm', 'admin'],
        bodySchema: [
          { name: 'state', type: 'string', required: true, description: 'missing, received, verified, waived or not_applicable' },
          { name: 'evidence', type: 'string', required: false, description: 'A note, link or reason. Required for verified and waived.' },
        ],
        responseExample: checklistExample,
        responseNotes: 'Returns the whole checklist and recomputes done_at. 400 evidence_required when verified or waived has no evidence.',
      },
    ],
  },
];
