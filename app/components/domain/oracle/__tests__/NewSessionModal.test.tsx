import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as React from 'react';
import type { OracleMachineDTO } from '@/lib/types/oracle';

// Mock the mutation hook directly rather than react-query — NewSessionModal only
// touches @/lib/hooks/use-oracle, and this keeps the test focused on the modal's
// own validation/submit logic rather than TanStack Query plumbing (already covered
// by other hook tests in this codebase).
const mockMutate = vi.fn();
const mockReset = vi.fn();
let mockMutationState: { isPending: boolean; isError: boolean; error: Error | null } = {
  isPending: false,
  isError: false,
  error: null,
};

vi.mock('@/lib/hooks/use-oracle', () => ({
  useCreateOracleCommand: () => ({
    mutate: mockMutate,
    reset: mockReset,
    ...mockMutationState,
  }),
}));

import { NewSessionModal } from '../NewSessionModal';

function makeMachine(overrides: Partial<OracleMachineDTO> = {}): OracleMachineDTO {
  return {
    id: 'machine-1',
    name: 'Bast',
    hostname: 'bast.local',
    last_heartbeat_at: null,
    stale: false,
    sessions: [],
    commands: [],
    ...overrides,
  };
}

describe('NewSessionModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMutationState = { isPending: false, isError: false, error: null };
  });

  it('blocks submit and shows an inline error when cwd is empty (required field)', () => {
    render(<NewSessionModal open onOpenChange={vi.fn()} machines={[makeMachine()]} />);

    fireEvent.click(screen.getByRole('button', { name: /queue session/i }));

    expect(mockMutate).not.toHaveBeenCalled();
    expect(screen.getByText('Working directory is required')).toBeInTheDocument();
  });

  it('preselects the machine when exactly one is available and submits the trimmed cwd', () => {
    render(<NewSessionModal open onOpenChange={vi.fn()} machines={[makeMachine({ name: 'Bast' })]} />);

    const cwdInput = screen.getByLabelText('Working directory');
    fireEvent.change(cwdInput, { target: { value: '  /home/mike/project  ' } });
    fireEvent.click(screen.getByRole('button', { name: /queue session/i }));

    expect(mockMutate).toHaveBeenCalledWith(
      {
        machine: 'Bast',
        verb: 'spawn_session',
        payload: { cwd: '/home/mike/project' },
      },
      expect.any(Object)
    );
  });

  it('includes title/prompt in the payload only when provided', () => {
    render(<NewSessionModal open onOpenChange={vi.fn()} machines={[makeMachine({ name: 'Bast' })]} />);

    fireEvent.change(screen.getByLabelText('Working directory'), {
      target: { value: '/home/mike/project' },
    });
    fireEvent.change(screen.getByLabelText('Title (optional)'), {
      target: { value: 'Quick fix' },
    });
    fireEvent.click(screen.getByRole('button', { name: /queue session/i }));

    expect(mockMutate).toHaveBeenCalledWith(
      {
        machine: 'Bast',
        verb: 'spawn_session',
        payload: { cwd: '/home/mike/project', title: 'Quick fix' },
      },
      expect.any(Object)
    );
  });

  it('does not preselect a machine when there is more than one, and requires a pick', () => {
    render(
      <NewSessionModal
        open
        onOpenChange={vi.fn()}
        machines={[makeMachine({ id: 'm1', name: 'Bast' }), makeMachine({ id: 'm2', name: 'Other' })]}
      />
    );

    fireEvent.change(screen.getByLabelText('Working directory'), {
      target: { value: '/home/mike/project' },
    });
    fireEvent.click(screen.getByRole('button', { name: /queue session/i }));

    expect(mockMutate).not.toHaveBeenCalled();
    expect(screen.getByText('Pick a machine')).toBeInTheDocument();
  });

  it('surfaces a mutation error (e.g. a 403/400 from the server) inline', () => {
    mockMutationState = { isPending: false, isError: true, error: new Error('Machine not found') };
    render(<NewSessionModal open onOpenChange={vi.fn()} machines={[makeMachine()]} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Machine not found');
  });
});
