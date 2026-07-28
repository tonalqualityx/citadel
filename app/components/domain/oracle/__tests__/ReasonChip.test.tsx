import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { ReasonChip } from '../ReasonChip';

describe('ReasonChip', () => {
  it('renders the label and exposes the variant via data-variant', () => {
    render(<ReasonChip chip={{ variant: 'promised', label: 'promised: due today' }} />);
    const chip = screen.getByTestId('reason-chip');
    expect(chip).toHaveTextContent('promised: due today');
    expect(chip).toHaveAttribute('data-variant', 'promised');
  });

  it.each(['progress', 'promised', 'target', 'picked'] as const)(
    'renders the %s variant without throwing',
    (variant) => {
      render(<ReasonChip chip={{ variant, label: 'x' }} />);
      expect(screen.getByTestId('reason-chip')).toBeInTheDocument();
    }
  );

  it('target and picked share the same quiet, non-error styling (never red)', () => {
    const { container: targetContainer } = render(<ReasonChip chip={{ variant: 'target', label: 'target: this week' }} />);
    const { container: pickedContainer } = render(<ReasonChip chip={{ variant: 'picked', label: 'picked this morning' }} />);
    const targetClasses = targetContainer.querySelector('[data-testid="reason-chip"]')?.className ?? '';
    const pickedClasses = pickedContainer.querySelector('[data-testid="reason-chip"]')?.className ?? '';
    expect(targetClasses).toBe(pickedClasses);
    expect(targetClasses).not.toMatch(/error|red/i);
  });
});
