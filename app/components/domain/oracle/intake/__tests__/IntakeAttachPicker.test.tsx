import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IntakeAttachPicker } from '../IntakeAttachPicker';

const mockGet = vi.fn();
const mockPost = vi.fn();
vi.mock('@/lib/api/client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    patch: vi.fn(),
  },
}));

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockImplementation((url: string) => {
    if (url === '/arcs') {
      return Promise.resolve({ arcs: [{ id: 'arc-1', name: 'VCDP proposal' }], total: 1 });
    }
    if (url === '/tasks') {
      return Promise.resolve({ tasks: [{ id: 'task-1', title: 'Send invoice' }], total: 1 });
    }
    return Promise.resolve({});
  });
});

describe('IntakeAttachPicker (Clarity Phase 3 Reckoning, spec Q4/Q11)', () => {
  it('shows only the trigger until clicked (no fetch yet)', () => {
    renderWithClient(<IntakeAttachPicker askId="ask-1" />);

    expect(screen.getByTestId('intake-attach-trigger')).toBeInTheDocument();
    expect(screen.queryByTestId('intake-attach-picker')).not.toBeInTheDocument();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('click one reveals the search box with open arcs + open tasks', async () => {
    renderWithClient(<IntakeAttachPicker askId="ask-1" />);
    fireEvent.click(screen.getByTestId('intake-attach-trigger'));

    expect(await screen.findByText('VCDP proposal')).toBeInTheDocument();
    expect(await screen.findByText('Send invoice')).toBeInTheDocument();
  });

  it('click two (selecting an arc) POSTs the attach and closes the picker', async () => {
    mockPost.mockResolvedValue({ id: 'ask-1', state: 'handled' });
    renderWithClient(<IntakeAttachPicker askId="ask-1" />);
    fireEvent.click(screen.getByTestId('intake-attach-trigger'));

    const arcOption = await screen.findByText('VCDP proposal');
    fireEvent.click(arcOption);

    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith('/email-asks/ask-1/attach', { arc_id: 'arc-1' })
    );
    expect(screen.queryByTestId('intake-attach-picker')).not.toBeInTheDocument();
  });

  it('selecting a task POSTs task_id instead', async () => {
    mockPost.mockResolvedValue({ id: 'ask-1', state: 'handled' });
    renderWithClient(<IntakeAttachPicker askId="ask-1" />);
    fireEvent.click(screen.getByTestId('intake-attach-trigger'));

    const taskOption = await screen.findByText('Send invoice');
    fireEvent.click(taskOption);

    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith('/email-asks/ask-1/attach', { task_id: 'task-1' })
    );
  });

  it('typing filters the results', async () => {
    renderWithClient(<IntakeAttachPicker askId="ask-1" />);
    fireEvent.click(screen.getByTestId('intake-attach-trigger'));
    await screen.findByText('VCDP proposal');

    fireEvent.change(screen.getByTestId('intake-attach-search'), { target: { value: 'invoice' } });

    expect(screen.queryByText('VCDP proposal')).not.toBeInTheDocument();
    expect(screen.getByText('Send invoice')).toBeInTheDocument();
  });
});
