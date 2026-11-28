import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { HealthStrip } from '../HealthStrip';
import type { HealthTile, HomeHealth } from '@/lib/home/health/types';

const tile = (over: Partial<HealthTile>): HealthTile => ({
  id: 'sales',
  label: 'Sales',
  figure: '2 out',
  line: '1 signed this month',
  state: 'normal',
  state_label: 'Normal',
  usual: 'Usual 2',
  fresh: 'Live',
  detail: [],
  href: '/deals',
  href_label: 'Open deals',
  ...over,
});

const HEALTH: HomeHealth = {
  summary: 'Five of six are normal. One needs a look.',
  generated_at: '2026-11-28T15:00:00.000Z',
  tiles: [
    tile({ id: 'ready_to_invoice', label: 'Ready to invoice', figure: '$4,200', line: '9 clients', usual: 'Usual $3,900', href: '/billing', href_label: 'Open billing' }),
    tile({
      id: 'owed_to_us',
      label: 'Owed to us',
      figure: '$4,925',
      line: '3 invoices late',
      state: 'look',
      state_label: 'Look at this',
      usual: 'Usual $2,100',
      fresh: 'Copied 10:07 AM',
      detail: ['Acme: $3,000, 2 invoices', '77 invoices more than 90 days late are left out.'],
      href: '/billing',
      href_label: 'Open billing',
    }),
    tile({}),
    tile({ id: 'projects', label: 'Projects', figure: '21 · 7', line: 'moving · stuck', href: '/projects', href_label: 'Open projects' }),
    tile({ id: 'clients', label: 'Clients', figure: 'All up', line: 'No mail over a day', href: '/sites', href_label: 'Open sites' }),
    tile({ id: 'agents', label: 'Agents', figure: '41', line: 'cards this week', href: null, href_label: null }),
  ],
};

describe('HealthStrip', () => {
  it('shows six tiles in one row, each with its number, line, state word, usual and freshness', () => {
    render(<HealthStrip health={HEALTH} />);
    expect(screen.getByText('Five of six are normal. One needs a look.')).toBeInTheDocument();
    const row = screen.getByTestId('health-strip').querySelector('ul.home-health-row')!;
    const tiles = within(row as HTMLElement).getAllByRole('button');
    expect(tiles).toHaveLength(6);
    const owed = screen.getByTestId('health-tile-owed_to_us');
    expect(owed).toHaveAttribute('data-state', 'look');
    expect(within(owed).getByText('$4,925')).toBeInTheDocument();
    expect(within(owed).getByText('3 invoices late')).toBeInTheDocument();
    expect(within(owed).getByText('Look at this')).toBeInTheDocument();
    expect(within(owed).getByText('Usual $2,100')).toBeInTheDocument();
    expect(within(owed).getByText('Copied 10:07 AM')).toBeInTheDocument();
    expect(within(screen.getByTestId('health-tile-sales')).getByText('Live')).toBeInTheDocument();
  });

  it('opens a tile in the side panel with its detail and its link', () => {
    render(<HealthStrip health={HEALTH} />);
    fireEvent.click(screen.getByTestId('health-tile-owed_to_us'));
    const detail = screen.getByTestId('health-detail');
    expect(within(detail).getByText('Acme: $3,000, 2 invoices')).toBeInTheDocument();
    expect(within(detail).getByText('77 invoices more than 90 days late are left out.')).toBeInTheDocument();
    expect(within(detail).getByRole('link', { name: 'Open billing' })).toHaveAttribute('href', '/billing');
  });

  it('renders nothing when the payload has no health (anyone but the owner)', () => {
    const { container } = render(<HealthStrip health={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});
