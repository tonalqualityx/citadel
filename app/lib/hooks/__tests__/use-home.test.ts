import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ apiClient: api }));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/hooks/use-toast', () => ({ showToast: toasts }));
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

import {
  useHome,
  useHomeAct,
  useHomeArcActions,
  useHomeItemAction,
  useHomeUndo,
  isPinConflict,
  HOME_FAILURE_TEXT,
  HOME_PIN_SWITCH_TEXT,
} from '../use-home';
import type { HomeItem } from '@/lib/home/types';

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}
function wrapperFor(client: QueryClient) {
  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  }
  return Wrapper;
}

function item(over: Partial<HomeItem> = {}, source: Partial<HomeItem['source']> = {}): HomeItem {
  return {
    key: 'task:abc',
    type: 'task',
    title: 'Do the thing',
    who: null,
    age: 'today',
    why_now: '',
    hard_date: null,
    effort: '',
    minutes: 10,
    actions: [],
    more_actions: [],
    default_if_ignored: '',
    reason: '',
    pinned: false,
    opened: { summary: '', done_when: [], how: null, links: [], task_id: 'abc', left_off_note: null },
    source: { kind: 'task', id: 'abc', ids: ['abc'], task_status: 'in_progress', ...source },
    client: null,
    project: null,
    ...over,
  };
}

const okAct = { ok: true, action_id: 'a1', undo_until: '2026-11-11T00:00:00Z', item_key: 'task:abc', message: 'Back tomorrow at 9:00.' };

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockResolvedValue({});
  api.post.mockResolvedValue(okAct);
  api.patch.mockResolvedValue({});
});

function postsOf(action: string) {
  return api.post.mock.calls.filter((c) => c[0] === '/home/act' && (c[1] as { action: string }).action === action);
}

