import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ActionLine } from '../ActionLine';
import type { ChatAction, ProposalCard } from '@/lib/hooks/use-bast-chat';

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

  const card = (kind: ProposalCard['kind'], over: Partial<ProposalCard> = {}): ProposalCard => ({
    kind,
    title: 'Hand "Menu proof" to Bast?',
    lines: ['It is not started, so Bast starts on it.'],
    reads: [{ title: 'Menu proof', status: 'not_started', site: 'Grok', client: 'Grok', sop: null, excerpt: 'Check the menu against the sheet.', checklist: ['one', 'two'], writes: [], chat_changed: [], chat_changed_line: null }],
    client: [],
    buttons: kind === 'client_show' ? { yes: 'Share it', no: 'Keep it private' } : kind === 'bast_resteer' ? { yes: 'Let Bast re-read it', no: 'Leave it' } : { yes: 'Hand to Bast', no: 'Keep it' },
    clause: 'hand "Menu proof" to Bast',
    ...over,
  });
  const prop = (c: ProposalCard, over: Partial<ChatAction> = {}): ChatAction => ({ ...base, status: 'proposed', undo_until: null, summary: 'Waiting for your tap.', card: c, ...over });

  it.each([
    ['bast_start', 'Hand to Bast', 'Keep it'],
    ['bast_resteer', 'Let Bast re-read it', 'Leave it'],
    ['client_show', 'Share it', 'Keep it private'],
  ] as const)('card %s shows the server labels and its reads', (kind, yes, no) => {
    const onRelease = vi.fn();
    const onDecline = vi.fn();
    render(<ActionLine action={prop(card(kind, kind === 'client_show' ? { client: ['The client sees a new task called Menu proof.'] } : {}))} now={NOW} busy={false} error={null} onUndo={vi.fn()} onRelease={onRelease} onDecline={onDecline} />);
    expect(screen.getByRole('region', { name: 'Hand "Menu proof" to Bast?' })).toBeTruthy();
    expect(screen.getByText('Check the menu against the sheet.')).toBeTruthy();
    expect(screen.getByText('not started, Grok, Grok')).toBeTruthy();
    expect(screen.getByText('Checklist: 2')).toBeTruthy();
    expect(screen.getByRole('button', { name: yes }).getAttribute('data-filled')).toBe('true');
    expect(screen.getByRole('button', { name: no }).getAttribute('data-filled')).toBeNull();
    if (kind === 'client_show') expect(screen.getByText('The client sees a new task called Menu proof.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: yes }));
    fireEvent.click(screen.getByRole('button', { name: no }));
    expect(onRelease).toHaveBeenCalledWith('a1');
    expect(onDecline).toHaveBeenCalledWith('a1');
  });
  it('flags text the chat changed, and says nothing when it did not', () => {
    const changed = card('bast_start', { reads: [{ title: 'Menu proof', chat_changed: ['description'], chat_changed_line: 'Changed from this chat in the last day: description.' }] });
    const { unmount } = render(<ActionLine action={prop(changed)} now={NOW} busy={false} error={null} {...handlers} />);
    expect(screen.getByTestId('chat-changed').textContent).toBe('Changed from this chat in the last day: description.');
    unmount();
    render(<ActionLine action={prop(card('bast_start'))} now={NOW} busy={false} error={null} {...handlers} />);
    expect(screen.queryByTestId('chat-changed')).toBeNull();
  });
  it('after release shows one confirmation line and no buttons', () => {
    render(<ActionLine action={prop(card('bast_start'), { status: 'released' })} now={NOW} busy={false} error={null} {...handlers} />);
    expect(screen.getByTestId('card-released').textContent).toBe('Done. Hand "Menu proof" to Bast.');
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
  it('a 409 on the tap kills the card at once', () => {
    render(<ActionLine action={prop(card('bast_start'))} now={NOW} busy={false} error={null} outcome="changed" {...handlers} />);
    expect(screen.getByText('Changed since. Open the task.')).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByRole('region')).toBeNull();
  });
  it('a declined card collapses to one muted line', () => {
    render(<ActionLine action={prop(card('client_show'), { status: 'declined' })} now={NOW} busy={false} error={null} {...handlers} />);
    expect(screen.getByTestId('card-declined').className).toContain('home-muted');
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByRole('region')).toBeNull();
  });
  it('a failed card shows the failed text and no buttons', () => {
    render(<ActionLine action={prop(card('bast_start'), { status: 'failed', error: 'Changed since. Open the task.' })} now={NOW} busy={false} error={null} {...handlers} />);
    expect(screen.getByText("That didn't go through. Changed since. Open the task.")).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
  it('a feed without the new fields renders as before', () => {
    const { container } = render(<ActionLine action={{ id: 'x', tool: 'update_task', summary: 'Plain.', status: 'applied', undo_until: null, event_seq: 1 }} now={NOW} busy={false} error={null} {...handlers} />);
    expect(container.textContent).toBe('Plain.');
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  describe('undo everything since here', () => {
    it('hides it behind More, confirms with the count, then calls the route', () => {
      const onUndoSince = vi.fn();
      render(<ActionLine action={base} now={NOW} busy={false} error={null} sinceCount={3} onUndoSince={onUndoSince} {...handlers} />);
      expect(screen.queryByRole('button', { name: 'Undo everything since here' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'More' }));
      fireEvent.click(screen.getByRole('button', { name: 'Undo everything since here' }));
      expect(screen.getByTestId('since-confirm').textContent).toBe("This will undo 3 of the chat's changes.");
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(onUndoSince).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Undo everything since here' }));
      fireEvent.click(screen.getByRole('button', { name: 'Undo them' }));
      expect(onUndoSince).toHaveBeenCalledWith('a1');
    });
    it('shows no More control on a line that is not applied', () => {
      render(<ActionLine action={{ ...base, status: 'undone' }} now={NOW} busy={false} error={null} onUndoSince={vi.fn()} {...handlers} />);
      expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
    });
    it('shows the result lines', () => {
      render(<ActionLine action={base} now={NOW} busy={false} error={null} onUndoSince={vi.fn()} sinceLines={['Undid 2 changes.', 'Stopped at x. Why.']} {...handlers} />);
      expect(screen.getByText('Undid 2 changes.')).toBeTruthy();
      expect(screen.getByText('Stopped at x. Why.')).toBeTruthy();
    });
  });
});
