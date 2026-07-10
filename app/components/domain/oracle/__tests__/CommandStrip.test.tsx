import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as React from 'react';
import type { OracleCommandDTO } from '@/lib/types/oracle';
import { CommandStrip } from '../CommandStrip';

function makeCommand(overrides: Partial<OracleCommandDTO> = {}): OracleCommandDTO {
  return {
    id: 'cmd-1',
    verb: 'spawn_session',
    status: 'pending',
    title: null,
    cwd: '/home/mike/.openclaw/workspace/citadel',
    created_at: '2026-07-09T20:00:00.000Z',
    completed_at: null,
    result: null,
    error: null,
    ...overrides,
  };
}

const NOW = Date.parse('2026-07-09T20:05:00.000Z');

describe('CommandStrip', () => {
  it('renders nothing (no empty chrome) when there are no commands', () => {
    const { container } = render(<CommandStrip commands={[]} nowMs={NOW} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a chip per command with title-or-cwd-basename and relative time', () => {
    render(
      <CommandStrip
        commands={[makeCommand({ id: 'a', title: 'Quick fix' }), makeCommand({ id: 'b', cwd: '/home/mike/clients/oddfox' })]}
        nowMs={NOW}
      />
    );
    const chips = screen.getAllByTestId('command-chip');
    expect(chips).toHaveLength(2);
    expect(chips[0]).toHaveTextContent('Quick fix');
    expect(chips[0]).toHaveTextContent('5m ago');
    expect(chips[1]).toHaveTextContent('oddfox');
  });

  it('renders a success "remote ✓" affordance for a done command with confirmed remote control', () => {
    render(
      <CommandStrip
        commands={[
          makeCommand({
            status: 'done',
            result: { tmux_session: 'oracle-abc12', remote_control: 'confirmed' },
          }),
        ]}
        nowMs={NOW}
      />
    );
    expect(screen.getByText('remote ✓')).toBeInTheDocument();
    expect(screen.queryByText(/unconfirmed/)).not.toBeInTheDocument();
  });

  it('renders a warning "remote unconfirmed" affordance for a done command that could not confirm remote control (per ADDENDUM: warning, not success)', () => {
    render(
      <CommandStrip
        commands={[
          makeCommand({
            status: 'done',
            result: { tmux_session: 'oracle-abc12', remote_control: 'unconfirmed' },
          }),
        ]}
        nowMs={NOW}
      />
    );
    const chip = screen.getByTestId('command-chip');
    expect(chip).toHaveTextContent('remote unconfirmed');
  });

  it('shows the truncated error string with a title attribute for a failed command', () => {
    render(
      <CommandStrip
        commands={[makeCommand({ status: 'failed', error: 'cwd is outside $HOME' })]}
        nowMs={NOW}
      />
    );
    const errorSpan = screen.getByTitle('cwd is outside $HOME');
    expect(errorSpan).toHaveTextContent('cwd is outside $HOME');
  });
});
