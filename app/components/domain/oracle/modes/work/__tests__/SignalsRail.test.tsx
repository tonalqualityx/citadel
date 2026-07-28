import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SignalsRail } from '../SignalsRail';
import type { OracleMachineDTO, OracleSessionWithMachine } from '@/lib/types/oracle';

const mockGet = vi.fn();
vi.mock('@/lib/api/client', () => ({
  apiClient: { get: (...args: unknown[]) => mockGet(...args), post: vi.fn(), patch: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockResolvedValue({ states: [] });
});

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

const noMachines: OracleMachineDTO[] = [];

function session(overrides: Partial<OracleSessionWithMachine> = {}): OracleSessionWithMachine {
  return {
    id: 's1',
    external_id: 'ext-1',
    source: 'claude_code',
    title: 'BRIC change round',
    cwd: null,
    model: null,
    remote_url: null,
    status: 'waiting',
    needs_attention: true,
    attention_reason: null,
    started_at: null,
    last_event_at: null,
    ended_at: null,
    tokens_total: 0,
    agents: [],
    waiting_on: 'Approve the copy pass before it ships',
    machine: { id: 'm1', name: 'nexus', hostname: null, last_heartbeat_at: null, stale: false, sessions: [], commands: [] },
    ...overrides,
  };
}

function promisedTask(overrides: Partial<{ id: string; title: string; due_date: string; promised_to: string | null }> = {}) {
  return {
    id: 't1',
    title: 'record walkthrough video',
    due_date: '2026-07-28',
    promised_to: 'client@example.com',
    ...overrides,
  };
}

// Clarity Phase 8 (shakedown round 2) — chips become doors (information-scent law): every
// signal chip carries its action instead of being a dead-end count.
describe('SignalsRail — chips carry their action (Clarity Phase 8 shakedown round 2)', () => {
  it('renders the empty-state sentence verbatim when nothing needs Mike', () => {
    renderWithClient(
      <SignalsRail
        crisisCount={0}
        promisedDueTodayTasks={[]}
        sessionsNeedingYou={[]}
        machines={noMachines}
        todayDateStr="2026-07-28"
        onGoToMode={vi.fn()}
      />
    );
    expect(screen.getByTestId('signals-empty-copy')).toHaveTextContent(
      'Nothing needs you right now — if it did, it would be here.'
    );
  });

  it('clicking the sessions-needing-you chip expands the list: title, waiting_on, and a way in', () => {
    renderWithClient(
      <SignalsRail
        crisisCount={0}
        promisedDueTodayTasks={[]}
        sessionsNeedingYou={[session()]}
        machines={noMachines}
        todayDateStr="2026-07-28"
        onGoToMode={vi.fn()}
      />
    );
    expect(screen.queryByTestId('signal-session_needs_you-panel')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('signal-session_needs_you'));

    const panel = screen.getByTestId('signal-session_needs_you-panel');
    expect(panel).toHaveTextContent('BRIC change round');
    expect(panel).toHaveTextContent('Approve the copy pass before it ships');
    expect(screen.getByTestId('signal-session-link')).toHaveTextContent('View on Fleet');
    expect(screen.getByTestId('signal-session-link')).toHaveAttribute('href', '/oracle/fleet');
  });

  it('a session carrying a remote_url links straight to it instead of Fleet', () => {
    renderWithClient(
      <SignalsRail
        crisisCount={0}
        promisedDueTodayTasks={[]}
        sessionsNeedingYou={[session({ remote_url: 'https://claude.ai/code/session_abc' })]}
        machines={noMachines}
        todayDateStr="2026-07-28"
        onGoToMode={vi.fn()}
      />
    );
    fireEvent.click(screen.getByTestId('signal-session_needs_you'));
    expect(screen.getByTestId('signal-session-link')).toHaveAttribute(
      'href',
      'https://claude.ai/code/session_abc'
    );
  });

  it('clicking the promised-due-today chip expands the task list with a due label and a Focus action that jumps to the board', () => {
    const onGoToMode = vi.fn();
    renderWithClient(
      <SignalsRail
        crisisCount={0}
        promisedDueTodayTasks={[promisedTask()]}
        sessionsNeedingYou={[]}
        machines={noMachines}
        todayDateStr="2026-07-28"
        onGoToMode={onGoToMode}
      />
    );
    fireEvent.click(screen.getByTestId('signal-promised_due_today'));

    const panel = screen.getByTestId('signal-promised_due_today-panel');
    expect(panel).toHaveTextContent('record walkthrough video');
    expect(panel).toHaveTextContent('due today');

    fireEvent.click(screen.getByTestId('signal-promised-task-focus'));
    expect(onGoToMode).toHaveBeenCalledWith('plan');
  });

  it('clicking the crisis chip scrolls to the on-page crisis strip rather than expanding', () => {
    const crisisStrip = document.createElement('div');
    crisisStrip.setAttribute('data-testid', 'crisis-strip');
    const scrollIntoView = vi.fn();
    crisisStrip.scrollIntoView = scrollIntoView;
    document.body.appendChild(crisisStrip);

    renderWithClient(
      <SignalsRail
        crisisCount={1}
        promisedDueTodayTasks={[]}
        sessionsNeedingYou={[]}
        machines={noMachines}
        todayDateStr="2026-07-28"
        onGoToMode={vi.fn()}
      />
    );
    fireEvent.click(screen.getByTestId('signal-crisis'));

    expect(scrollIntoView).toHaveBeenCalled();
    expect(screen.queryByTestId('signal-promised_due_today-panel')).not.toBeInTheDocument();

    document.body.removeChild(crisisStrip);
  });

  it('toggling a chip a second time collapses its panel', () => {
    renderWithClient(
      <SignalsRail
        crisisCount={0}
        promisedDueTodayTasks={[promisedTask()]}
        sessionsNeedingYou={[]}
        machines={noMachines}
        todayDateStr="2026-07-28"
        onGoToMode={vi.fn()}
      />
    );
    const chip = screen.getByTestId('signal-promised_due_today');
    fireEvent.click(chip);
    expect(screen.getByTestId('signal-promised_due_today-panel')).toBeInTheDocument();
    fireEvent.click(chip);
    expect(screen.queryByTestId('signal-promised_due_today-panel')).not.toBeInTheDocument();
  });
});
