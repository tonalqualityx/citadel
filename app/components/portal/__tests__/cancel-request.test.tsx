import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CancelRequest } from '../cancel-request';

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});
const ok = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;

describe('CancelRequest', () => {
  it('is a quiet button, then asks inline, and Keep it puts it back', () => {
    render(<CancelRequest taskId="t1" title="Update hours" mode="allowed" />);
    const link = screen.getByRole('button', { name: 'Cancel this request' });
    expect(link.className).toContain('btn-quiet');
    expect(link.className).not.toContain('btn-primary');
    fireEvent.click(link);
    expect(screen.getByText('Cancel it? This cannot be undone from here.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(screen.getByRole('button', { name: 'Cancel this request' })).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Yes, cancel posts to the cancel route once and calls back', async () => {
    fetchMock.mockResolvedValue(ok({ cancelled: true }));
    const onCancelled = vi.fn();
    render(<CancelRequest taskId="t1" title="Update hours" mode="allowed" onCancelled={onCancelled} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel this request' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, cancel' }));
    await waitFor(() => expect(onCancelled).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/portal/work/t1/cancel', { method: 'POST' });
  });

  it('shows the server line on a 409 and a plain line on any other failure', async () => {
    fetchMock.mockResolvedValueOnce(ok({ error: 'This change is already live.', code: 'live' }, 409));
    render(<CancelRequest taskId="t1" title="Update hours" mode="allowed" />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel this request' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, cancel' }));
    expect((await screen.findByRole('alert')).textContent).toContain('This change is already live.');
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, cancel' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('We could not cancel this request. Please try again.'));
  });

  it('live work offers Ask for a change with the title carried in, and no cancel', () => {
    render(<CancelRequest taskId="t1" title="Update hours" mode="live" />);
    expect(screen.queryByRole('button', { name: 'Cancel this request' })).toBeNull();
    const a = screen.getByRole('link', { name: /Ask for a change/ });
    const href = new URL(a.getAttribute('href') ?? '', 'http://x.test');
    expect(href.pathname).toBe('/portal/requests/new');
    expect(href.searchParams.get('change')).toBe('Change to: Update hours');
    expect(href.searchParams.get('new')).toMatch(/^\d+$/);
  });

  it('approved and going live says so, and a cancelled request offers nothing', () => {
    const { rerender, container } = render(<CancelRequest taskId="t1" title="T" mode="going_live" />);
    expect(screen.getByTestId('going-live-note').textContent).toContain('going live');
    expect(screen.queryByRole('button')).toBeNull();
    rerender(<CancelRequest taskId="t1" title="T" mode="cancelled" />);
    expect(container.textContent).toBe('');
  });
});
