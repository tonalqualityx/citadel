import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ItemCard } from '../ItemCard';
import type { HomeItem } from '@/lib/home/types';

const { mockPeek } = vi.hoisted(() => ({ mockPeek: vi.fn() }));
vi.mock('@/lib/contexts/task-peek-context', () => ({ useTaskPeek: () => ({ openTaskPeek: mockPeek }) }));

function mkItem(key: string, over: Partial<HomeItem> = {}): HomeItem {
  return {
    key,
    type: 'task',
    title: `Title ${key}`,
    who: 'Gene Roberts',
    age: '3 days',
    why_now: 'A reason.',
    hard_date: null,
    effort: 'About 10 minutes',
    minutes: 10,
    actions: [{ id: 'done', label: 'Done', filled: true, href: null }],
    more_actions: [],
    default_if_ignored: 'Stays here.',
    reason: 'It is here.',
    pinned: false,
    opened: { summary: 'Summary.', summary_by: null, done_when: [], how: null, links: [], task_id: null, left_off_note: null },
    source: { kind: 'task', id: key, ids: [key], task_status: 'not_started' },
    client: null,
    project: null,
    ...over,
  };
}


const base = { emptyText: 'Nothing urgent.', onAction: () => {} };

describe('ItemCard', () => {
  it('shows the empty sentence with no item', () => {
    render(<ItemCard {...base} item={null} />);
    expect(screen.getByText('Nothing urgent.')).toBeInTheDocument();
  });
  it('follows the 2B order: statement, meta, why, buttons, summary', () => {
    const item = mkItem('task:1', {
      hard_date: 'Due Friday, November 14 (Gene)',
      actions: [
        { id: 'do_now', label: "I'll do it now", filled: true, href: null },
        { id: 'done', label: 'Done', filled: false, href: null },
      ],
    });
    const { container } = render(<ItemCard {...base} item={item} />);
    const text = container.textContent ?? '';
    const order = ['Title task:1', 'Due Friday', 'A reason.', "I'll do it now", 'Summary.', 'If you do nothing', "Why it's here"].map((s) => text.indexOf(s));
    expect(order.every((n) => n >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
  it('only the filled action is filled; one filled button', () => {
    const item = mkItem('task:1', {
      actions: [
        { id: 'do_now', label: 'A', filled: true, href: null },
        { id: 'done', label: 'B', filled: false, href: null },
      ],
    });
    render(<ItemCard {...base} item={item} />);
    expect(screen.getByRole('button', { name: 'A' })).toHaveAttribute('data-filled', 'true');
    expect(screen.getByRole('button', { name: 'B' })).not.toHaveAttribute('data-filled');
  });
  it('calls onAction and disables while pending', () => {
    const onAction = vi.fn();
    const item = mkItem('task:1');
    const { rerender } = render(<ItemCard {...base} item={item} onAction={onAction} />);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onAction).toHaveBeenCalledWith(item.actions[0], item);
    rerender(<ItemCard {...base} item={item} onAction={onAction} pendingAction="done" />);
    expect(screen.getByRole('button', { name: 'Done' })).toBeDisabled();
  });
  it('More reveals the rest', () => {
    const item = mkItem('task:1', { more_actions: [{ id: 'not_now', label: 'Not now', filled: false, href: null }] });
    render(<ItemCard {...base} item={item} />);
    expect(screen.queryByRole('button', { name: 'Not now' })).toBeNull();
    const more = screen.getByRole('button', { name: 'More' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(more);
    expect(screen.getByRole('button', { name: 'Not now' })).toBeInTheDocument();
  });
  it('Done when only for two or more deliverables', () => {
    const one = mkItem('a', { opened: { ...mkItem('a').opened, done_when: [{ text: 'Only one', done: false }] } });
    const { unmount } = render(<ItemCard {...base} item={one} />);
    expect(screen.queryByText('Done when')).toBeNull();
    unmount();
    const two = mkItem('b', { opened: { ...mkItem('b').opened, done_when: [{ text: 'First', done: true }, { text: 'Second', done: false }] } });
    render(<ItemCard {...base} item={two} />);
    expect(screen.getByText('Done when')).toBeInTheDocument();
    expect(screen.getByText(/First/)).toBeInTheDocument();
  });
  it('links are named links, in-app and outside', () => {
    const item = mkItem('a', {
      opened: { ...mkItem('a').opened, links: [{ label: 'The project', href: '/projects/1' }, { label: 'The draft', href: 'https://mail.example.com/x' }], how: { label: 'The runbook', href: 'https://x.example.com' } },
    });
    render(<ItemCard {...base} item={item} />);
    expect(screen.getByRole('link', { name: 'The project' })).toHaveAttribute('href', '/projects/1');
    const out = screen.getByRole('link', { name: 'The draft' });
    expect(out).toHaveAttribute('target', '_blank');
    expect(out).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(screen.getByRole('link', { name: 'The runbook' })).toBeInTheDocument();
  });
  it('Original notes opens the peek drawer', () => {
    const item = mkItem('a', { opened: { ...mkItem('a').opened, task_id: 't-9' } });
    render(<ItemCard {...base} item={item} />);
    fireEvent.click(screen.getByRole('button', { name: 'Original notes' }));
    expect(mockPeek).toHaveBeenCalledWith('t-9');
  });
  it('status line is a live region; prompt buttons work', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ItemCard
        {...base}
        item={mkItem('a')}
        statusText="That didn't go through."
        prompt={{ text: 'Switch to this one?', confirmLabel: 'Switch', cancelLabel: 'Keep the first', onConfirm, onCancel }}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent("That didn't go through.");
    fireEvent.click(screen.getByRole('button', { name: 'Switch' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep the first' }));
    expect(onConfirm).toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });
  it('shows no dash even if stored text has one', () => {
    const item = mkItem('a', { title: 'Fix it — now', why_now: 'Late – again' });
    const { container } = render(<ItemCard {...base} item={item} />);
    expect(container.textContent).not.toMatch(/[–—]/);
  });
  it('hideActions drops the buttons', () => {
    render(<ItemCard {...base} item={mkItem('a')} hideActions />);
    expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
  });
  it('shows the muted "Short version by Bast." line only for a Bast summary', () => {
    const plainItem = mkItem('task:1');
    const { rerender } = render(<ItemCard {...base} item={plainItem} />);
    expect(screen.queryByText('Short version by Bast.')).toBeNull();
    const bast = mkItem('task:1', { opened: { ...plainItem.opened, summary: 'Short.', summary_by: 'bast', task_id: 'abc' } });
    rerender(<ItemCard {...base} item={bast} />);
    const note = screen.getByText('Short version by Bast.');
    expect(note.className).toContain('home-muted');
    expect(screen.getByText('Short.')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Original notes'));
    expect(mockPeek).toHaveBeenCalledWith('abc');
  });
  it('shows a Done when list from Bast lines at 2 or more, and none at fewer', () => {
    const o = mkItem('task:1').opened;
    const lines = (n: number) => Array.from({ length: n }, (_, i) => ({ text: `Line ${i + 1}`, done: false }));
    const { rerender } = render(<ItemCard {...base} item={mkItem('task:1', { opened: { ...o, summary_by: 'bast', done_when: lines(3) } })} />);
    expect(screen.getByText('Done when')).toBeInTheDocument();
    expect(screen.getByText('Line 3')).toBeInTheDocument();
    rerender(<ItemCard {...base} item={mkItem('task:1', { opened: { ...o, summary_by: 'bast', done_when: lines(1) } })} />);
    expect(screen.queryByText('Done when')).toBeNull();
  });
});

describe('ItemCard: Slice 4a owed replies', () => {
  const thread = (over: Partial<HomeItem> = {}, opened: Partial<HomeItem['opened']> = {}) =>
    mkItem('thread:a:b', {
      type: 'owed_reply',
      source: { kind: 'thread', id: 'x', ids: ['x'], task_status: null },
      actions: [
        { id: 'open_draft', label: 'Open the draft', filled: false, href: 'https://mail.example/x' },
        { id: 'needs_thought', label: 'Needs thought', filled: false, href: null },
        { id: 'not_now', label: 'Not now', filled: false, href: null },
      ],
      opened: { ...mkItem('a').opened, ...opened },
      ...over,
    });

  it('shows The draft block, pre-wrapped, with the text as written and no red', () => {
    const text = 'Hi Pat,\n\nThanks for writing. I will get back to you.\n\nMike';
    const { container } = render(<ItemCard {...base} item={thread({ owed_line: 'Draft ready' }, { draft_text: text })} />);
    expect(screen.getByText('The draft')).toBeInTheDocument();
    const block = container.querySelector('.home-draft') as HTMLElement;
    expect(block.textContent).toBe(text);
    expect(block.style.color).toBe('');
    expect(screen.getByText('Draft ready')).toBeInTheDocument();
  });
  it('shows Bast\'s read and the suggested answer lines', () => {
    render(<ItemCard {...base} item={thread({}, { bast_read: 'They want a price.', suggested_answer: 'Ask which pages first.' })} />);
    expect(screen.getByText("Bast's read: They want a price.")).toBeInTheDocument();
    expect(screen.getByText('Suggested answer: Ask which pages first.')).toBeInTheDocument();
    expect(screen.queryByText('The draft')).toBeNull();
  });
  it('shows the new-message line for his older draft', () => {
    render(<ItemCard {...base} item={thread({ owed_line: 'Their new message came after your draft.' })} />);
    expect(screen.getByText('Their new message came after your draft.')).toBeInTheDocument();
  });
  it('shows no draft block without draft text', () => {
    render(<ItemCard {...base} item={thread()} />);
    expect(screen.queryByText('The draft')).toBeNull();
  });
  it('the buttons pass their action to onAction, and no button on a draft card says Send', () => {
    const onAction = vi.fn();
    const item = thread();
    render(<ItemCard {...base} item={item} onAction={onAction} />);
    fireEvent.click(screen.getByRole('button', { name: 'Needs thought' }));
    expect(onAction).toHaveBeenCalledWith(item.actions[1], item);
    for (const b of screen.getAllByRole('button')) expect(b.textContent).not.toMatch(/send/i);
  });
});

describe('ItemCard: Slice 6a rule picker', () => {
  const crisis = (over: Partial<HomeItem> = {}) =>
    mkItem('crisis:abc', {
      type: 'emergency',
      actions: [{ id: 'handled', label: 'Handled', filled: false, href: null }, { id: 'not_emergency', label: 'Not an emergency', filled: false, href: null }],
      not_emergency_scopes: [
        { scope: 'sender', label: 'Mail from alerts@wpmudev.com' },
        { scope: 'domain', label: 'Mail from anyone at wpmudev.com' },
      ],
      ...over,
    });

  it('Not an emergency asks "Why? This becomes a rule." with the choices, and does not act yet', () => {
    const onAction = vi.fn();
    render(<ItemCard {...base} item={crisis()} onAction={onAction} onSaveRule={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Not an emergency' }));
    expect(screen.getByText('Why? This becomes a rule.')).toBeInTheDocument();
    expect(screen.getByLabelText('Mail from alerts@wpmudev.com')).toBeChecked();
    expect(screen.getByLabelText('Mail from anyone at wpmudev.com')).not.toBeChecked();
    expect(onAction).not.toHaveBeenCalled();
  });

  it('Save rule sends the chosen scope and the reason, and Cancel closes it without a call', async () => {
    const onSaveRule = vi.fn().mockResolvedValue(true);
    const item = crisis();
    render(<ItemCard {...base} item={item} onSaveRule={onSaveRule} />);
    fireEvent.click(screen.getByRole('button', { name: 'Not an emergency' }));
    fireEvent.click(screen.getByLabelText('Mail from anyone at wpmudev.com'));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Always noise' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save rule' }));
    expect(onSaveRule).toHaveBeenCalledWith(item, 'domain', 'Always noise');
    await screen.findByRole('button', { name: 'Not an emergency' });
    fireEvent.click(screen.getByRole('button', { name: 'Not an emergency' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onSaveRule).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Why? This becomes a rule.')).toBeNull();
  });

  it('a task emergency keeps the one-time button and says a security flag is never a rule', () => {
    const onAction = vi.fn();
    const item = mkItem('task:1', {
      type: 'emergency',
      actions: [{ id: 'not_emergency', label: 'Not an emergency', filled: false, href: null }],
      not_emergency_refusal: 'A security flag is never turned into a rule.',
    });
    render(<ItemCard {...base} item={item} onAction={onAction} onSaveRule={vi.fn()} />);
    expect(screen.getByText('A security flag is never turned into a rule.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Not an emergency' }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Why? This becomes a rule.')).toBeNull();
  });
});
