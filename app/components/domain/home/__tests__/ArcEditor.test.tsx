import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import type { HomeItem } from '@/lib/home/types';
import { ArcEditor } from '../ArcEditor';

function item(key: string, title: string): HomeItem {
  return { key, title, who: null, effort: 'About 10 minutes', age: '3 days', hard_date: null, client: null, project: null } as HomeItem;
}
const steps = [item('task:a', 'Step A'), item('task:b', 'Step B'), item('task:c', 'Step C')];

function setup(extra: Partial<React.ComponentProps<typeof ArcEditor>> = {}) {
  const props = {
    groupKey: 'arc:1',
    steps,
    addedKeys: [],
    selectedKey: 'task:a',
    onSelect: vi.fn(),
    onReorder: vi.fn(),
    onRemove: vi.fn(),
    ...extra,
  };
  render(<ArcEditor {...props} />);
  return props;
}

describe('ArcEditor', () => {
  it('lists the steps in order and marks the selected one', () => {
    setup();
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText('Step A').closest('button')).toHaveAttribute('aria-current', 'true');
    expect(within(rows[1]).getByText('Step B').closest('button')).toHaveAttribute('aria-current', 'false');
  });

  it('selects a step on click', async () => {
    const props = setup();
    await userEvent.click(screen.getByText('Step B'));
    expect(props.onSelect).toHaveBeenCalledWith(steps[1]);
  });

  it('removes a step in two taps: More, then Remove from arc', async () => {
    const props = setup();
    expect(screen.queryByText('Remove from arc')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'More for: Step B' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove from arc' }));
    expect(props.onRemove).toHaveBeenCalledWith('task:b');
  });

  it('reorders with Move down and shows the new order at once', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: 'More for: Step A' }));
    await userEvent.click(screen.getByRole('button', { name: 'Move down' }));
    expect(props.onReorder).toHaveBeenCalledWith(['task:b', 'task:a', 'task:c']);
    const titles = screen.getAllByRole('listitem').map((li) => li.querySelector('strong')?.textContent);
    expect(titles).toEqual(['Step B', 'Step A', 'Step C']);
  });

  it('disables Move up on the first step and Move down on the last', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'More for: Step A' }));
    expect(screen.getByRole('button', { name: 'Move up' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'More for: Step C' }));
    expect(screen.getAllByRole('button', { name: 'Move down' }).at(-1)).toBeDisabled();
  });

  it('has a keyboard-focusable grip handle for each step', () => {
    setup();
    const grips = screen.getAllByRole('button', { name: /^Reorder:/ });
    expect(grips).toHaveLength(3);
    grips[0].focus();
    expect(grips[0]).toHaveFocus();
  });

  it('renders nothing for no steps', () => {
    const { container } = render(
      <ArcEditor groupKey="g" steps={[]} addedKeys={[]} selectedKey={null} onSelect={() => undefined} onReorder={() => undefined} onRemove={() => undefined} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
