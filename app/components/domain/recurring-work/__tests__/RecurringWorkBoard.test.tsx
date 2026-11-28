import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { RecurringWorkBoard, boardView, headerLine, BACKGROUND_OPEN_KEY } from '../RecurringWorkBoard';
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

  describe('usage, destination, last used, file-only and priority', () => {
    const rowFor = (title: string) => screen.getAllByTestId('recurring-row').find((r) => r.textContent!.includes(title))!;
    const withMeta = (): GroupedRecurringWork => ({
      recurring_work: [], total: 3, plumbing: { count: 0, stopped: 0 },
      groups: [{ label: 'Reports', count: 3, stopped: 0, rows: [
        row('m', 'Measured job', { usage_state: 'measured', usage_week_share: 12.4, usage_week_usd: 3.6, usage_month_usd: 12.2, usage_note: 'from logs', destinations: ['email_mike'], destination_note: 'weekly note', last_used_at: '2026-11-24T15:00:00.000Z', last_used_signal: 'opened the email', priority: 'normal' }),
        row('f', 'File job', { usage_state: 'no_claude', destinations: ['file_only'], file_only: true, last_used_at: null, priority: 'low' }),
        row('u', 'Unknown job', { usage_state: null, destinations: [] }),
      ] }],
    });

    it('shows each known value with its title text', () => {
      render(<RecurringWorkBoard data={withMeta()} />);
      const m = rowFor('Measured job');
      expect(within(m).getByTestId('usage-cell').textContent).toBe('this week 12% · $4 · month $12');
      expect(within(m).getByTestId('usage-cell').getAttribute('title')).toBe('from logs');
      expect(within(m).getByTestId('destination-cell').textContent).toBe('email to Mike');
      expect(within(m).getByTestId('destination-cell').getAttribute('title')).toBe('weekly note');
      expect(within(m).getByTestId('last-used-cell').textContent).toBe('used Nov 24');
      expect(within(m).getByTestId('last-used-cell').getAttribute('title')).toBe('opened the email');
      expect(within(m).queryByTestId('file-only-flag')).toBeNull();
    });

    it('says plainly when a value is not known yet, and flags file-only rows', () => {
      render(<RecurringWorkBoard data={withMeta()} />);
      const u = rowFor('Unknown job');
      expect(within(u).getByTestId('usage-cell').textContent).toBe('usage not known yet');
      expect(within(u).getByTestId('destination-cell').textContent).toBe('destination not known yet');
      expect(within(u).getByTestId('last-used-cell').textContent).toBe('use not known yet');
      const f = rowFor('File job');
      expect(within(f).getByTestId('file-only-flag').textContent).toBe('file only');
      expect(within(f).getByTestId('usage-cell').textContent).toBe('no Claude');
      expect(within(f).getByTestId('last-used-cell').textContent).toBe('never used');
    });

    it('changes priority through the callback', () => {
      const onPriorityChange = vi.fn();
      render(<RecurringWorkBoard data={withMeta()} onPriorityChange={onPriorityChange} />);
      const control = within(rowFor('Measured job')).getByTestId('priority-control') as HTMLSelectElement;
      expect(control.value).toBe('normal');
      expect((within(rowFor('File job')).getByTestId('priority-control') as HTMLSelectElement).value).toBe('low');
      fireEvent.change(control, { target: { value: 'low' } });
      expect(onPriorityChange).toHaveBeenCalledWith('m', 'low');
    });

    it('sorts by usage and by last run within a group', () => {
      const d = withMeta();
      d.groups[0].rows[1] = row('f', 'File job', { usage_state: 'measured', usage_week_share: 40, last_run_at: '2026-11-01T00:00:00Z', file_only: true, destinations: ['file_only'] });
      render(<RecurringWorkBoard data={d} />);
      const titles = () => screen.getAllByTestId('recurring-row').map((r) => ['Measured job', 'File job', 'Unknown job'].find((t) => r.textContent!.includes(t)));
      expect(titles()).toEqual(['Measured job', 'File job', 'Unknown job']);
      fireEvent.change(screen.getByTestId('sort-control'), { target: { value: 'usage' } });
      expect(titles()).toEqual(['File job', 'Measured job', 'Unknown job']);
      fireEvent.change(screen.getByTestId('sort-control'), { target: { value: 'last_run' } });
      expect(titles()).toEqual(['Measured job', 'Unknown job', 'File job']);
    });

    it('the nobody-reads filter keeps only those rows and hides empty groups', () => {
      const d = withMeta();
      d.groups.push({ label: 'Other', count: 1, stopped: 0, rows: [row('o', 'Read job', { destinations: ['slack'], last_used_at: new Date().toISOString() })] });
      render(<RecurringWorkBoard data={d} />);
      expect(screen.getAllByTestId('recurring-group')).toHaveLength(2);
      fireEvent.click(screen.getByTestId('nobody-reads-filter'));
      expect(screen.getAllByTestId('recurring-row').map((r) => r.textContent)).toEqual([expect.stringContaining('File job')]);
      expect(screen.getAllByTestId('recurring-group')).toHaveLength(1);
    });
  });

  describe('collapsible groups', () => {
    it('toggling calls the save callback with the full new list', () => {
      const onCollapsedChange = vi.fn();
      render(<RecurringWorkBoard data={data()} collapsed={['Other']} onCollapsedChange={onCollapsedChange} />);
      const toggles = screen.getAllByTestId('group-toggle');
      expect(toggles[0].getAttribute('aria-expanded')).toBe('true');
      fireEvent.click(toggles[0]);
      expect(onCollapsedChange).toHaveBeenCalledWith(['Other', 'Background']);
    });

    it('a collapsed group keeps its heading and count but hides its rows; expanding removes it from the list', () => {
      const onCollapsedChange = vi.fn();
      render(<RecurringWorkBoard data={data()} collapsed={['Client mail']} onCollapsedChange={onCollapsedChange} />);
      expect(screen.getByText('Client mail (3)')).toBeTruthy();
      expect(screen.queryByText('Approvals')).toBeNull();
      const toggle = screen.getByText('Client mail (3)').closest('button')!;
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      fireEvent.click(toggle);
      expect(onCollapsedChange).toHaveBeenCalledWith([]);
    });

    it('the background section starts closed and stores its open state under BACKGROUND_OPEN_KEY', () => {
      const onCollapsedChange = vi.fn();
      const { rerender } = render(<RecurringWorkBoard data={data()} collapsed={[]} onCollapsedChange={onCollapsedChange} />);
      expect(screen.queryByTestId('background-list')).toBeNull();
      fireEvent.click(screen.getByTestId('background-toggle'));
      expect(onCollapsedChange).toHaveBeenCalledWith([BACKGROUND_OPEN_KEY]);
      rerender(<RecurringWorkBoard data={data()} collapsed={[BACKGROUND_OPEN_KEY]} onCollapsedChange={onCollapsedChange} />);
      expect(screen.getByTestId('background-list')).toBeTruthy();
      // background rows carry the same values as the main rows
      expect(within(screen.getByTestId('background-list')).getAllByTestId('usage-cell').length).toBeGreaterThan(0);
    });
  });
});

