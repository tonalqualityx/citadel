import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PipelineLane } from '../PipelineLane';

const mockGet = vi.fn();
vi.mock('@/lib/api/client', () => ({
  apiClient: { get: (...args: unknown[]) => mockGet(...args), post: vi.fn(), patch: vi.fn() },
}));

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PipelineLane (Clarity Phase 3 Reckoning, spec Q1)', () => {
  it('renders nothing when every group is empty', async () => {
    mockGet.mockResolvedValue({ groups: { prospect: [], in_motion: [], closed: [] } });
    const { container } = renderWithClient(<PipelineLane />);

    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });

  it('renders each accord row with its open arc link', async () => {
    mockGet.mockResolvedValue({
      groups: {
        prospect: [
          {
            id: 'accord-1',
            name: 'Acme deal',
            status: 'lead',
            lead_name: 'Jane',
            lead_business_name: 'Acme Co',
            client: null,
            open_arc: { id: 'arc-1', name: 'Report arc' },
          },
        ],
        in_motion: [],
        closed: [],
      },
    });
    renderWithClient(<PipelineLane />);

    expect(await screen.findByText('Acme Co')).toBeInTheDocument();
    const link = await screen.findByTestId('pipeline-row-arc-link');
    expect(link).toHaveTextContent('Report arc');
    expect(link).toHaveAttribute('href', '/oracle/arcs/arc-1');
  });

  it('shows a quiet "no active arc" marker when nothing is moving the accord forward', async () => {
    mockGet.mockResolvedValue({
      groups: {
        prospect: [
          {
            id: 'accord-2',
            name: 'Stalled deal',
            status: 'lead',
            lead_name: null,
            lead_business_name: null,
            client: null,
            open_arc: null,
          },
        ],
        in_motion: [],
        closed: [],
      },
    });
    renderWithClient(<PipelineLane />);

    expect(await screen.findByTestId('pipeline-row-no-arc')).toHaveTextContent('no active arc');
  });

  it('Closed group is collapsed by default; Prospect/In motion are open', async () => {
    mockGet.mockResolvedValue({
      groups: {
        prospect: [
          { id: 'a1', name: 'A', status: 'lead', lead_name: null, lead_business_name: null, client: null, open_arc: null },
        ],
        in_motion: [],
        closed: [
          { id: 'a2', name: 'B', status: 'signed', lead_name: null, lead_business_name: null, client: null, open_arc: null },
        ],
      },
    });
    renderWithClient(<PipelineLane />);

    await screen.findByText('A');
    expect(screen.queryByText('B')).not.toBeInTheDocument();
  });
});
