import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as React from 'react';

const mutate = vi.fn();
const mockLearned = vi.fn();
vi.mock('@/lib/hooks/use-home-learned', () => ({
  useHomeLearned: () => mockLearned(),
  useHomeLearnedChange: () => ({ mutate, isPending: false }),
}));

import { LearnedCard } from '../LearnedCard';

beforeEach(() => vi.clearAllMocks());

describe('LearnedCard', () => {
  it('says nothing was learned yet when there are no lines', () => {
    mockLearned.mockReturnValue({ data: { on: true, items: [] }, isLoading: false, isError: false });
    render(<LearnedCard />);
    expect(screen.getByText('What the home screen learned')).toBeInTheDocument();
    expect(screen.getByText('Nothing learned yet. It needs a few weeks of your taps.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Put back' })).not.toBeInTheDocument();
  });

  it('lists a sentence per learned weight, each with Put back, and shows no number', () => {
    mockLearned.mockReturnValue({
      data: { on: true, items: [{ evidence_key: 'client:x', sentence: 'Nerd Herd work comes up a little sooner, since November 30', since: null }] },
      isLoading: false,
      isError: false,
    });
    const { container } = render(<LearnedCard />);
    expect(screen.getByText('Nerd Herd work comes up a little sooner, since November 30')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Put back' }));
    expect(mutate).toHaveBeenCalledWith({ action: 'put_back', evidence_key: 'client:x' });
    expect(container.textContent).not.toMatch(/%|percent|weight/i);
  });

  it('the Learn from my taps switch shows its state and sends the new one', () => {
    mockLearned.mockReturnValue({ data: { on: true, items: [] }, isLoading: false, isError: false });
    render(<LearnedCard />);
    const sw = screen.getByRole('switch', { name: /Learn from my taps/ });
    expect(sw).toBeChecked();
    fireEvent.click(sw);
    expect(mutate).toHaveBeenCalledWith({ action: 'learning', on: false });
  });

  it('shows nothing while loading or when the read fails', () => {
    mockLearned.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    const { container, rerender } = render(<LearnedCard />);
    expect(container).toBeEmptyDOMElement();
    mockLearned.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    rerender(<LearnedCard />);
    expect(container).toBeEmptyDOMElement();
  });
});
