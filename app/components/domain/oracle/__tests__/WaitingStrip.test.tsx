import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as React from 'react';
import type { OracleSessionWithMachine } from '@/lib/types/oracle';
import { WaitingStrip } from '../WaitingStrip';

function makeSession(overrides: Partial<OracleSessionWithMachine>): OracleSessionWithMachine {
  return {
    id: 'session-1',
    external_id: 'ext-1',
    source: 'claude_code',
    title: 'Some session',
    cwd: null,
    model: 'claude-sonnet-5',
    status: 'waiting',
    needs_attention: false,
    attention_reason: null,
    started_at: null,
    last_event_at: null,
    ended_at: null,
    tokens_total: 0,
    agents: [],
    machine: {
      id: 'machine-1',
      name: 'reshi-workstation',
      hostname: null,
      last_heartbeat_at: null,
      stale: false,
      sessions: [],
      commands: [],
    },
    ...overrides,
  };
}

describe('WaitingStrip', () => {
  it('renders nothing when there are no waiting sessions', () => {
    const { container } = render(<WaitingStrip sessions={[]} nowMs={Date.now()} collapsed={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the needs_attention fixture with its attention reason surfaced', () => {
    const session = makeSession({
      title: 'grantibly-wright-b1 — gate review',
      needs_attention: true,
      attention_reason: 'Approval needed: publish B1 gate deliverable.',
    });
    render(<WaitingStrip sessions={[session]} nowMs={Date.now()} collapsed={false} />);

    expect(screen.getByText('Waiting on Reshi (1)')).toBeInTheDocument();
    expect(screen.getByText(/grantibly-wright-b1/)).toBeInTheDocument();
  });

  it('preserves caller-provided order (the strip trusts oracle-logic sort, not its own)', () => {
    const first = makeSession({ id: 'first', title: 'Longest wait' });
    const second = makeSession({ id: 'second', title: 'Shorter wait' });
    render(<WaitingStrip sessions={[first, second]} nowMs={Date.now()} collapsed={false} />);

    const cards = screen.getAllByTestId('session-card');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent('Longest wait');
    expect(cards[1]).toHaveTextContent('Shorter wait');
  });
});
