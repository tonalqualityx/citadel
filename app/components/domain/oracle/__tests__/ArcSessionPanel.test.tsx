import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { ArcSessionPanel } from '../ArcSessionPanel';
import type { ArcSessionSummary } from '@/lib/hooks/use-arcs';

function makeSession(overrides: Partial<ArcSessionSummary> = {}): ArcSessionSummary {
  return {
    id: 'sess-1',
    external_id: 'ext-1',
    title: 'A linked session',
    status: 'running',
    remote_url: null,
    needs_attention: false,
    last_event_at: null,
    ...overrides,
  };
}

// Clarity Phase 4c — the arc board header's session panel.
describe('ArcSessionPanel', () => {
  it('renders nothing (exception display) when no session is linked', () => {
    const { container } = render(<ArcSessionPanel sessions={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the session title and a live status chip', () => {
    render(<ArcSessionPanel sessions={[makeSession({ title: 'Fix the widget' })]} />);

    expect(screen.getByTestId('arc-session-panel')).toBeInTheDocument();
    expect(screen.getByText('Fix the widget')).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();
  });

  it('renders a Respond deep-link when remote_url exists on a live session', () => {
    render(
      <ArcSessionPanel
        sessions={[makeSession({ status: 'waiting', remote_url: 'https://claude.ai/code/session_x' })]}
      />
    );

    const link = screen.getByTestId('arc-session-respond');
    expect(link).toHaveAttribute('href', 'https://claude.ai/code/session_x');
  });

  it('does not render Respond when remote_url is absent', () => {
    render(<ArcSessionPanel sessions={[makeSession({ remote_url: null })]} />);
    expect(screen.queryByTestId('arc-session-respond')).not.toBeInTheDocument();
  });

  it('does not render Respond for an ended session even with a remote_url', () => {
    render(<ArcSessionPanel sessions={[makeSession({ status: 'ended', remote_url: 'https://claude.ai/code/session_x' })]} />);
    expect(screen.queryByTestId('arc-session-respond')).not.toBeInTheDocument();
  });

  it('renders a quiet "waiting since <time>" line when needs_attention is set', () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    render(
      <ArcSessionPanel
        sessions={[makeSession({ needs_attention: true, last_event_at: fiveMinutesAgo })]}
      />
    );

    expect(screen.getByTestId('arc-session-waiting-since')).toHaveTextContent('waiting since 5m ago');
  });

  it('does not render the waiting-since line when needs_attention is false', () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    render(
      <ArcSessionPanel sessions={[makeSession({ needs_attention: false, last_event_at: fiveMinutesAgo })]} />
    );
    expect(screen.queryByTestId('arc-session-waiting-since')).not.toBeInTheDocument();
  });

  it('renders multiple linked sessions, one row each', () => {
    render(
      <ArcSessionPanel
        sessions={[makeSession({ id: 'a', title: 'First' }), makeSession({ id: 'b', title: 'Second' })]}
      />
    );
    expect(screen.getAllByTestId('arc-session-row')).toHaveLength(2);
  });
});
