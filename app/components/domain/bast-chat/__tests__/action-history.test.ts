import { describe, it, expect } from 'vitest';
import { buildChatItems, buildHistory, isPinned, shortQuote, summarizeActions, undoableCount } from '../action-history';
import type { ChatAction, TimelineItem } from '@/lib/hooks/use-bast-chat';

const NOW = Date.parse('2026-11-13T15:00:00Z');
const FUTURE = '2026-11-14T15:00:00Z';
const act = (id: string, over: Partial<ChatAction> = {}): ChatAction => ({
  id,
  tool: 'comment_on_task',
  summary: `Added a note to "T${id}".`,
  status: 'applied',
  undo_until: FUTURE,
  event_seq: 2,
  ...over,
});
const msg = (key: string, role: 'mike' | 'assistant', text: string): TimelineItem => ({
  type: 'message',
  key,
  message: { key, seq: 1, role, text, state: 'sent', canResend: false },
});
const line = (a: ChatAction, at: string | null = '2026-11-13T14:00:00Z'): TimelineItem => ({ type: 'action', key: `a${a.id}`, action: a, at });
const none = () => null;

describe('isPinned', () => {
  it('keeps failures and proposals waiting for a tap, moves the rest', () => {
    expect(isPinned(act('1', { status: 'failed' }), null)).toBe(true);
    expect(isPinned(act('1', { status: 'proposed' }), null)).toBe(true);
    expect(isPinned(act('1', { status: 'proposed' }), 'changed')).toBe(true);
    expect(isPinned(act('1', { status: 'proposed' }), 'released')).toBe(false);
    expect(isPinned(act('1', { status: 'proposed' }), 'declined')).toBe(false);
    for (const s of ['applied', 'undone', 'released', 'declined'] as const) expect(isPinned(act('1', { status: s }), null)).toBe(false);
  });
});

describe('buildChatItems', () => {
  const timeline = [
    msg('m1', 'mike', 'Do it'),
    msg('m2', 'assistant', 'Got it.'),
    line(act('a')),
    line(act('b')),
    line(act('c', { status: 'failed' })),
    line(act('d', { status: 'proposed' })),
    msg('m3', 'mike', 'And again'),
    msg('m4', 'assistant', 'Done.'),
    line(act('e')),
  ];
  it('puts one summary at the end of each turn and leaves failed and waiting cards where they were', () => {
    const items = buildChatItems(timeline, none);
    expect(items.map((i) => (i.type === 'action' ? `act:${i.action.id}` : i.type === 'actions' ? `sum:${i.actions.map((a) => a.id).join('')}` : i.key))).toEqual([
      'm1', 'm2', 'act:c', 'act:d', 'sum:ab', 'm3', 'm4', 'sum:e',
    ]);
  });
  it('puts the summary after the turn text even when the actions came first', () => {
    const items = buildChatItems([msg('m1', 'mike', 'x'), line(act('a')), msg('m2', 'assistant', 'All done')], none);
    expect(items.map((i) => i.type)).toEqual(['message', 'message', 'actions']);
  });
  it('a proposal he just tapped moves into the summary', () => {
    const items = buildChatItems([msg('m1', 'mike', 'x'), line(act('d', { status: 'proposed' }))], (id) => (id === 'd' ? 'released' : null));
    expect(items.map((i) => i.type)).toEqual(['message', 'actions']);
  });
  it('no actions, no summary', () => {
    expect(buildChatItems([msg('m1', 'mike', 'x'), msg('m2', 'assistant', 'y')], none).map((i) => i.type)).toEqual(['message', 'message']);
  });
});

describe('buildHistory', () => {
  it('groups by turn, newest turn and newest entry first, with the quote and time', () => {
    const tl = [msg('m1', 'mike', 'first message'), line(act('a')), line(act('b')), msg('m2', 'mike', 'second  message\nwith lines'), line(act('c'), null), line(act('x', { status: 'failed' }))];
    const h = buildHistory(tl, none);
    expect(h.map((t) => t.turnKey)).toEqual(['m2', 'm1']);
    expect(h[0].quote).toBe('second message with lines');
    expect(h[0].entries.map((e) => e.action.id)).toEqual(['c']);
    expect(h[0].entries[0].at).toBeNull();
    expect(h[1].entries.map((e) => e.action.id)).toEqual(['b', 'a']);
    expect(h[1].entries[0].index).toBe(2);
  });
  it('actions with no message before them get a null quote', () => {
    expect(buildHistory([line(act('a'))], none)[0].quote).toBeNull();
  });
});

describe('undoableCount', () => {
  it('counts open windows only: not expired, not undone, not waiting for a tap', () => {
    const tl = [
      line(act('a')),
      line(act('b', { undo_until: '2026-11-12T00:00:00Z' })),
      line(act('c', { status: 'undone' })),
      line(act('d', { status: 'proposed', undo_until: FUTURE })),
      line(act('e')),
    ];
    expect(undoableCount(tl, none, NOW)).toBe(2);
  });
});

describe('summarizeActions', () => {
  it('sums notes and handoffs in order', () => {
    const list = [
      act('1'),
      act('2'),
      act('3', { tool: 'update_task', summary: 'Gave "Draft the email" to Bast.' }),
    ];
    expect(summarizeActions(list)).toBe('3 actions: added 2 notes, gave 1 task to Bast');
  });
  it('says one action in the singular and notes undone ones', () => {
    expect(summarizeActions([act('1')])).toBe('1 action: added 1 note');
    expect(summarizeActions([act('1'), act('2', { status: 'undone' })])).toBe('2 actions: added 2 notes (1 undone)');
  });
  it('folds past three kinds', () => {
    const list = [act('1'), act('2', { tool: 'create_task' }), act('3', { tool: 'start_quote' }), act('4', { tool: 'change_wait' }), act('5', { tool: 'start_project' })];
    expect(summarizeActions(list)).toMatch(/^5 actions: .*, and 2 other$/);
  });
  it('an unknown tool is an other change', () => {
    expect(summarizeActions([act('1', { tool: 'mystery' })])).toBe('1 action: made 1 other change');
  });
});

describe('shortQuote', () => {
  it('cuts long words at a word boundary', () => {
    const q = shortQuote('word '.repeat(60), 40);
    expect(q.length).toBeLessThanOrEqual(43);
    expect(q.endsWith('...')).toBe(true);
  });
});
