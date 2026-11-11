import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HandledMailList } from '../HandledMailList';

const ASK = 'ask:7aa4a01a-1111-4222-8333-944445555666';

describe('HandledMailList', () => {
  it('shows each mail with its reason and a link, and Undo hands back its key', () => {
    const onReopen = vi.fn();
    render(<HandledMailList rows={[{ key: ASK, title: 'Ken Duffy: Appreciate it Mike', reason: 'A thank-you.', href: 'https://mail.google.com/x', at: '2026-11-09T14:00:00Z' }]} onReopen={onReopen} />);
    expect(screen.getByText('Ken Duffy: Appreciate it Mike')).toBeTruthy();
    expect(screen.getByText(/A thank-you\./)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open the email' }).getAttribute('href')).toBe('https://mail.google.com/x');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onReopen).toHaveBeenCalledWith(ASK);
  });

  it('a row with no link shows no link', () => {
    render(<HandledMailList rows={[{ key: ASK, title: 'T', reason: 'R.', href: null, at: '2026-11-09T14:00:00Z' }]} onReopen={() => undefined} />);
    expect(screen.queryByRole('link')).toBeNull();
  });
});
