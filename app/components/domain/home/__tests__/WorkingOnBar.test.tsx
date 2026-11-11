import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { WorkingOnBar } from '../WorkingOnBar';
import type { HomeItem } from '@/lib/home/types';

const item = { key: 'task:1', title: 'Call the printer', who: 'Grok', age: '2 days', hard_date: null } as unknown as HomeItem;

function setVisibility(state: 'hidden' | 'visible') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

function away(minutes: number) {
  act(() => setVisibility('hidden'));
  act(() => {
    vi.advanceTimersByTime(minutes * 60_000);
  });
  act(() => setVisibility('visible'));
}

describe('WorkingOnBar away prompt', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-10T12:00:00Z'));
  });
  afterEach(() => {
    setVisibility('visible');
    vi.useRealTimers();
  });

  it('shows the normal bar before any absence', () => {
    render(<WorkingOnBar item={item} collapsedLine={null} onDone={() => {}} onStop={() => {}} />);
    expect(screen.getByText('Working on')).toBeInTheDocument();
    expect(screen.queryByText('You were on this.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Still on it' })).not.toBeInTheDocument();
  });

  it('19 minutes away: no prompt', () => {
    render(<WorkingOnBar item={item} collapsedLine={null} onDone={() => {}} onStop={() => {}} />);
    away(19);
    expect(screen.queryByText('You were on this.')).not.toBeInTheDocument();
  });

  it('20 minutes away: prompt with the three buttons; Still on it only closes it', () => {
    const onDone = vi.fn();
    const onStop = vi.fn();
    render(<WorkingOnBar item={item} collapsedLine={null} onDone={onDone} onStop={onStop} />);
    away(20);
    expect(screen.getByText('You were on this.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop for now' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Still on it' }));
    expect(screen.queryByText('You were on this.')).not.toBeInTheDocument();
    expect(screen.getByText('Working on')).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
    expect(onStop).not.toHaveBeenCalled();
  });

  it('Done from the prompt calls onDone', () => {
    const onDone = vi.fn();
    render(<WorkingOnBar item={item} collapsedLine={null} onDone={onDone} onStop={() => {}} />);
    away(25);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('Stop for now from the prompt asks where it was left, then calls onStop', () => {
    const onStop = vi.fn();
    render(<WorkingOnBar item={item} collapsedLine={null} onDone={() => {}} onStop={onStop} />);
    away(25);
    fireEvent.click(screen.getByRole('button', { name: 'Stop for now' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'waiting on proof' } });
    fireEvent.click(screen.getByRole('button', { name: 'Stop for now' }));
    expect(onStop).toHaveBeenCalledWith('waiting on proof');
  });
});
