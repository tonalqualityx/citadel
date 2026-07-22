import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AskCard } from '../AskCard';
import type { AskCardData } from '../needs-reshi-logic';

// Clarity Phase 4b — the Review queue's "Open review" card now opens the quest peek
// in-page instead of navigating to /tasks/[id].
const mockOpenTaskPeek = vi.fn();
vi.mock('@/lib/contexts/task-peek-context', () => ({
  useTaskPeek: () => ({ openTaskPeek: mockOpenTaskPeek }),
}));

beforeEach(() => {
  mockOpenTaskPeek.mockClear();
});

function reviewCard(overrides: Partial<AskCardData> = {}): AskCardData {
  return {
    id: 'task-review-1',
    sourceLabel: 'quest',
    contextLabel: 'Demo Arc',
    bodyText: 'Ship the thing',
    severity: null,
    primaryAction: { kind: 'open_review', taskId: 'task-review-1' },
    ...overrides,
  };
}

describe('AskCard', () => {
  it('"Open review" calls openTaskPeek with the task id, not a navigation link', () => {
    render(<AskCard data={reviewCard()} />);

    const button = screen.getByRole('button', { name: /open review/i });
    // Confirms this is no longer an <a>/<Link> — no href to navigate away with.
    expect(button).not.toHaveAttribute('href');

    fireEvent.click(button);
    expect(mockOpenTaskPeek).toHaveBeenCalledWith('task-review-1');
  });

  it('renders the Respond action for a session ask, untouched by this phase', () => {
    render(
      <AskCard
        data={reviewCard({
          sourceLabel: 'session',
          primaryAction: { kind: 'respond', remoteUrl: 'https://claude.ai/code/session_x' },
        })}
      />
    );

    const link = screen.getByRole('link', { name: /respond/i });
    expect(link).toHaveAttribute('href', 'https://claude.ai/code/session_x');
    expect(mockOpenTaskPeek).not.toHaveBeenCalled();
  });

  // Clarity Phase 5 — the merged "Waiting on you" queue's type chip.
  it('renders a "decision" chip when queueType is decision', () => {
    render(<AskCard data={reviewCard({ queueType: 'decision' })} />);
    expect(screen.getByTestId('ask-card-queue-type')).toHaveTextContent('decision');
  });

  it('renders a "reply" chip when queueType is reply', () => {
    render(<AskCard data={reviewCard({ queueType: 'reply' })} />);
    expect(screen.getByTestId('ask-card-queue-type')).toHaveTextContent('reply');
  });

  it('renders no chip when queueType is absent (e.g. a grouped Review item)', () => {
    render(<AskCard data={reviewCard()} />);
    expect(screen.queryByTestId('ask-card-queue-type')).not.toBeInTheDocument();
  });
});
