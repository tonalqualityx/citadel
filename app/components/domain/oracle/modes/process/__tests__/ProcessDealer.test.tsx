import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as React from 'react';
import type { EmailAsk } from '@/lib/hooks/use-waiting-on-me';

vi.mock('../IntakeDealCard', () => ({
  IntakeDealCard: ({ ask, onRouted }: { ask: EmailAsk; onRouted: () => void }) => (
    <div data-testid="process-deal-card" data-stage="intake">
      {ask.subject}
      <button onClick={onRouted}>route-intake</button>
    </div>
  ),
}));
vi.mock('../ReviewBatchDealCard', () => ({
  ReviewBatchDealCard: ({ group, onRouted }: { group: { label: string }; onRouted: () => void }) => (
    <div data-testid="process-deal-card" data-stage="review">
      {group.label}
      <button onClick={onRouted}>route-review</button>
    </div>
  ),
}));
vi.mock('../AdminDealCard', () => ({
  AdminDealCard: ({ task, onRouted }: { task: { title: string }; onRouted: () => void }) => (
    <div data-testid="process-deal-card" data-stage="admin">
      {task.title}
      <button onClick={onRouted}>route-admin</button>
    </div>
  ),
}));

import { ProcessDealer } from '../ProcessDealer';

function ask(overrides: Partial<EmailAsk> = {}): EmailAsk {
  return {
    id: 'ask-1', message_id: 'm1', thread_id: null, account: 'a@b.com', from_name: null,
    from_email: 'x@y.com', subject: 'Subject one', gist: null, queue: null, severity: null,
    is_urgent: false, state: 'open', training_note: null, intent: 'general',
    proposed_event_at: null, proposed_event_title: null, proposed_event_minutes: null,
    calendar_requested: false, calendar_event_id: null, task_id: null,
    deep_link: 'https://mail.google.com', received_at: '2026-07-27T09:00:00.000Z',
    created_at: '2026-07-27T09:00:00.000Z', updated_at: '2026-07-27T09:00:00.000Z',
    ...overrides,
  };
}

describe('ProcessDealer — one card at a time (mode-escort law #3)', () => {
  it('renders exactly ONE process-deal-card even with multiple items across stages', () => {
    render(
      <ProcessDealer
        intakeAsks={[ask({ id: 'i1' }), ask({ id: 'i2', subject: 'Subject two' })]}
        reviewGroups={[{ key: 'r1', label: 'A Client', count: 1, oldestWaitAt: null, topItemTitle: 't', items: [], arcId: null }]}
        adminTasks={[{ id: 'a1', title: 'Pay Tara', status: 'not_started', priority: 3, due_date: null, promised_to: null, client: null, source_intent: null }]}
        nowMs={Date.now()}
      />
    );
    expect(screen.getAllByTestId('process-deal-card')).toHaveLength(1);
    expect(screen.getByText('Subject one')).toBeInTheDocument();
  });

  it('shows the empty state when there is nothing to process', () => {
    render(<ProcessDealer intakeAsks={[]} reviewGroups={[]} adminTasks={[]} nowMs={Date.now()} />);
    expect(screen.getByTestId('process-dealer-empty')).toHaveTextContent('Nothing to process');
    expect(screen.queryByTestId('process-deal-card')).not.toBeInTheDocument();
  });

  it('routing the current card advances to the next one, still showing exactly one', () => {
    render(
      <ProcessDealer
        intakeAsks={[ask({ id: 'i1', subject: 'First' }), ask({ id: 'i2', subject: 'Second' })]}
        reviewGroups={[]}
        adminTasks={[]}
        nowMs={Date.now()}
      />
    );
    expect(screen.getByText('First')).toBeInTheDocument();
    fireEvent.click(screen.getByText('route-intake'));
    expect(screen.getAllByTestId('process-deal-card')).toHaveLength(1);
    expect(screen.getByText('Second')).toBeInTheDocument();
    expect(screen.queryByText('First')).not.toBeInTheDocument();
  });

  it('shows a calm "done" progress count', () => {
    render(
      <ProcessDealer
        intakeAsks={[ask({ id: 'i1' }), ask({ id: 'i2' })]}
        reviewGroups={[]}
        adminTasks={[]}
        nowMs={Date.now()}
      />
    );
    expect(screen.getByTestId('process-dealer-progress')).toHaveTextContent('0 of 2 cleared');
    fireEvent.click(screen.getByText('route-intake'));
    expect(screen.getByTestId('process-dealer-progress')).toHaveTextContent('1 of 2 cleared');
  });

  it('deals intake before review before admin', () => {
    render(
      <ProcessDealer
        intakeAsks={[ask({ id: 'i1' })]}
        reviewGroups={[{ key: 'r1', label: 'A Client', count: 1, oldestWaitAt: null, topItemTitle: 't', items: [], arcId: null }]}
        adminTasks={[{ id: 'a1', title: 'Pay Tara', status: 'not_started', priority: 3, due_date: null, promised_to: null, client: null, source_intent: null }]}
        nowMs={Date.now()}
      />
    );
    expect(screen.getByTestId('process-deal-card')).toHaveAttribute('data-stage', 'intake');
    fireEvent.click(screen.getByText('route-intake'));
    expect(screen.getByTestId('process-deal-card')).toHaveAttribute('data-stage', 'review');
    fireEvent.click(screen.getByText('route-review'));
    expect(screen.getByTestId('process-deal-card')).toHaveAttribute('data-stage', 'admin');
  });
});
