import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TileStrip } from '../TileStrip';
import type { HomeTile } from '@/lib/home/types';

const tiles: HomeTile[] = [
  { id: 'today', value: 'Today: Grok of the Rock', label: '3 quick, then 4 steps', count: 7, hot: false },
  { id: 'needs_you_now', value: '2', label: 'need you now', count: 2, hot: true },
  { id: 'leads', value: '0', label: 'sales leads waiting', count: 0, hot: false },
];

describe('TileStrip', () => {
  it('renders real buttons with aria-pressed on the selected one', () => {
    render(<TileStrip tiles={tiles} selected="today" onSelect={() => {}} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(3);
    expect(buttons.every((b) => b.tagName === 'BUTTON' && b.getAttribute('type') === 'button')).toBe(true);
    expect(buttons[0]).toHaveAttribute('aria-pressed', 'true');
    expect(buttons[1]).toHaveAttribute('aria-pressed', 'false');
  });
  it('marks hot and zero tiles, never today as zero', () => {
    render(<TileStrip tiles={tiles} selected="today" onSelect={() => {}} />);
    const [today, now, leads] = screen.getAllByRole('button');
    expect(now).toHaveAttribute('data-hot', 'true');
    expect(leads).toHaveAttribute('data-zero', 'true');
    expect(today).not.toHaveAttribute('data-zero');
    expect(today).toHaveAttribute('data-today', 'true');
  });
  it('calls onSelect with the tile id', () => {
    const onSelect = vi.fn();
    render(<TileStrip tiles={tiles} selected="today" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: /need you now/ }));
    expect(onSelect).toHaveBeenCalledWith('needs_you_now');
  });
  it('is a labelled group', () => {
    render(<TileStrip tiles={tiles} selected="today" onSelect={() => {}} />);
    expect(screen.getByRole('group', { name: 'What needs you' })).toBeInTheDocument();
  });
});
