import { describe, it, expect } from 'vitest';
import { deriveTimeline, initialFeedState, isWorkerSilent, mergeFeedPage, pastTenseLabel, type FeedEvent } from '../feed-reducer';

const ev = (seq: number, kind: string, payload: unknown, role = 'assistant'): FeedEvent => ({ seq, role, kind, payload, created_at: '2026-10-28T10:00:00Z' });

describe('mergeFeedPage', () => {
  it('never duplicates a repeated page and returns the same state', () => {
    const page = [ev(1, 'text', { text: 'a' }), ev(2, 'text', { text: 'b' })];
    const once = mergeFeedPage(initialFeedState, page);
    const twice = mergeFeedPage(once, page);
    expect(twice).toBe(once);
    expect(once.events.map((e) => e.seq)).toEqual([1, 2]);
    expect(once.cursor).toBe(2);
  });

  it('tolerates out-of-order and overlapping pages without dropping any event', () => {
    let s = mergeFeedPage(initialFeedState, [ev(4, 'text', { text: 'd' }), ev(5, 'text', { text: 'e' })]);
    s = mergeFeedPage(s, [ev(1, 'text', { text: 'a' }), ev(2, 'text', { text: 'b' }), ev(3, 'text', { text: 'c' }), ev(4, 'text', { text: 'd' })]);
    expect(s.events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(s.cursor).toBe(5);
    expect(deriveTimeline(s).map((i) => i.seq)).toEqual([1, 2, 3, 4, 5]);
  });

  it('pairs an action with its result by tool-use id and turns the label into past tense', () => {
    const s = mergeFeedPage(initialFeedState, [
      ev(1, 'action', { tool: 'Grep', label: 'Searching the library', tool_use_id: 'A' }),
      ev(2, 'action', { tool: 'Read', label: 'Reading home.njk', tool_use_id: 'B' }),
      ev(3, 'result', { tool: 'Read', tool_use_id: 'B', ok: true, summary: '40 lines', duration_ms: 12 }),
      ev(4, 'result', { tool: 'Grep', tool_use_id: 'A', ok: false, summary: 'no match' }),
    ]);
    const tl = deriveTimeline(s);
    expect(tl).toHaveLength(2);
    expect(tl[0]).toMatchObject({ type: 'tool', label: 'Searched the library', state: 'failed', summary: 'no match' });
    expect(tl[1]).toMatchObject({ type: 'tool', label: 'Read home.njk', state: 'ok', summary: '40 lines', duration_ms: 12 });
  });

  it('keeps an open action running until its result lands', () => {
    const s = mergeFeedPage(initialFeedState, [ev(1, 'action', { tool: 'Bash', label: 'Running the build', tool_use_id: 'X' })]);
    expect(deriveTimeline(s)[0]).toMatchObject({ state: 'running', label: 'Running the build' });
    const done = mergeFeedPage(s, [ev(2, 'result', { tool: 'Bash', tool_use_id: 'X', ok: true })]);
    expect(deriveTimeline(done)[0]).toMatchObject({ state: 'ok', label: 'Ran the build' });
  });

  it('falls back to the oldest open action of the same tool when there is no id', () => {
    const s = mergeFeedPage(initialFeedState, [
      ev(1, 'action', { tool: 'Edit', label: 'Editing a.njk' }),
      ev(2, 'action', { tool: 'Edit', label: 'Editing b.njk' }),
      ev(3, 'result', { tool: 'Edit', ok: true }),
    ]);
    const tl = deriveTimeline(s);
    expect(tl[0]).toMatchObject({ state: 'ok', label: 'Edited a.njk' });
    expect(tl[1]).toMatchObject({ state: 'running' });
  });

  it('shows an unmatched result on its own', () => {
    const s = mergeFeedPage(initialFeedState, [ev(7, 'result', { tool: 'Bash', ok: true, summary: 'done' })]);
    expect(deriveTimeline(s)).toHaveLength(1);
  });

  it('keeps the latest plan whole, whatever order the pages arrive in', () => {
    let s = mergeFeedPage(initialFeedState, [ev(9, 'plan', { items: [{ text: 'B', status: 'completed' }] })]);
    s = mergeFeedPage(s, [ev(3, 'plan', { items: [{ text: 'A', status: 'pending' }, { text: 'B', status: 'pending' }] })]);
    expect(s.plan).toEqual([{ text: 'B', status: 'completed' }]);
    s = mergeFeedPage(s, [ev(12, 'plan', { items: [{ text: 'C', status: 'in_progress' }] })]);
    expect(s.plan).toEqual([{ text: 'C', status: 'in_progress' }]);
    expect(deriveTimeline(s)).toHaveLength(0);
  });

  it('tracks the last turn cost from the newest cost event', () => {
    let s = mergeFeedPage(initialFeedState, [
      ev(2, 'cost', { turn_usd: 0.4, total_usd: 0.4, budget_usd: 5 }),
      ev(6, 'cost', { turn_usd: '0.75', total_usd: 1.15, budget_usd: 5 }),
    ]);
    expect(s.lastTurn).toEqual({ turn_usd: 0.75, total_usd: 1.15, budget_usd: 5 });
    s = mergeFeedPage(s, [ev(4, 'cost', { turn_usd: 9, total_usd: 9, budget_usd: 5 })]);
    expect(s.lastTurn?.turn_usd).toBe(0.75);
  });

  it('counts client files from the newest listing', () => {
    const s = mergeFeedPage(initialFeedState, [ev(1, 'client_files', { items: [{ id: 'a' }, { id: 'b' }] })]);
    expect(s.clientFilesCount).toBe(2);
    expect(deriveTimeline(s)[0]).toMatchObject({ type: 'client_files', count: 2 });
  });
});

describe('pastTenseLabel', () => {
  it.each([
    ['Searching the web', 'Searched the web'],
    ['Reading a.njk', 'Read a.njk'],
    ['Stopping preview', 'Stopped preview'],
    ['Pressing on', 'Pressed on'],
    ['Deploying preview', 'Deployed preview'],
    ['Home page', 'Home page'],
  ])('%s -> %s', (a, b) => expect(pastTenseLabel(a)).toBe(b));
});

describe('isWorkerSilent', () => {
  const now = Date.parse('2026-10-28T10:10:00Z');
  const hb = (secAgo: number) => new Date(now - secAgo * 1000).toISOString();
  it('is silent when the heartbeat is older than 30 s on a live session', () => {
    expect(isWorkerSilent({ status: 'active', lastHeartbeatAt: hb(31), now })).toBe(true);
    expect(isWorkerSilent({ status: 'active', lastHeartbeatAt: hb(10), now })).toBe(false);
  });
  it('is silent when pending for more than 60 s', () => {
    expect(isWorkerSilent({ status: 'pending', lastHeartbeatAt: hb(5), pendingSinceMs: now - 61_000, now })).toBe(true);
    expect(isWorkerSilent({ status: 'pending', lastHeartbeatAt: hb(5), pendingSinceMs: now - 30_000, now })).toBe(false);
  });
  it('never warns on a closed or stopped session', () => {
    expect(isWorkerSilent({ status: 'closed', lastHeartbeatAt: null, now })).toBe(false);
    expect(isWorkerSilent({ status: 'stopped', lastHeartbeatAt: hb(999), now })).toBe(false);
  });
});
