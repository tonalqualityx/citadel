import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';
import * as React from 'react';
import { BastChatPanel } from '../BastChatPanel';
import type { ChatAction, TimelineItem, UseBastChat } from '@/lib/hooks/use-bast-chat';

afterEach(cleanup);

const NOW = Date.parse('2026-11-13T15:00:00Z');
const OPEN = '2026-11-14T15:00:00Z';
const act = (id: string, over: Partial<ChatAction> = {}): ChatAction => ({
  id,
  tool: 'comment_on_task',
  summary: `Added a note to "Task ${id}".`,
  status: 'applied',
  undo_until: OPEN,
  event_seq: 3,
  ...over,
});
const msg = (seq: number, role: 'mike' | 'assistant', text: string): TimelineItem => ({
  type: 'message',
  key: `e${seq}`,
  message: { key: `e${seq}`, seq, role, text, state: 'sent', canResend: false },
});
const line = (a: ChatAction, at: string | null = '2026-11-13T14:05:00Z'): TimelineItem => ({ type: 'action', key: `a${a.id}`, action: a, at });

function fakeChat(timeline: TimelineItem[], over: Partial<UseBastChat> = {}): UseBastChat {
  return {
    availability: 'available',
    worker: null,
    notice: null,
    error: null,
    conversationStatus: 'idle',
    working: false,
    liveText: null,
    liveAction: null,
    timeline,
    lastAssistantSeq: 0,
    send: vi.fn(async () => true),
    sendAgain: vi.fn(async () => true),
    stop: vi.fn(async () => {}),
    newChat: vi.fn(async () => {}),
    openCardConversation: vi.fn(async () => true),
    leaveCardConversation: vi.fn(async () => {}),
    cardTaskId: null,
    actOn: vi.fn(async () => {}),
    actionError: () => null,
    actionOutcome: () => null,
    undoSince: vi.fn(async () => {}),
    sinceLines: () => null,
    actionBusy: () => false,
    now: NOW,
    ...over,
  };
}

function panel(chat: UseBastChat) {
  return (
    <BastChatPanel chat={chat} card={null} aboutDropped={false} onDropAbout={() => {}} draft="" setDraft={() => {}} />
  );
}

const fourActions = [
  msg(1, 'mike', 'We need to look into those content discrepancies'),
  msg(2, 'assistant', 'Got it.'),
  line(act('a')),
  line(act('b')),
  line(act('c', { tool: 'update_task', summary: 'Gave "Draft the email" to Bast.' })),
  line(act('d', { tool: 'propose_handoff', status: 'released', undo_until: null, summary: 'Hand "X" to Bast.' })),
];

