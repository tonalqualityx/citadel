import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ModelScoreboardView, summaryLine, typeWords } from '../ModelScoreboard';
import type { LedgerSummary } from '@/lib/model-ledger/types';

const data = (lines: LedgerSummary['lines'] = []): LedgerSummary => ({
  window_days: 7, since: '2026-11-21', latest_day: '2026-11-27', total_cost_usd: lines.reduce((n, l) => n + l.cost_usd, 0),
  total_runs: lines.reduce((n, l) => n + l.runs, 0), lines,
});
const line = (o: Partial<LedgerSummary['lines'][number]>) => ({
  model: 'opus', task_type: 'citadel-code', runs: 5, cards: 3, finished: 2, first_try: 1, escalations: 1, cost_usd: 15, first_try_rate: 0.33,
  cost_per_finished_card: 7.5, ...o,
});

describe('ModelScoreboard', () => {
  it('shows card numbers for card rows and dashes for plain runs', () => {
    render(<ModelScoreboardView data={data([line({}), line({ model: 'sonnet', task_type: 'chat', cards: 0, finished: 0, first_try: 0, escalations: 0, first_try_rate: null, cost_per_finished_card: null, cost_usd: 2, runs: 40 })])} days={7} onDays={() => {}} />);
    const rows = screen.getAllByTestId('ledger-line');
    expect(rows[0].textContent).toContain('Citadel code');
    expect(rows[0].textContent).toContain('33%');
    expect(rows[0].textContent).toContain('$7.50');
    expect(rows[1].textContent).toContain('Chat');
    expect(rows[1].textContent).toContain('–');
    expect(screen.getByTestId('ledger-summary').textContent).toBe('45 Claude runs · 3 cards · $17.00 at API prices');
  });

  it('switches between 7 and 30 days and says when there is nothing yet', () => {
    const onDays = vi.fn();
    render(<ModelScoreboardView data={data()} days={7} onDays={onDays} />);
    expect(screen.getByTestId('ledger-empty')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '30 days' }));
    expect(onDays).toHaveBeenCalledWith(30);
    expect(screen.getByRole('button', { name: '7 days' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('puts task types in plain words', () => {
    expect(typeWords('design:home_build')).toBe('Design: home build');
    expect(typeWords('saiph-auto-triage')).toBe('saiph auto triage');
    expect(summaryLine(data())).toBe('0 Claude runs · 0 cards · $0.00 at API prices');
  });
});