describe('useHome', () => {
  it('fetches /home once and never on focus, reconnect or interval', async () => {
    const client = makeClient();
    const { result } = renderHook(() => useHome(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.get).toHaveBeenCalledWith('/home');
    const opts = client.getQueryCache().getAll()[0].options as Record<string, unknown>;
    expect(opts.refetchOnWindowFocus).toBe(false);
    expect(opts.refetchOnReconnect).toBe(false);
    expect(opts.refetchInterval).toBe(false);
    expect(opts.staleTime).toBe(Infinity);
    window.dispatchEvent(new Event('focus'));
    expect(api.get).toHaveBeenCalledTimes(1);
  });
});

describe('isPinConflict', () => {
  it('recognises the server sentence and a code', () => {
    expect(isPinConflict(new Error(HOME_PIN_SWITCH_TEXT))).toBe(true);
    expect(isPinConflict({ code: 'pin_conflict' })).toBe(true);
    expect(isPinConflict(new Error('boom'))).toBe(false);
  });
});

describe('useHomeAct', () => {
  it('posts, toasts the server line with Undo, refetches', async () => {
    const client = makeClient();
    const { result } = renderHook(
      () => ({ home: useHome(), act: useHomeAct() }),
      { wrapper: wrapperFor(client) },
    );
    await waitFor(() => expect(result.current.home.isSuccess).toBe(true));
    await act(async () => {
      await result.current.act({ action: 'not_now', item_key: 'task:abc' });
    });
    expect(api.post).toHaveBeenCalledWith('/home/act', { action: 'not_now', item_key: 'task:abc' });
    const [line, opts] = toasts.success.mock.calls[0];
    expect(line).toBe('Back tomorrow at 9:00.');
    expect(opts.action.label).toBe('Undo');
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    await act(async () => opts.action.onClick());
    expect(api.post).toHaveBeenCalledWith('/home/undo', { action_id: 'a1' });
    // His own action's Undo toasts "Undone."
    expect(toasts.success).toHaveBeenLastCalledWith('Undone.');
  });

  it('a keeper line Undo toasts "Put back."', async () => {
    const { result } = renderHook(() => useHomeUndo({ doneText: 'Put back.' }), { wrapper: wrapperFor(makeClient()) });
    let ok = false;
    await act(async () => {
      ok = await result.current('k1');
    });
    expect(ok).toBe(true);
    expect(api.post).toHaveBeenCalledWith('/home/undo', { action_id: 'k1' });
    expect(toasts.success).toHaveBeenLastCalledWith('Put back.');
  });

  it('on failure shows one plain sentence, rejects, and does not refetch', async () => {
    api.post.mockRejectedValueOnce(new Error('Request failed'));
    const client = makeClient();
    const { result } = renderHook(() => ({ home: useHome(), act: useHomeAct() }), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.home.isSuccess).toBe(true));
    await act(async () => {
      await expect(result.current.act({ action: 'matters_more', item_key: 'task:abc' })).rejects.toThrow();
    });
    expect(toasts.error).toHaveBeenCalledTimes(1);
    expect(toasts.error).toHaveBeenCalledWith(HOME_FAILURE_TEXT);
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it('does not toast a pin_conflict, only rejects', async () => {
    api.post.mockRejectedValueOnce(new Error(HOME_PIN_SWITCH_TEXT));
    const { result } = renderHook(() => useHomeAct(), { wrapper: wrapperFor(makeClient()) });
    await act(async () => {
      await expect(result.current({ action: 'pin', item_key: 'task:abc' })).rejects.toThrow(HOME_PIN_SWITCH_TEXT);
    });
    expect(toasts.error).not.toHaveBeenCalled();
  });
});

describe('useHomeArcActions', () => {
  it('sends add, remove, reorder, swap and lighter requests', async () => {
    const { result } = renderHook(() => useHomeArcActions(), { wrapper: wrapperFor(makeClient()) });
    await act(async () => {
      await result.current.addToArc('task:a', 'own', 'in_view');
      await result.current.removeFromArc('task:a', 'own');
      await result.current.reorderArc('own', ['task:b', 'task:c']);
      await result.current.swapArc('client:x');
      await result.current.lighterToday('project:y');
    });
    const bodies = api.post.mock.calls.filter((c) => c[0] === '/home/act').map((c) => c[1]);
    expect(bodies).toEqual([
      { action: 'arc_add', item_key: 'task:a', group_key: 'own', origin: 'in_view' },
      { action: 'arc_remove', item_key: 'task:a', group_key: 'own' },
      { action: 'arc_reorder', group_key: 'own', step_keys: ['task:b', 'task:c'] },
      { action: 'swap', to_group_key: 'client:x' },
      { action: 'lighter', to_group_key: 'project:y' },
    ]);
  });

  it('create-and-add creates the task first, then adds with origin created', async () => {
    api.post.mockImplementation(async (url: string) => (url === '/tasks' ? { id: 'ABC-1' } : okAct));
    const { result } = renderHook(() => useHomeArcActions(), { wrapper: wrapperFor(makeClient()) });
    await act(async () => {
      await result.current.createAndAddToArc('  Call Gene ', 'u1', 'own');
    });
    expect(api.post.mock.calls[0]).toEqual(['/tasks', { title: 'Call Gene', assignee_id: 'u1' }]);
    expect(api.post.mock.calls[1]).toEqual([
      '/home/act',
      { action: 'arc_add', item_key: 'task:abc-1', group_key: 'own', origin: 'created' },
    ]);
  });

  it('create-and-add says so when the task exists but the add failed', async () => {
    api.post.mockImplementation(async (url: string) => {
      if (url === '/tasks') return { id: 't1' };
      throw new Error('stale');
    });
    const { result } = renderHook(() => useHomeArcActions(), { wrapper: wrapperFor(makeClient()) });
    await act(async () => {
      await expect(result.current.createAndAddToArc('x', 'u1', 'own')).rejects.toThrow();
    });
    expect(toasts.error.mock.calls.some((c) => String(c[0]).includes('task was created'))).toBe(true);
  });
});

describe('useHomeItemAction', () => {
  function setup(opts = {}) {
    const client = makeClient();
    return renderHook(() => useHomeItemAction(opts), { wrapper: wrapperFor(client) });
  }

  it('done: PATCH done, record, Undo restores the previous status', async () => {
    const { result } = setup();
    await act(async () => {
      expect(await result.current.run({ id: 'done' }, item())).toBe(true);
    });
    expect(api.patch).toHaveBeenCalledWith('/tasks/abc', { status: 'done' });
    expect(postsOf('record')[0][1]).toEqual({ action: 'record', item_key: 'task:abc', did: 'done' });
    expect(postsOf('done_pin')).toHaveLength(0);
    const opts = toasts.success.mock.calls[0][1];
    await act(async () => opts.action.onClick());
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/tasks/abc', { status: 'in_progress' }));
    await waitFor(() => expect(postsOf('record').some((c) => (c[1] as { undo?: boolean }).undo)).toBe(true));
  });

  it('done on the pinned item also posts done_pin', async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.done(item({ pinned: true }));
    });
    expect(postsOf('done_pin')).toHaveLength(1);
  });

  it('do_now pins first, then sets in_progress', async () => {
    const order: string[] = [];
    api.post.mockImplementation(async (_u: string, b: { action: string }) => {
      order.push(`post:${b.action}`);
      return okAct;
    });
    api.patch.mockImplementation(async () => {
      order.push('patch');
      return {};
    });
    const { result } = setup();
    await act(async () => {
      await result.current.run({ id: 'do_now' }, item());
    });
    expect(order.slice(0, 2)).toEqual(['post:pin', 'patch']);
  });

  it('do_now on a pin_conflict leaves the task untouched and asks, then resends with switch', async () => {
    api.post.mockRejectedValueOnce(new Error(HOME_PIN_SWITCH_TEXT));
    const it = item();
    const { result } = setup();
    await act(async () => {
      expect(await result.current.run({ id: 'do_now' }, it)).toBe(false);
    });
    expect(api.patch).not.toHaveBeenCalled();
    expect(toasts.error).not.toHaveBeenCalled();
    const prompt = result.current.promptFor(it);
    expect(prompt?.text).toBe(HOME_PIN_SWITCH_TEXT);
    expect(result.current.promptFor(item({ key: 'task:other' }))).toBeNull();
    await act(async () => prompt!.onConfirm());
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/tasks/abc', { status: 'in_progress' }));
    expect(postsOf('pin')[1][1]).toEqual({ action: 'pin', item_key: 'task:abc', switch: true });
    await waitFor(() => expect(result.current.promptFor(it)).toBeNull());
  });

  it('cancel clears the question', async () => {
    api.post.mockRejectedValueOnce(new Error(HOME_PIN_SWITCH_TEXT));
    const it = item();
    const { result } = setup();
    await act(async () => {
      await result.current.run({ id: 'do_now' }, it);
    });
    await act(async () => result.current.promptFor(it)!.onCancel());
    expect(result.current.promptFor(it)).toBeNull();
  });

  it('a failed existing-endpoint action shows one sentence and no record', async () => {
    api.patch.mockRejectedValueOnce(new Error('nope'));
    const it = item();
    const { result } = setup();
    await act(async () => {
      expect(await result.current.run({ id: 'let_it_go' }, it)).toBe(false);
    });
    expect(toasts.error).toHaveBeenCalledTimes(1);
    expect(toasts.error).toHaveBeenCalledWith(HOME_FAILURE_TEXT);
    expect(result.current.statusFor(it)).toBe(HOME_FAILURE_TEXT);
    expect(postsOf('record')).toHaveLength(0);
    expect(api.get).not.toHaveBeenCalled();
  });

  it('approve_all patches each id in sequence', async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.run({ id: 'approve_all' }, item({ key: 'review:p1' }, { kind: 'review', id: 'p1', ids: ['t1', 't2', 't3'], task_status: null }));
    });
    expect(api.patch.mock.calls).toEqual([
      ['/tasks/t1', { approved: true }],
      ['/tasks/t2', { approved: true }],
      ['/tasks/t3', { approved: true }],
    ]);
  });

  it('wait buttons resolve the wait; no_reply_needed dismisses each ask and undoes to open', async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.run({ id: 'approve_wait' }, item({ key: 'wait:w1' }, { kind: 'wait', id: 'w1', ids: ['w1'], task_status: null }));
      await result.current.run({ id: 'no_reply_needed' }, item({ key: 'thread:a:b' }, { kind: 'thread', id: 'e1', ids: ['e1', 'e2'], task_status: null }));
    });
    expect(api.patch).toHaveBeenCalledWith('/waits/w1', { action: 'resolve', resolution: 'approved' });
    expect(api.patch).toHaveBeenCalledWith('/email-asks/e1', { state: 'dismissed' });
    expect(api.patch).toHaveBeenCalledWith('/email-asks/e2', { state: 'dismissed' });
    const undoOpts = toasts.success.mock.calls[toasts.success.mock.calls.length - 1][1];
    await act(async () => undoOpts.action.onClick());
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/email-asks/e2', { state: 'open' }));
  });

  it('open buttons navigate: in-app push, outside new tab, drawer when no href', async () => {
    const openTask = vi.fn();
    const win = vi.spyOn(window, 'open').mockImplementation(() => null);
    const { result } = setup({ openTask });
    await act(async () => {
      await result.current.run({ id: 'open_thread', href: 'https://mail.example/x' }, item());
      await result.current.run({ id: 'open_wait', href: '/sops/1' }, item());
      await result.current.run({ id: 'open_wait', href: null }, item());
    });
    expect(win).toHaveBeenCalledWith('https://mail.example/x', '_blank', 'noopener,noreferrer');
    expect(router.push).toHaveBeenCalledWith('/sops/1');
    expect(openTask).toHaveBeenCalledWith('abc');
    expect(api.patch).not.toHaveBeenCalled();
    win.mockRestore();
  });

  it('stop sends the note; add_to_arc needs a group key', async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.stop(item(), 'left off at step 2');
      await result.current.run({ id: 'add_to_arc' }, item(), { groupKey: 'own' });
    });
    expect(postsOf('stop')[0][1]).toEqual({ action: 'stop', item_key: 'task:abc', note: 'left off at step 2' });
    expect(postsOf('arc_add')[0][1]).toEqual({ action: 'arc_add', item_key: 'task:abc', group_key: 'own', origin: 'in_view' });
    await act(async () => {
      expect(await result.current.run({ id: 'remove_from_arc' }, item())).toBe(false);
    });
  });
});