describe('Chat and Actions tabs', () => {
  it('has two tabs, Chat selected, the count is the actions still undoable', () => {
    render(panel(fakeChat(fourActions)));
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Chat', 'Actions (3)']);
    expect(screen.getByTestId('tab-chat').getAttribute('aria-selected')).toBe('true');
  });
  it('the Chat tab shows the reply and one quiet line, no Undo buttons, and the reply is not followed by cards', () => {
    render(panel(fakeChat(fourActions)));
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    expect(screen.queryAllByTestId('action-line')).toHaveLength(0);
    const summary = screen.getByTestId('actions-summary');
    expect(summary.textContent).toContain('4 actions: added 2 notes, gave 1 task to Bast, handed 1 task to Bast');
    const log = screen.getByRole('log');
    const last = log.lastElementChild as HTMLElement;
    expect(last).toBe(summary);
    expect(log.children[log.children.length - 2].textContent).toContain('Got it.');
  });
  it('the Actions tab lists them newest first with the quote, the time and Undo, and Undo calls the same handler', () => {
    const chat = fakeChat(fourActions);
    render(panel(chat));
    fireEvent.click(screen.getByTestId('tab-actions'));
    const entries = screen.getAllByTestId('history-entry');
    expect(entries).toHaveLength(4);
    expect(entries[0].textContent).toContain('Hand');
    expect(entries[3].textContent).toContain('Task a');
    expect(screen.getByTestId('history-turn-quote').textContent).toContain('We need to look into those content discrepancies');
    expect(within(entries[3]).getByTestId('history-meta').textContent).toMatch(/\d/);
    fireEvent.click(within(entries[3]).getByRole('button', { name: 'Undo' }));
    expect(chat.actOn).toHaveBeenCalledWith('a', 'undo');
    expect(screen.queryByTestId('bast-chat-composer')).not.toBeVisible();
  });
  it('expired and undone entries say so', () => {
    const tl = [msg(1, 'mike', 'x'), line(act('a', { undo_until: null })), line(act('b', { status: 'undone', undo_until: null }))];
    render(panel(fakeChat(tl)));
    fireEvent.click(screen.getByTestId('tab-actions'));
    expect(screen.getByText(/Undo has expired/)).toBeTruthy();
    expect(screen.getByText('Undone.')).toBeTruthy();
    expect(screen.getByTestId('tab-actions').textContent).toBe('Actions');
  });
  it('a failed action and a proposal waiting for a tap stay in the Chat tab, with their buttons', () => {
    const tl = [
      msg(1, 'mike', 'x'),
      msg(2, 'assistant', 'Trying.'),
      line(act('f', { status: 'failed', error: 'Changed since.' })),
      line(act('p', { tool: 'propose_handoff', status: 'proposed', proposed_assignee: 'Bast', undo_until: null, summary: 'Hand "X" to Bast?' })),
      line(act('ok')),
    ];
    const chat = fakeChat(tl);
    render(panel(chat));
    expect(screen.getAllByTestId('action-line')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Hand to Bast' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hand to Bast' }));
    expect(chat.actOn).toHaveBeenCalledWith('p', 'release');
    expect(screen.getByTestId('actions-summary').textContent).toContain('1 action: added 1 note');
    fireEvent.click(screen.getByTestId('tab-actions'));
    expect(screen.getAllByTestId('history-entry')).toHaveLength(1);
  });
  it('View switches to the Actions tab at that turn', () => {
    const tl = [msg(1, 'mike', 'first'), line(act('a')), msg(5, 'mike', 'second'), msg(6, 'assistant', 'ok'), line(act('b'), '2026-11-13T14:30:00Z')];
    render(panel(fakeChat(tl)));
    const views = screen.getAllByRole('button', { name: 'View' });
    expect(views).toHaveLength(2);
    fireEvent.click(views[0]);
    expect(screen.getByTestId('tab-actions').getAttribute('aria-selected')).toBe('true');
    const group = screen.getByTestId('actions-history').querySelector('[data-turn="e1"]') as HTMLElement;
    expect(group.getAttribute('data-highlight')).toBe('true');
    fireEvent.click(screen.getByTestId('tab-chat'));
    expect(screen.getByTestId('bast-chat-composer')).toBeVisible();
  });
  it('empty state is one muted line', () => {
    render(panel(fakeChat([msg(1, 'mike', 'hi')])));
    fireEvent.click(screen.getByTestId('tab-actions'));
    expect(screen.getByTestId('actions-empty').textContent).toMatch(/No actions yet/);
    expect(screen.queryAllByTestId('history-entry')).toHaveLength(0);
  });
  it('Working and Stop stay in the Chat tab while a turn runs', () => {
    const chat = fakeChat(fourActions, { working: true, conversationStatus: 'running' });
    render(panel(chat));
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(chat.stop).toHaveBeenCalled();
    expect(screen.getByTestId('working-line')).toBeTruthy();
  });
  it('a new answer while on the Actions tab marks the Chat tab', () => {
    const chat = fakeChat(fourActions, { lastAssistantSeq: 2 });
    const { rerender } = render(panel(chat));
    fireEvent.click(screen.getByTestId('tab-actions'));
    rerender(panel({ ...chat, lastAssistantSeq: 9 }));
    expect(screen.getByTestId('tab-chat-dot')).toBeTruthy();
    fireEvent.click(screen.getByTestId('tab-chat'));
    expect(screen.queryByTestId('tab-chat-dot')).toBeNull();
  });
});
