import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RecurringWorkBoard, boardView, headerLine } from '../RecurringWorkBoard';
import type { GroupedRecurringWork } from '@/lib/hooks/use-recurring-work';
import type { RecurringWorkItem } from '@/types/entities';

const row = (id: string, title: string, o: Partial<RecurringWorkItem> = {}): RecurringWorkItem => ({
  id, kind: 'machine_job', title, charter_id: null, charter_ware_id: null, sop_id: null, cadence: null, schedule_text: 'every 10 minutes',
  cron_expr: '*/10 * * * *', job_key: id, source_kind: null, source_id: null, owner_id: 'o', owner: { id: 'o', name: 'Bast' },
  produces: 'a short note', client_id: null, site_id: null, initiative_id: null, is_plumbing: false, last_run_at: '2026-11-24T15:00:00.000Z',
  last_run_ok: true, last_run_note: null, next_run_at: null, paused_on_purpose: false, sort_order: 0, is_active: true,
  created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z', ...o,
});

const stopped = row('s', 'Done notes', { last_run_ok: false });
const data = (): GroupedRecurringWork => ({
  recurring_work: [],
  total: 5,
  plumbing: { count: 3, stopped: 1 },
  groups: [
    { label: 'Background', count: 3, stopped: 1, rows: [row('b1', 'Heartbeat', { is_plumbing: true }), row('b2', 'Broken sweep', { is_plumbing: true, last_run_ok: false }), row('b3', 'Reaper', { is_plumbing: true })] },
    { label: 'Client mail', count: 3, stopped: 1, rows: [stopped, row('a', 'Approvals', { initiative: { id: 'i', name: 'Mail first' }, initiative_id: 'i' }), row('p', 'Away digest', { paused_on_purpose: true, last_run_ok: null })] },
  ],
});

describe('RecurringWorkBoard', () => {
  it('counts what Mike reads, what is stopped (background included) and the background jobs running', () => {
    expect(headerLine(boardView(data()))).toBe('3 you read · 2 stopped · 2 background jobs running');
    render(<RecurringWorkBoard data={data()} />);
    expect(screen.getByTestId('recurring-counts').textContent).toBe('3 you read · 2 stopped · 2 background jobs running');
  });

  it('shows rows with owner, schedule, makes, a state mark and the initiative tag, in the order the API gives', () => {
    render(<RecurringWorkBoard data={data()} />);
    const rows = screen.getAllByTestId('recurring-row');
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Broken sweep'),
      expect.stringContaining('Done notes'),
      expect.stringContaining('Approvals'),
      expect.stringContaining('Away digest'),
    ]);
    expect(rows[1].textContent).toContain('Bast');
    expect(rows[1].textContent).toContain('every 10 minutes');
    expect(rows[1].textContent).toContain('makes: a short note');
    expect(rows[1].textContent).toContain('stopped Nov 24');
    expect(rows[2].textContent).toContain('ran Nov 24');
    expect(screen.getByTestId('initiative-tag').textContent).toBe('Mail first');
  });

  it('shows paused on purpose in gray, not as a stopped mark', () => {
    render(<RecurringWorkBoard data={data()} />);
    const paused = screen.getByTestId('paused-note');
    expect(paused.className).toContain('text-text-muted');
    expect(paused.closest('li')!.querySelector('[data-testid="state-mark"]')).toBeNull();
  });

  it('lifts a stopped background row under Background and collapses the rest to one line that opens a list', () => {
    render(<RecurringWorkBoard data={data()} />);
    expect(screen.getByText('Background (1)')).toBeTruthy();
    expect(screen.queryByText('Heartbeat')).toBeNull();
    const toggle = screen.getByTestId('background-toggle');
    expect(toggle.textContent).toBe('2 background jobs: all running');
    fireEvent.click(toggle);
    expect(screen.getByTestId('background-list').textContent).toContain('Heartbeat');
    expect(screen.getByTestId('background-list').textContent).toContain('Reaper');
  });

  it('says so when there are no rows', () => {
    render(<RecurringWorkBoard data={{ recurring_work: [], total: 0, groups: [], plumbing: { count: 0, stopped: 0 } }} />);
    expect(screen.getByText('Nothing recurring yet')).toBeTruthy();
  });
});
