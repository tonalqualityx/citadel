import { describe, it, expect } from 'vitest';
import { deriveTimeline, initialFeedState, isWorkerSilent, isSetupSlow, mergeFeedPage, pastTenseLabel, type FeedEvent } from '../feed-reducer';

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

describe('isWorkerSilent (worker liveness, not the session heartbeat)', () => {
  const now = Date.parse('2026-10-28T10:10:00Z');
  it('is silent when the worker is offline on a live session', () => {
    expect(isWorkerSilent({ status: 'awaiting_input', workerOnline: false, now })).toBe(true);
    expect(isWorkerSilent({ status: 'active', workerOnline: false, now })).toBe(true);
  });
  it('is not silent while the worker is online, even for an idle session (no session heartbeat)', () => {
    expect(isWorkerSilent({ status: 'awaiting_input', workerOnline: true, now })).toBe(false);
    expect(isWorkerSilent({ status: 'pending', workerOnline: true, pendingSinceMs: now - 300_000, now })).toBe(false);
  });
  it('gives a pending session 60 s before an offline worker counts as silent', () => {
    expect(isWorkerSilent({ status: 'pending', workerOnline: false, pendingSinceMs: now - 61_000, now })).toBe(true);
    expect(isWorkerSilent({ status: 'pending', workerOnline: false, pendingSinceMs: now - 30_000, now })).toBe(false);
  });
  it('never warns on a closed or stopped session', () => {
    expect(isWorkerSilent({ status: 'closed', workerOnline: false, now })).toBe(false);
    expect(isWorkerSilent({ status: 'stopped', workerOnline: false, now })).toBe(false);
  });
  it('isSetupSlow: online worker, pending over 60 s', () => {
    expect(isSetupSlow({ status: 'pending', workerOnline: true, pendingSinceMs: now - 61_000, now })).toBe(true);
    expect(isSetupSlow({ status: 'pending', workerOnline: true, pendingSinceMs: now - 10_000, now })).toBe(false);
    expect(isSetupSlow({ status: 'pending', workerOnline: false, pendingSinceMs: now - 61_000, now })).toBe(false);
  });
});

describe('gate runs', () => {
  const gate = (seq: number, name: string, ok = true) => ev(seq, 'gate', { gates: [{ name, ok, summary: ok ? 'ok' : 'bad' }], blocking: true });
  it('folds consecutive per-gate events (tool lines between are fine) into one run', () => {
    const items = deriveTimeline({ events: [gate(1, 'build'), ev(2, 'action', { tool: 'x', label: 'Checking' }), gate(3, 'library'), gate(4, 'balance_check')] });
    const gates = items.filter((i) => i.type === 'gate');
    expect(gates).toHaveLength(1);
    expect(gates[0].type === 'gate' && gates[0].gates.map((g) => g.name)).toEqual(['build', 'library', 'balance_check']);
    expect(gates[0].type === 'gate' && gates[0].blocking).toBe(false);
  });
  it('a message between ends the run; a rerun of the same gate replaces the row', () => {
    const items = deriveTimeline({ events: [gate(1, 'build', false), gate(2, 'build', true), ev(3, 'text', { text: 'hi' }), gate(4, 'build')] });
    expect(items.filter((i) => i.type === 'gate')).toHaveLength(2);
    const first = items.find((i) => i.type === 'gate');
    expect(first && first.type === 'gate' && first.gates).toHaveLength(1);
    expect(first && first.type === 'gate' && first.gates[0].ok).toBe(true);
  });
  it('blocks only on a failed blocking gate; a failed balance check is report only', () => {
    const red = deriveTimeline({ events: [gate(1, 'build', false), gate(2, 'balance_check')] }).find((i) => i.type === 'gate');
    expect(red && red.type === 'gate' && red.blocking).toBe(true);
    const bal = deriveTimeline({ events: [gate(1, 'build'), gate(2, 'balance_check', false)] }).find((i) => i.type === 'gate');
    expect(bal && bal.type === 'gate' && bal.blocking).toBe(false);
  });
});

describe('tool results', () => {
  it('derives a one-line summary (first line, 120 chars) and keeps the raw output as details', () => {
    const body = Array.from({ length: 300 }, (_, i) => `${i + 1}: line of registry`).join('\n');
    const t = deriveTimeline({ events: [ev(1, 'action', { tool: 'Grep', label: 'Searching registry', tool_use_id: 'a' }), ev(2, 'result', { tool: 'Grep', tool_use_id: 'a', ok: true, summary: body })] })[0];
    expect(t.type === 'tool' && t.summary).toBe('1: line of registry (+299 more lines)');
    expect(t.type === 'tool' && t.details).toBe(body);
  });
  it('keeps a short summary as is, with no details', () => {
    const t = deriveTimeline({ events: [ev(1, 'action', { tool: 'Grep', label: 'Searching', tool_use_id: 'a' }), ev(2, 'result', { tool: 'Grep', tool_use_id: 'a', ok: true, summary: 'Searched library/registry.json: 30 matches' })] })[0];
    expect(t.type === 'tool' && t.summary).toBe('Searched library/registry.json: 30 matches');
    expect(t.type === 'tool' && t.details).toBeNull();
  });
  it('truncates a very long single line to 120 chars', () => {
    const t = deriveTimeline({ events: [ev(1, 'result', { tool: 'Read', ok: true, summary: 'x'.repeat(500) })] })[0];
    expect(t.type === 'tool' && t.summary!.length).toBe(120);
  });
});