describe('Keep, Cut and Make weekly', () => {
  const one = (o: Partial<RecurringWorkItem> = {}): GroupedRecurringWork => ({
    recurring_work: [], total: 1, plumbing: { count: 0, stopped: 0 },
    groups: [{ label: 'Reports', count: 1, stopped: 0, rows: [row('j1', 'Weekly digest', o)] }],
  });

  it('renders the three buttons named for the job and calls onPick with the id and pick', () => {
    const onPick = vi.fn();
    render(<RecurringWorkBoard data={one()} onPick={onPick} />);
    expect(screen.getByLabelText('Keep Weekly digest')).toBeTruthy();
    expect(screen.getByLabelText('Cut Weekly digest')).toBeTruthy();
    expect(screen.getByLabelText('Make Weekly digest weekly')).toBeTruthy();
    fireEvent.click(screen.getByTestId('pick-keep'));
    fireEvent.click(screen.getByTestId('pick-cut'));
    fireEvent.click(screen.getByTestId('pick-weekly'));
    expect(onPick.mock.calls).toEqual([['j1', 'keep'], ['j1', 'cut'], ['j1', 'weekly']]);
    expect(screen.queryByTestId('pick-status')).toBeNull();
  });

  it('disables the buttons when there is no onPick handler', () => {
    render(<RecurringWorkBoard data={one()} />);
    for (const id of ['pick-keep', 'pick-cut', 'pick-weekly']) expect((screen.getByTestId(id) as HTMLButtonElement).disabled).toBe(true);
  });

  it('disables Cut and Make weekly while the pick card is open, and links to the card', () => {
    const onPick = vi.fn();
    render(
      <RecurringWorkBoard
        data={one({ mike_pick: 'cut', mike_pick_at: '2026-11-28T10:00:00.000Z', pick_card_open: true, pick_task: { id: 't1', title: 'Recurring work: cut "x"', status: 'not_started' } })}
        onPick={onPick}
      />,
    );
    expect((screen.getByTestId('pick-cut') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('pick-weekly') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('pick-keep') as HTMLButtonElement).disabled).toBe(false);
    const status = screen.getByTestId('pick-status');
    expect(status.textContent).toBe('Cut picked · card open');
    expect(status.querySelector('a')!.getAttribute('href')).toBe('/tasks/t1');
  });

  it('shows the pick and its date when no card is open', () => {
    render(<RecurringWorkBoard data={one({ mike_pick: 'keep', mike_pick_at: '2026-11-28T10:00:00.000Z', pick_card_open: false })} onPick={vi.fn()} />);
    expect(screen.getByTestId('pick-status').textContent).toBe('Kept · Nov 28');
    expect((screen.getByTestId('pick-cut') as HTMLButtonElement).disabled).toBe(false);
  });
});
