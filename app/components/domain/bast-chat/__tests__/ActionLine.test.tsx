import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ActionLine } from '../ActionLine';
import type { ChatAction } from '@/lib/hooks/use-bast-chat';

const NOW = Date.parse('2026-11-10T12:00:00Z');
const base: ChatAction = { id: 'a1', tool: 'update_task', summary: 'Moved "Call Gene" to blocked.', status: 'applied', undo_until: '2026-11-11T12:00:00Z', event_seq: 3 };
const handlers = { onUndo: vi.fn(), onRelease: vi.fn(), onDecline: vi.fn() };

describe('ActionLine', () => {
  it('shows the sentence and Undo while the window is open', () => {
    render(<ActionLine action={base} now={NOW} busy={false} error={null} {...handlers} />);
    expect(screen.getByText(base.summary)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(handlers.onUndo).toHaveBeenCalledWith('a1');
  });
  it('drops Undo when the window has closed', () => {
    render(<ActionLine action={{ ...base, undo_until: '2026-11-10T11:00:00Z' }} now={NOW} busy={false} error={null} {...handlers} />);
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });
  it('names the person on a proposal: Hand to Bast and Keep it', () => {
    render(<ActionLine action={{ ...base, status: 'proposed', undo_until: null, summary: 'Proposed: hand "Send Gene the preview" to Bast.', proposed_assignee: 'Bast' }} now={NOW} busy={false} error={null} {...handlers} />);
    expect(screen.queryByRole('button', { name: 'Do it' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'No' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Hand to Bast' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(handlers.onRelease).toHaveBeenCalledWith('a1');
    expect(handlers.onDecline).toHaveBeenCalledWith('a1');
  });
  it('shows a plain error sentence', () => {
    render(<ActionLine action={base} now={NOW} busy={false} error="Changed since. Open the task." {...handlers} />);
    expect(screen.getByText('Changed since. Open the task.')).toBeTruthy();
  });
});
