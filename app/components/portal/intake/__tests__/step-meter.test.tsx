import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { StepMeter } from '../step-meter';

describe('StepMeter', () => {
  it('says which step and which question the person is on', () => {
    render(<StepMeter stage={2} question={2} />);
    expect(screen.getByText('Step 3 of 4: details, question 2 of 3.')).toBeInTheDocument();
    const items = screen.getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual(['What you need', 'Which site', 'Details', 'Check and send']);
    expect(items[2]).toHaveAttribute('aria-current', 'step');
    expect(items[0]).toHaveClass('done');
    expect(items[1]).toHaveClass('done');
    expect(items[3]).not.toHaveClass('done');
  });

  it('uses the real question count when a request has fewer questions', () => {
    render(<StepMeter stage={2} question={1} total={2} />);
    expect(screen.getByText('Step 3 of 4: details, question 1 of 2.')).toBeInTheDocument();
  });

  it('names the first, second and last steps', () => {
    const { rerender } = render(<StepMeter stage={0} />);
    expect(screen.getByText('Step 1 of 4.')).toBeInTheDocument();
    rerender(<StepMeter stage={1} />);
    expect(screen.getByText('Step 2 of 4.')).toBeInTheDocument();
    rerender(<StepMeter stage={3} />);
    expect(screen.getByText('Step 4 of 4: check your request and send it.')).toBeInTheDocument();
  });

  it('marks every segment done once sent', () => {
    render(<StepMeter stage={3} sent />);
    expect(screen.getByText('Sent. All four steps done.')).toBeInTheDocument();
    for (const li of screen.getAllByRole('listitem')) {
      expect(li).toHaveClass('done');
      expect(li).not.toHaveAttribute('aria-current');
    }
  });
});
