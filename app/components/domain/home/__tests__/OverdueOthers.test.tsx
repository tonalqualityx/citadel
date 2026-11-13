import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { OverdueOthers } from '../OverdueOthers';
import { buildTiles } from '../home-screen-logic';
import { overdueDaysLabel } from '@/lib/home/overdue-copy';
import { HOME_TILE_ORDER } from '@/lib/home/types';
import type { HomeOverdueOthers, HomeResponse } from '@/lib/home/types';

const rows: HomeOverdueOthers['rows'] = [
  { task_id: 't1', title: 'Write the about page', href: '/tasks/t1', who: 'Sabeen', who_id: 'u1', project_id: 'p1', project_name: 'Stronghold', due_date: '2026-11-08T12:00:00Z', days_overdue: 5 },
  { task_id: 't2', title: 'Fix the footer', href: '/tasks/t2', who: 'Lisa', who_id: 'u2', project_id: null, project_name: null, due_date: '2026-11-12T12:00:00Z', days_overdue: 1 },
];

describe('OverdueOthers', () => {
  it('lists who, the task as a link, the project and the days', () => {
    render(<OverdueOthers overdue={{ count: 2, rows }} emptyText="Nobody else is late on anything." />);
    const items = screen.getAllByTestId('overdue-row');
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText('Sabeen')).toBeTruthy();
    expect(within(items[0]).getByRole('link', { name: 'Write the about page' }).getAttribute('href')).toBe('/tasks/t1');
    expect(within(items[0]).getByText('Stronghold')).toBeTruthy();
    expect(within(items[0]).getByTestId('overdue-days').textContent).toBe('5 days overdue');
    expect(within(items[1]).getByText('No project')).toBeTruthy();
    expect(within(items[1]).getByTestId('overdue-days').textContent).toBe('1 day overdue');
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
  it('says so when nobody is late', () => {
    render(<OverdueOthers overdue={{ count: 0, rows: [] }} emptyText="Nobody else is late on anything." />);
    expect(screen.getByTestId('overdue-empty').textContent).toBe('Nobody else is late on anything.');
  });
  it('words the days', () => {
    expect(overdueDaysLabel(1)).toBe('1 day overdue');
    expect(overdueDaysLabel(12)).toBe('12 days overdue');
  });
});

describe('Overdue by others tile', () => {
  const res = (over: Partial<HomeResponse> = {}) =>
    ({
      today: null,
      sections: { needs_you_now: [], working_on: [], leads: [], mail: [], next: [], handled: [], handled_more: null },
      everything_else: { count: 0, line: '', groups: [], with_day: 0, past_day: 0, scope_line: null },
      triage: { count: 2, open_questions: 0, groups: [], cards: [] },
      ...over,
    }) as unknown as HomeResponse;

  it('comes straight after the Triage tile in the tile order', () => {
    const order = [...HOME_TILE_ORDER];
    expect(order.indexOf('overdue_others')).toBe(order.indexOf('triage') + 1);
    const ids = buildTiles(res({ overdue_others: { count: 3, rows: [] } }), 0).map((t) => t.id);
    expect(ids.indexOf('overdue_others')).toBe(ids.indexOf('triage') + 1);
  });
  it('shows the count, never hot, and is a zero tile at zero', () => {
    const t = buildTiles(res({ overdue_others: { count: 3, rows: [] } }), 0).find((x) => x.id === 'overdue_others');
    expect(t).toMatchObject({ value: '3', label: 'overdue by others', count: 3, hot: false });
    expect(buildTiles(res({ overdue_others: { count: 0, rows: [] } }), 0).find((x) => x.id === 'overdue_others')).toMatchObject({ value: '0', count: 0, hot: false });
  });
  it('is not there for anyone the server left it out for', () => {
    expect(buildTiles(res(), 0).some((t) => t.id === 'overdue_others')).toBe(false);
  });
});
