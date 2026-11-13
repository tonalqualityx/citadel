/** The `deal` section of GET /api/projects/:id, /api/clients/:id and /api/tasks/:id (lib/deals/read.ts), and the project block of the Triage card. Read only. */
export const DEAL_RESPONSE_SHAPE = {
  tie: 'project_accord|commission_item|client_signed_deals|client_deals|none',
  tie_note: 'string (says how the deals were found; for client_signed_deals it says they are candidates, not this project\'s deal)',
  deals: [
    {
      id: 'uuid',
      name: 'string',
      status: 'lead|meeting|proposal|contract|signed|active|lost',
      pipeline_stage: 'string|null',
      signed_at: 'iso|null',
      total_value: 'string|null (decimal exactly as stored, two places)',
      href: '/deals/<id>',
      tied_to_project: 'boolean (true only for tie project_accord or commission_item)',
      contract: '{version, status: draft|sent|signed, sent_at|null, signed_at|null}|null (the signed version when there is one, else the newest)',
      contract_count: 'number',
      items: {
        commission: '[{id, name, ware_type, estimated_price|null, discount_type|null, discount_value|null, final_price|null, project_id|null, addendum_id|null}]',
        charter: '[{id, name, ware_type, price_tier|null, base_price, discount_type|null, discount_value|null, final_price, billing_period: monthly|annually, duration_months, total_contract_value, charter_id|null, addendum_id|null}]',
        keep: '[{id, name|null, domain_name|null, hosting_final_price|null, maintenance_final_price|null, monthly_total|null, is_client_hosted, addendum_id|null}]',
      },
    },
  ],
  retainers: '[{id, name, status: active|paused, billing_period: monthly|annually, budget_hours|null, hourly_rate|null, budget_amount|null, start_date: YYYY-MM-DD, end_date|null, duration_months|null, renewal_date|null, deal_id|null, site_id|null}]',
  client_retainer: '{retainer_hours|null, hourly_rate|null, usage_mode}|null (the hours and rate kept on the client record)',
};

export const DEAL_RESPONSE_NOTE =
  ' A `deal` section (the signed deal, read only: status, signed date, contract status and version, a link, every line item with amounts exactly as stored, the client\'s retainers) is added for the enforced bast-chat lane, and for the Dox lane only inside its project binding (x-dox-project naming a live project with an open pass); nobody else (tech, designer, a client portal session, a bot key with no lane, any other lane, Mike\'s own session) gets the key. A project is tied to its deal by Project.accord_id first, then by a deal commission item that points at the project, else the client\'s signed deals are listed as candidates (tie says which). Prices, never signer details, tokens or contract text.';
