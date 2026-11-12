import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
// Work stage F: the clock lines read their own hooks; they have their own test (WorkClockLines.test.tsx).
vi.mock('../WorkClockLines', () => ({ WorkClockLines: () => null }));
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

describe('ItemCard: Slice 7c time basis', () => {
  it('shows where a guessed time came from in the footer', () => {
    const item = mkItem('task:1', { opened: { ...mkItem('task:1').opened, effort_basis: 'Time guess: from 4 similar finished tasks.' } });
    render(<ItemCard {...base} item={item} />);
    expect(screen.getByText('Time guess: from 4 similar finished tasks.')).toBeInTheDocument();
  });
  it('shows no line when there is no basis', () => {
    const { container } = render(<ItemCard {...base} item={mkItem('task:1')} />);
    expect(container.textContent).not.toContain('Time guess');
  });
});

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
  it('shows the outside check line under the reason when there is one, and nothing when there is not', () => {
    const { rerender } = render(<ItemCard {...base} item={mkItem('task:1', { outside_check: 'Outside check 10:42: nothing new found from outside.' })} />);
    expect(screen.getByTestId('outside-check').textContent).toBe('Outside check 10:42: nothing new found from outside.');
    rerender(<ItemCard {...base} item={mkItem('task:1')} />);
    expect(screen.queryByTestId('outside-check')).toBeNull();
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

describe('ItemCard: Slice 4c leads and short drafts', () => {
  it('shows the short draft under "The short one" and has no Send button', () => {
    const item = mkItem('thread:a:b', {
      type: 'lead',
      actions: [{ id: 'open_short', label: 'Open the short one', filled: false, href: 'https://mail.example/t' }],
      more_actions: [],
      opened: { summary: 'S.', summary_by: null, done_when: [], how: null, links: [], task_id: null, left_off_note: null, short_draft_text: 'Got this. Back to you soon.' },
    });
    const { container } = render(<ItemCard {...base} item={item} />);
    expect(screen.getByText('The short one')).toBeInTheDocument();
    expect(screen.getByText('Got this. Back to you soon.')).toBeInTheDocument();
    expect(container.textContent ?? '').not.toMatch(/send/i);
  });
  it('Not a lead asks Treat as a reply or Close it, then passes that choice on', () => {
    const onAction = vi.fn();
    const item = mkItem('thread:a:b', {
      type: 'lead',
      actions: [{ id: 'not_now', label: 'Not now', filled: false, href: null }],
      more_actions: [{ id: 'not_lead', label: 'Not a lead', filled: false, href: null }],
    });
    render(<ItemCard {...base} item={item} onAction={onAction} />);
    fireEvent.click(screen.getByText('More'));
    fireEvent.click(screen.getByText('Not a lead'));
    expect(onAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Treat as a reply'));
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ id: 'treat_as_reply' }), item);
    fireEvent.click(screen.getByText('More'));
  });
});

describe('ItemCard: a project next step (Slice 8b)', () => {
  it('shows the step with its two lines, its three buttons, This matters more under More, and the plan footer', () => {
    const item = mkItem('step:p1', {
      type: 'step',
      title: 'Email Jack to accept the seven pages on the review site.',
      who: null,
      age: '21 days',
      why_now: 'Jack Gaughan Artist Site · quiet 21 days',
      actions: [
        { id: 'open_project', label: 'Open the project', filled: true, href: null },
        { id: 'step_done', label: 'I did this', filled: false, href: null },
        { id: 'not_now', label: 'Not now', filled: false, href: null },
      ],
      more_actions: [{ id: 'matters_more', label: 'This matters more', filled: false, href: null }],
      default_if_ignored: 'Stays here. Bast reads the project again tonight and rewrites this step.',
      reason: 'The next step on Jack Gaughan Artist Site is yours.',
      project: { id: 'p1', name: 'Jack Gaughan Artist Site' },
      source: { kind: 'step', id: 'p1', ids: ['p1'], task_status: null },
    });
    const onAction = vi.fn();
    const { container } = render(<ItemCard {...base} item={item} onAction={onAction} />);
    expect(screen.getByText('Jack Gaughan Artist Site · quiet 21 days')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'I did this' }));
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ id: 'step_done' }), item);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('button', { name: 'This matters more' })).toBeInTheDocument();
    expect(container.textContent).toContain("Why it's here: The next step on Jack Gaughan Artist Site is yours.");
    expect(container.textContent).toContain('Stays here. Bast reads the project again tonight and rewrites this step.');
  });
});

