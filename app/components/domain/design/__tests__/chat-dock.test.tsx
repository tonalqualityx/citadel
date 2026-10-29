import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as React from 'react';
import { ChatDock, DOCK_OPEN_KEY, DOCK_WIDE_KEY, assistantMessageStats } from '../ChatDock';

const ev = (seq: number, role = 'assistant', kind = 'text') => ({ seq, role, kind });
const dock = (props: Partial<React.ComponentProps<typeof ChatDock>> = {}) =>
  <ChatDock {...props}><textarea aria-label="Message" /><p>body</p></ChatDock>;

// A small in-memory Storage, so the test does not depend on the environment's localStorage.
beforeEach(() => {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, String(v)), removeItem: (k: string) => void m.delete(k), clear: () => m.clear() });
});

describe('ChatDock', () => {
  it('starts open; collapse shows the pill, the pill expands; the choice persists', () => {
    const { unmount } = render(dock());
    expect(screen.getByTestId('chat-dock').hidden).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse chat' }));
    expect(screen.getByTestId('chat-dock').hidden).toBe(true);
    expect(window.localStorage.getItem(DOCK_OPEN_KEY)).toBe('closed');
    unmount();

    render(dock());
    expect(screen.getByTestId('chat-dock').hidden).toBe(true);
    fireEvent.click(screen.getByTestId('chat-pill'));
    expect(screen.getByTestId('chat-dock').hidden).toBe(false);
    expect(window.localStorage.getItem(DOCK_OPEN_KEY)).toBe('open');
  });

  it('stays mounted while collapsed so a draft survives', () => {
    render(dock());
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Collapse chat' }));
    fireEvent.click(screen.getByTestId('chat-pill'));
    expect((screen.getByLabelText('Message') as HTMLTextAreaElement).value).toBe('draft');
  });

  it('Esc inside the panel collapses; C toggles except while typing or in Select mode', () => {
    const { rerender } = render(dock());
    fireEvent.keyDown(screen.getByText('body'), { key: 'Escape' });
    expect(screen.getByTestId('chat-dock').hidden).toBe(true);
    fireEvent.keyDown(window, { key: 'c' });
    expect(screen.getByTestId('chat-dock').hidden).toBe(false);
    fireEvent.keyDown(screen.getByLabelText('Message'), { key: 'c' });
    expect(screen.getByTestId('chat-dock').hidden).toBe(false);
    fireEvent.keyDown(window, { key: 'C' });
    expect(screen.getByTestId('chat-dock').hidden).toBe(true);
    rerender(dock({ selectMode: true }));
    fireEvent.keyDown(window, { key: 'c' });
    expect(screen.getByTestId('chat-dock').hidden).toBe(true);
    rerender(dock({ selectMode: false }));
    fireEvent.keyDown(window, { key: 'c', ctrlKey: true });
    expect(screen.getByTestId('chat-dock').hidden).toBe(true);
  });

  it('Wide toggles the width and persists', () => {
    render(dock());
    expect(screen.getByTestId('chat-dock').className).toContain('min-[1100px]:w-[460px]');
    fireEvent.click(screen.getByRole('button', { name: 'Wide' }));
    expect(screen.getByTestId('chat-dock').className).toContain('min-[1100px]:w-[640px]');
    expect(window.localStorage.getItem(DOCK_WIDE_KEY)).toBe('wide');
  });

  it('counts new assistant messages since collapse, ignores designer lines, and clears on expand', () => {
    const { rerender } = render(dock({ events: [ev(1), ev(2, 'designer')] }));
    expect(screen.queryByTestId('chat-unread')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse chat' }));
    rerender(dock({ events: [ev(1), ev(2, 'designer'), ev(3), ev(4, 'assistant', 'tool_call'), ev(5)] }));
    expect(screen.getByTestId('chat-unread').textContent).toBe('2');
    expect(screen.getByTestId('chat-pill').getAttribute('aria-label')).toBe('Chat, 2 new');
    fireEvent.click(screen.getByTestId('chat-pill'));
    expect(screen.queryByTestId('chat-unread')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse chat' }));
    expect(screen.queryByTestId('chat-unread')).toBeNull();
  });

  it('shows a spinner on the pill while the worker is busy', () => {
    const { rerender } = render(dock({ busy: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Collapse chat' }));
    expect(screen.queryByTestId('chat-busy')).toBeNull();
    rerender(dock({ busy: true }));
    expect(screen.getByTestId('chat-busy')).toBeTruthy();
  });

  it('a new selection expands a collapsed panel', () => {
    const { rerender } = render(dock({ selectionCount: 0 }));
    fireEvent.click(screen.getByRole('button', { name: 'Collapse chat' }));
    rerender(dock({ selectionCount: 1 }));
    expect(screen.getByTestId('chat-dock').hidden).toBe(false);
  });

  it('still works when storage throws', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    render(dock());
    fireEvent.click(screen.getByRole('button', { name: 'Collapse chat' }));
    expect(screen.getByTestId('chat-dock').hidden).toBe(true);
  });

  it('assistantMessageStats', () => {
    expect(assistantMessageStats([ev(3), ev(7), ev(8, 'designer')], 3)).toEqual({ max: 7, unread: 1 });
  });
});
