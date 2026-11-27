/** Shapes of the model ledger summary (GET /api/model-ledger/days), shared by the route and the Recurring work tab. */
export interface LedgerLine {
  model: string;
  task_type: string;
  runs: number;
  cards: number;
  finished: number;
  first_try: number;
  escalations: number;
  cost_usd: number;
  /** first_try / cards, or null when no cards were counted. */
  first_try_rate: number | null;
  /** The cost of the row's runs divided by its finished cards, or null with none finished. */
  cost_per_finished_card: number | null;
}

export interface LedgerSummary {
  window_days: number;
  since: string;
  latest_day: string | null;
  total_cost_usd: number;
  total_runs: number;
  lines: LedgerLine[];
}
