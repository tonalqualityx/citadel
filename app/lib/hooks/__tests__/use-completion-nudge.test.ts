import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hasCompletionNudge, showCompletionNudge, BAST_USER_ID } from '../use-completion-nudge';

const mockToast = vi.fn();
vi.mock('sonner', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}));

const mockPost = vi.fn();
vi.mock('@/lib/api/client', () => ({
  apiClient: { post: (...args: unknown[]) => mockPost(...args) },
}));

const mockShowToastSuccess = vi.fn();
const mockShowToastApiError = vi.fn();
vi.mock('@/lib/hooks/use-toast', () => ({
  showToast: {
    success: (...args: unknown[]) => mockShowToastSuccess(...args),
    apiError: (...args: unknown[]) => mockShowToastApiError(...args),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('hasCompletionNudge', () => {
  it('is false when the key is entirely absent', () => {
    expect(hasCompletionNudge({ id: 't1', status: 'done' })).toBe(false);
  });

  it('is false when the key is present but null', () => {
    expect(hasCompletionNudge({ id: 't1', completion_nudge: null })).toBe(false);
  });

  it('is true when a real nudge object is present', () => {
    expect(
      hasCompletionNudge({
        id: 't1',
        completion_nudge: { thread_id: 'th1', subject: 'Fix the thing', from_email: 'client@example.com' },
      })
    ).toBe(true);
  });

  it('is false for null/non-object input', () => {
    expect(hasCompletionNudge(null)).toBe(false);
    expect(hasCompletionNudge(undefined)).toBe(false);
    expect(hasCompletionNudge('nope')).toBe(false);
  });
});

describe('showCompletionNudge', () => {
  const nudge = { thread_id: 'th1', subject: 'Fix the thing', from_email: 'client@example.com' };

  it('shows a non-blocking toast with an accept action, never auto-firing the draft', () => {
    showCompletionNudge(nudge);

    expect(mockToast).toHaveBeenCalledTimes(1);
    expect(mockPost).not.toHaveBeenCalled();

    const [, options] = mockToast.mock.calls[0];
    expect(options.action.label).toBe('Draft it');
    expect(options.description).toContain('Fix the thing');
  });

  it('accepting queues a task assigned to Bast, priority 2, carrying thread context', async () => {
    mockPost.mockResolvedValue({});
    showCompletionNudge(nudge);

    const [, options] = mockToast.mock.calls[0];
    await options.action.onClick();

    expect(mockPost).toHaveBeenCalledWith(
      '/tasks',
      expect.objectContaining({
        title: 'Draft done-reply: Fix the thing',
        assignee_id: BAST_USER_ID,
        priority: 2,
        description: expect.stringContaining('th1'),
      })
    );
    expect(mockShowToastSuccess).toHaveBeenCalled();
  });

  it('surfaces an error toast if queuing the draft task fails', async () => {
    mockPost.mockRejectedValue(new Error('network down'));
    showCompletionNudge(nudge);

    const [, options] = mockToast.mock.calls[0];
    await options.action.onClick();

    expect(mockShowToastApiError).toHaveBeenCalled();
  });

  it('the description never sends anything itself — draft-only instruction included', async () => {
    mockPost.mockResolvedValue({});
    showCompletionNudge(nudge);
    const [, options] = mockToast.mock.calls[0];
    await options.action.onClick();

    const [, body] = mockPost.mock.calls[0];
    expect(body.description).toMatch(/never send/i);
  });
});
