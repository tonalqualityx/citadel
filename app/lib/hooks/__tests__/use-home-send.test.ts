import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ apiClient: api }));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/hooks/use-toast', () => ({ showToast: toasts }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { useHomeItemAction } from '../use-home';
import type { HomeItem } from '@/lib/home/types';

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }, children);

const thread = (send: HomeItem['owed_send']): HomeItem => ({
  key: 'thread:a:b', type: 'owed_reply', title: 'Dana: photos', who: 'Dana', age: '', why_now: '', hard_date: null, effort: '', minutes: 5,
  actions: [], more_actions: [], default_if_ignored: '', reason: '', pinned: false,
  opened: { summary: '', summary_by: null, done_when: [], how: null, links: [], task_id: null, left_off_note: null },
  source: { kind: 'thread', id: 'x', ids: ['x'], task_status: null }, client: null, project: null, owed_send: send,
});

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockResolvedValue({});
});

describe('Send the draft (Slice 4b)', () => {
  it('posts to /home/send (never /home/act) with the item key and the draft id, then toasts the line with Undo', async () => {
    api.post.mockResolvedValueOnce({ ok: true, action_id: 'a9', send_after: '2026-11-12T15:10:00Z', item_key: 'thread:a:b', message: 'Sending your reply to Dana at 10:10 AM.' });
    const { result } = renderHook(() => useHomeItemAction({}), { wrapper });
    await act(async () => {
      expect(await result.current.run({ id: 'send_draft' }, thread({ draft_id: 'd1', short_draft_id: 's1' }))).toBe(true);
    });
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/home/send', { item_key: 'thread:a:b', draft_id: 'd1' });
    const [line, opts] = toasts.success.mock.calls[0];
    expect(line).toBe('Sending your reply to Dana at 10:10 AM.');
    expect(opts.action.label).toBe('Undo');
    await act(async () => {
      opts.action.onClick();
    });
    expect(api.post).toHaveBeenLastCalledWith('/home/undo', { action_id: 'a9' });
  });

  it('Send the short one posts the short draft id', async () => {
    api.post.mockResolvedValueOnce({ ok: true, action_id: 'a9', send_after: 'x', item_key: 'thread:a:b', message: 'Sending.' });
    const { result } = renderHook(() => useHomeItemAction({}), { wrapper });
    await act(async () => {
      await result.current.run({ id: 'send_short' }, thread({ draft_id: 'd1', short_draft_id: 's1' }));
    });
    expect(api.post).toHaveBeenCalledWith('/home/send', { item_key: 'thread:a:b', draft_id: 's1' });
  });

  it('an item without a draft id posts nothing', async () => {
    const { result } = renderHook(() => useHomeItemAction({}), { wrapper });
    await act(async () => {
      expect(await result.current.run({ id: 'send_draft' }, thread(null))).toBe(false);
      expect(await result.current.run({ id: 'send_short' }, thread({ draft_id: 'd1', short_draft_id: null }))).toBe(false);
    });
    expect(api.post).not.toHaveBeenCalled();
  });

  it('a refusal shows the server\'s own sentence', async () => {
    api.post.mockRejectedValueOnce(new Error('Sending from here is not turned on.'));
    const { result } = renderHook(() => useHomeItemAction({}), { wrapper });
    await act(async () => {
      expect(await result.current.run({ id: 'send_draft' }, thread({ draft_id: 'd1', short_draft_id: null }))).toBe(false);
    });
    expect(toasts.error).toHaveBeenCalledWith('Sending from here is not turned on.');
  });
});
