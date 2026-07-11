import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as React from 'react';
import type { OracleSessionWithMachine } from '@/lib/types/oracle';
import { SessionCard } from '../SessionCard';

// Oracle Phase 3 — the "Respond" deep-link button. Gated by remote_url presence AND
// a live status (running / waiting / derived "working"), never shown for
// ended/stale sessions or sessions with no bridge URL at all (no dead buttons).

const MACHINE = {
  id: 'machine-1',
  name: 'reshi-workstation',
  hostname: null,
  last_heartbeat_at: null,
  stale: false,
  sessions: [],
  commands: [],
};

function makeSession(overrides: Partial<OracleSessionWithMachine> = {}): OracleSessionWithMachine {
  return {
    id: 'session-1',
    external_id: 'ext-1',
    source: 'claude_code',
    title: 'Some session',
    cwd: null,
    model: 'claude-sonnet-5',
    remote_url: null,
    status: 'running',
    needs_attention: false,
    attention_reason: null,
    started_at: null,
    last_event_at: null,
    ended_at: null,
    tokens_total: 0,
    agents: [],
    machine: MACHINE,
    ...overrides,
  };
}

const REMOTE_URL = 'https://claude.ai/code/session_01NZKAFYR37yuNaaz2DPajxL';

describe('SessionCard — Respond deep-link', () => {
  it('renders a Respond link with the correct href/target/rel when remote_url is set and the session is waiting', () => {
    const session = makeSession({ status: 'waiting', needs_attention: true, remote_url: REMOTE_URL });
    render(<SessionCard session={session} nowMs={Date.now()} collapsed={false} />);

    const link = screen.getByTestId('respond-link');
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', REMOTE_URL);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(link).toHaveAttribute('rel', expect.stringContaining('noreferrer'));
  });

  it('renders Respond for a running session with remote_url', () => {
    const session = makeSession({ status: 'running', remote_url: REMOTE_URL });
    render(<SessionCard session={session} nowMs={Date.now()} collapsed={false} />);
    expect(screen.getByTestId('respond-link')).toBeInTheDocument();
  });

  it('renders Respond for a "working" orchestrator (waiting/needs_attention with a live running child)', () => {
    const session = makeSession({
      status: 'waiting',
      needs_attention: true,
      remote_url: REMOTE_URL,
      agents: [
        {
          id: 'agent-1',
          external_id: 'agent-1',
          label: 'Child task',
          phase: 'build',
          model: 'claude-sonnet-5',
          status: 'running',
          activity: null,
          tokens: 0,
          duration_ms: null,
          started_at: null,
          ended_at: null,
        },
      ],
    });
    render(<SessionCard session={session} nowMs={Date.now()} collapsed={false} />);
    expect(screen.getByTestId('respond-link')).toBeInTheDocument();
  });

  it('does NOT render Respond for an ended session, even with remote_url set', () => {
    const session = makeSession({ status: 'ended', remote_url: REMOTE_URL });
    render(<SessionCard session={session} nowMs={Date.now()} collapsed={false} />);
    expect(screen.queryByTestId('respond-link')).not.toBeInTheDocument();
  });

  it('does NOT render Respond for a stale session, even with remote_url set', () => {
    const session = makeSession({ status: 'stale', remote_url: REMOTE_URL });
    render(<SessionCard session={session} nowMs={Date.now()} collapsed={false} />);
    expect(screen.queryByTestId('respond-link')).not.toBeInTheDocument();
  });

  it('does NOT render Respond when remote_url is null, regardless of status', () => {
    const session = makeSession({ status: 'waiting', needs_attention: true, remote_url: null });
    render(<SessionCard session={session} nowMs={Date.now()} collapsed={false} />);
    expect(screen.queryByTestId('respond-link')).not.toBeInTheDocument();
  });

  it('clicking Respond does not toggle the card drawer open', () => {
    const session = makeSession({ status: 'waiting', needs_attention: true, remote_url: REMOTE_URL });
    render(<SessionCard session={session} nowMs={Date.now()} collapsed={false} />);

    // Drawer isn't open yet — the header toggle button carries aria-expanded=false.
    const headerToggle = screen.getByRole('button', { name: /some session/i });
    expect(headerToggle).toHaveAttribute('aria-expanded', 'false');

    const link = screen.getByTestId('respond-link');
    fireEvent.click(link);

    // The header toggle must remain collapsed — clicking Respond is independent of
    // the card's own expand/collapse click handler.
    expect(headerToggle).toHaveAttribute('aria-expanded', 'false');
  });
});