describe('ItemCard: Slice 9a, a card from his sent mail', () => {
  const proposalItem = (over: Partial<HomeItem> = {}, time: HomeItem['proposal'] extends infer P ? (P extends { time: infer T } ? T : never) : never = null as never): HomeItem =>
    mkItem('proposal:1', {
      type: 'proposal',
      title: 'You built and sent a sample page for Phil Camp. Track it?',
      actions: [
        { id: 'track_it', label: 'Add to Memorial pages', filled: true, href: null, placement: 'project' },
        { id: 'track_it', label: 'Start a new project', filled: false, href: null, placement: 'new_project' },
        { id: 'not_now', label: 'Not now', filled: false, href: null },
        { id: 'proposal_no', label: 'No, leave it', filled: false, href: null },
      ],
      default_if_ignored: 'Stays here for two weeks, then goes quietly. Nothing is made until you tap.',
      reason: 'Why Bast asks: this work is not in Citadel yet.',
      opened: { summary: '', summary_by: null, done_when: [], how: null, links: [{ label: 'Open the email', href: 'https://mail.google.com/x' }], task_id: null, left_off_note: null },
      proposal: {
        kind: 'track',
        lines: ['Your email to The Editor, Monday, November 9: "Here is the page."', 'Done: Build the page (Monday, November 9).', 'Where it goes: Memorial pages.'],
        why: 'Why Bast asks: this work is not in Citadel yet.',
        link: 'https://mail.google.com/x',
        look_back: false,
        time: time ?? { default: 90, choices: [15, 30, 60, 90, 120], basis: 'six emails', billable_choice: true },
        placement: { kind: 'add', project_id: 'p', project_name: 'Memorial pages' },
      },
      ...over,
    });

  it('shows the lines, the why line, the time choices with the estimate preselected, the buttons and the footer', () => {
    render(<ItemCard {...base} item={proposalItem()} />);
    expect(screen.getByText(/Your email to The Editor, Monday, November 9/)).toBeInTheDocument();
    expect(screen.getByText('Where it goes: Memorial pages.')).toBeInTheDocument();
    expect(screen.getAllByText('Why Bast asks: this work is not in Citadel yet.').length).toBeGreaterThan(0);
    const group = screen.getByRole('group', { name: 'Time spent' });
    expect(group.querySelector('button[data-filled="true"]')?.textContent).toBe('90');
    expect(screen.getByRole('button', { name: 'Add to Memorial pages' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start a new project' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'No, leave it' })).toBeInTheDocument();
    expect(screen.getByText('Open the email')).toBeInTheDocument();
    expect(screen.getByText(/Stays here for two weeks/)).toBeInTheDocument();
  });

  it('Track it sends the placement on the button with the minutes chosen and the billable choice', () => {
    const onAction = vi.fn();
    render(<ItemCard {...base} onAction={onAction} item={proposalItem()} />);
    fireEvent.click(screen.getByRole('button', { name: '60' }));
    fireEvent.click(screen.getByLabelText('Not billable'));
    fireEvent.click(screen.getByRole('button', { name: 'Start a new project' }));
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ id: 'track_it', placement: 'new_project', minutes: 60, billable: false }), expect.objectContaining({ key: 'proposal:1' }));
  });

  it('a number field sets a minutes of his own', () => {
    const onAction = vi.fn();
    render(<ItemCard {...base} onAction={onAction} item={proposalItem()} />);
    fireEvent.change(screen.getByLabelText('Minutes'), { target: { value: '75' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to Memorial pages' }));
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ placement: 'project', minutes: 75 }), expect.anything());
  });

  it('a done card starts with no time (None), a note card shows no time choice at all, and No sends no minutes', () => {
    const done = proposalItem(
      { actions: [{ id: 'proposal_yes', label: 'Mark it done', filled: true, href: null }, { id: 'proposal_no', label: 'No', filled: false, href: null }], proposal: { kind: 'done', lines: ['x'], why: 'w', link: null, look_back: false, time: { default: 30, choices: [15, 30, 60, 90, 120], basis: null, billable_choice: false }, placement: null } },
    );
    const onAction = vi.fn();
    const { unmount } = render(<ItemCard {...base} onAction={onAction} item={done} />);
    expect(screen.getByRole('group', { name: 'Time spent' }).querySelector('button[data-filled="true"]')?.textContent).toBe('None');
    expect(screen.queryByLabelText('Not billable')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Mark it done' }));
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ id: 'proposal_yes', minutes: null }), expect.anything());
    fireEvent.click(screen.getByRole('button', { name: 'No' }));
    expect(onAction).toHaveBeenLastCalledWith(expect.not.objectContaining({ minutes: expect.anything() }), expect.anything());
    unmount();
    const note = proposalItem({ actions: [{ id: 'proposal_yes', label: 'Add the note', filled: true, href: null }], proposal: { kind: 'note', lines: ['x'], why: 'w', link: null, look_back: false, time: null, placement: null } });
    render(<ItemCard {...base} item={note} />);
    expect(screen.queryByRole('group', { name: 'Time spent' })).toBeNull();
  });
});
