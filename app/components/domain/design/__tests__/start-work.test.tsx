import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as React from 'react';
import { StartWork } from '../StartWork';

const sites = [{ id: 's1', name: 'vcdp.org' }, { id: 's2', name: 'other.org' }];

describe('StartWork', () => {
  it('starts with the chosen site, a trimmed title and optional detail', () => {
    const onStart = vi.fn();
    render(<StartWork sites={sites} onStart={onStart} />);
    const start = screen.getByRole('button', { name: 'Start' }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Site'), { target: { value: 's2' } });
    fireEvent.change(screen.getByLabelText('What needs doing'), { target: { value: '  Fix nav  ' } });
    expect(start.disabled).toBe(false);
    fireEvent.click(start);
    expect(onStart).toHaveBeenCalledWith({ site_id: 's2', title: 'Fix nav' });
    fireEvent.change(screen.getByLabelText('More detail (optional)'), { target: { value: 'wraps on mobile' } });
    fireEvent.click(start);
    expect(onStart).toHaveBeenLastCalledWith({ site_id: 's2', title: 'Fix nav', detail: 'wraps on mobile' });
  });

  it('caps the title at 120 and the detail at 2000 characters, and preselects a lone site', () => {
    render(<StartWork sites={[sites[0]]} onStart={vi.fn()} />);
    expect((screen.getByLabelText('What needs doing') as HTMLInputElement).maxLength).toBe(120);
    expect((screen.getByLabelText('More detail (optional)') as HTMLTextAreaElement).maxLength).toBe(2000);
    expect((screen.getByLabelText('Site') as HTMLSelectElement).value).toBe('s1');
  });

  it('shows the one-line hint only when prominent (empty drawer)', () => {
    const { rerender } = render(<StartWork sites={sites} prominent onStart={vi.fn()} />);
    expect(screen.getByText('Pick a site and describe what needs doing.')).toBeTruthy();
    rerender(<StartWork sites={sites} onStart={vi.fn()} />);
    expect(screen.queryByText('Pick a site and describe what needs doing.')).toBeNull();
  });

  it('says so when there is no site to start on', () => {
    render(<StartWork sites={[]} prominent onStart={vi.fn()} />);
    expect(screen.getByTestId('start-work-none')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull();
  });
});
