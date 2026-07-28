import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import * as React from 'react';

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// Mock hooks
const mockCreateMutateAsync = vi.fn();
const mockUpdateMutateAsync = vi.fn();

vi.mock('@/lib/hooks/use-tasks', () => ({
  useCreateTask: () => ({
    mutateAsync: mockCreateMutateAsync,
    isPending: false,
  }),
  useUpdateTask: () => ({
    mutateAsync: mockUpdateMutateAsync,
    isPending: false,
  }),
}));

vi.mock('@/lib/hooks/use-projects', () => ({
  useProjects: () => ({
    data: {
      projects: [
        { id: 'project-1', name: 'Test Project', client: { id: 'client-1', name: 'Test Client' } },
      ],
    },
    isLoading: false,
  }),
}));

vi.mock('@/lib/hooks/use-clients', () => ({
  useClients: () => ({
    data: {
      clients: [{ id: 'client-1', name: 'Test Client' }],
    },
    isLoading: false,
  }),
}));

vi.mock('@/lib/hooks/use-reference-data', () => ({
  useFunctions: () => ({
    data: {
      functions: [
        { id: 'func-design', name: 'Design' },
        { id: 'func-dev', name: 'Development' },
      ],
    },
    isLoading: false,
  }),
}));

const mockSops = [
  {
    id: 'sop-1',
    title: 'Homepage Redesign SOP',
    function: { id: 'func-design', name: 'Design' },
    tags: ['design'],
    template_requirements: [
      { id: 'req-1', text: 'Create wireframes', sort_order: 0 },
      { id: 'req-2', text: 'Design mockups', sort_order: 1 },
    ],
    setup_requirements: null,
    review_requirements: [
      { id: 'rev-1', text: 'Check brand consistency', sort_order: 0 },
    ],
    is_active: true,
    default_priority: 2,
    energy_estimate: 5,
    mystery_factor: 'significant',
    battery_impact: 'high_drain',
    estimated_minutes: 300,
    last_reviewed_at: null,
    next_review_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'sop-2',
    title: 'Bug Fix SOP',
    function: null,
    tags: ['dev'],
    template_requirements: [
      { id: 'req-3', text: 'Reproduce the bug', sort_order: 0 },
    ],
    setup_requirements: null,
    review_requirements: null,
    is_active: true,
    default_priority: 1,
    energy_estimate: 2,
    mystery_factor: 'no_idea',
    battery_impact: 'energizing',
    estimated_minutes: 60,
    last_reviewed_at: null,
    next_review_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
];

vi.mock('@/lib/hooks/use-sops', () => ({
  useSops: () => ({
    data: { sops: mockSops },
    isLoading: false,
  }),
}));

vi.mock('@/lib/hooks/use-terminology', () => ({
  useTerminology: () => ({
    t: (key: string) => {
      const terms: Record<string, string> = {
        task: 'Task',
        tasks: 'Tasks',
        project: 'Project',
      };
      return terms[key] || key;
    },
  }),
}));

// Import after mocks
import { TaskForm } from '../task-form';
import type { Task } from '@/lib/hooks/use-tasks';

describe('TaskForm', () => {
  const mockOnSuccess = vi.fn();
  const mockOnCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateMutateAsync.mockResolvedValue({ id: 'new-task-1', title: 'Test' });
  });

  describe('Basic task creation (no SOP)', () => {
    it('creates a task with form defaults when no SOP selected', async () => {
      render(<TaskForm onSuccess={mockOnSuccess} onCancel={mockOnCancel} />);

      const titleInput = screen.getByPlaceholderText('Task title');
      fireEvent.change(titleInput, { target: { value: 'Simple Task' } });

      fireEvent.click(screen.getByTestId('commitment-internal'));
      const submitButton = screen.getByRole('button', { name: /create task/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(mockCreateMutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Simple Task',
            sop_id: null,
            priority: 3,
            energy_estimate: 1,
            mystery_factor: 'average',
            battery_impact: 'average_drain',
            promised_to: null,
          })
        );
      });
    });
  });

  describe('Commitment discriminator (Clarity Phase 8)', () => {
    it('does not submit a new task when no commitment is chosen', async () => {
      render(<TaskForm onSuccess={mockOnSuccess} onCancel={mockOnCancel} />);

      fireEvent.change(screen.getByPlaceholderText('Task title'), { target: { value: 'No commitment' } });
      fireEvent.click(screen.getByRole('button', { name: /create task/i }));

      expect(mockCreateMutateAsync).not.toHaveBeenCalled();
    });

    it('does not submit when Promised is chosen but no name is given', async () => {
      render(<TaskForm onSuccess={mockOnSuccess} onCancel={mockOnCancel} />);

      fireEvent.change(screen.getByPlaceholderText('Task title'), { target: { value: 'Promised, no name' } });
      fireEvent.click(screen.getByTestId('commitment-promised'));
      fireEvent.click(screen.getByRole('button', { name: /create task/i }));

      expect(mockCreateMutateAsync).not.toHaveBeenCalled();
    });

    it('submits promised_to when Promised is chosen with a name', async () => {
      render(<TaskForm onSuccess={mockOnSuccess} onCancel={mockOnCancel} />);

      fireEvent.change(screen.getByPlaceholderText('Task title'), { target: { value: 'Promised task' } });
      fireEvent.click(screen.getByTestId('commitment-promised'));
      fireEvent.change(screen.getByTestId('promised-to-input'), { target: { value: 'Dan Cotter' } });
      fireEvent.click(screen.getByRole('button', { name: /create task/i }));

      await waitFor(() => {
        expect(mockCreateMutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({ promised_to: 'Dan Cotter' })
        );
      });
    });

    it('prefills Promised + the name when editing a task that already has promised_to', () => {
      const existingTask = {
        id: 'task-existing',
        title: 'Existing Task',
        status: 'in_progress' as const,
        priority: 2,
        promised_to: 'Ricson & Hannah',
        energy_estimate: 5,
        mystery_factor: 'significant',
        battery_impact: 'high_drain',
      };

      render(
        <TaskForm task={existingTask as unknown as Task} onSuccess={mockOnSuccess} onCancel={mockOnCancel} />
      );

      expect(screen.getByTestId('commitment-promised')).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByTestId('promised-to-input')).toHaveValue('Ricson & Hannah');
    });

    it('never blocks saving an existing task even without re-touching the commitment fields', async () => {
      const existingTask = {
        id: 'task-existing',
        title: 'Existing Task',
        status: 'in_progress' as const,
        priority: 2,
      };

      render(
        <TaskForm task={existingTask as unknown as Task} onSuccess={mockOnSuccess} onCancel={mockOnCancel} />
      );

      fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

      await waitFor(() => {
        expect(mockUpdateMutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({
            id: 'task-existing',
            data: expect.objectContaining({ promised_to: null }),
          })
        );
      });
    });
  });

  describe('SOP selection populates form fields', () => {
    it('updates energy, priority, mystery, battery, and function when SOP is selected', async () => {
      render(<TaskForm onSuccess={mockOnSuccess} onCancel={mockOnCancel} />);

      // Open the SOP search
      const sopInput = screen.getByPlaceholderText('Search SOPs...');
      fireEvent.focus(sopInput);

      // Wait for dropdown to appear and click the SOP
      await waitFor(() => {
        expect(screen.getByText('Homepage Redesign SOP')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Homepage Redesign SOP'));

      // Fill in required title
      const titleInput = screen.getByPlaceholderText('Task title');
      fireEvent.change(titleInput, { target: { value: 'Task from SOP' } });

      // Submit the form
      fireEvent.click(screen.getByTestId('commitment-internal'));
      const submitButton = screen.getByRole('button', { name: /create task/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(mockCreateMutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Task from SOP',
            sop_id: 'sop-1',
            priority: 2,              // from SOP (was default 3)
            energy_estimate: 5,        // from SOP (was default 1)
            mystery_factor: 'significant', // from SOP (was default 'average')
            battery_impact: 'high_drain',  // from SOP (was default 'average_drain')
            function_id: 'func-design',    // from SOP (was default null)
          })
        );
      });
    });

    it('applies second SOP defaults when SOP with different values is selected', async () => {
      render(<TaskForm onSuccess={mockOnSuccess} onCancel={mockOnCancel} />);

      const sopInput = screen.getByPlaceholderText('Search SOPs...');
      fireEvent.focus(sopInput);

      await waitFor(() => {
        expect(screen.getByText('Bug Fix SOP')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Bug Fix SOP'));

      const titleInput = screen.getByPlaceholderText('Task title');
      fireEvent.change(titleInput, { target: { value: 'Bug fix task' } });

      fireEvent.click(screen.getByTestId('commitment-internal'));
      const submitButton = screen.getByRole('button', { name: /create task/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(mockCreateMutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({
            sop_id: 'sop-2',
            priority: 1,
            energy_estimate: 2,
            mystery_factor: 'no_idea',
            battery_impact: 'energizing',
            function_id: null, // Bug Fix SOP has no function
          })
        );
      });
    });

    it('shows SOP preview after selection', async () => {
      render(<TaskForm onSuccess={mockOnSuccess} onCancel={mockOnCancel} />);

      const sopInput = screen.getByPlaceholderText('Search SOPs...');
      fireEvent.focus(sopInput);

      await waitFor(() => {
        expect(screen.getByText('Homepage Redesign SOP')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Homepage Redesign SOP'));

      // SOP preview should be visible
      await waitFor(() => {
        expect(screen.getByText('SOP Defaults (Applied to Task)')).toBeInTheDocument();
      });
    });
  });

  describe('User can override SOP defaults', () => {
    it('submits user-modified values instead of SOP defaults', async () => {
      render(<TaskForm onSuccess={mockOnSuccess} onCancel={mockOnCancel} />);

      // Select SOP first
      const sopInput = screen.getByPlaceholderText('Search SOPs...');
      fireEvent.focus(sopInput);

      await waitFor(() => {
        expect(screen.getByText('Homepage Redesign SOP')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Homepage Redesign SOP'));

      // Override energy estimate — find the Energy Estimate select by label
      // The SOP set energy to 5, but user changes it to 3
      const energySelect = screen.getByLabelText('Energy Estimate');
      fireEvent.change(energySelect, { target: { value: '3' } });

      const titleInput = screen.getByPlaceholderText('Task title');
      fireEvent.change(titleInput, { target: { value: 'Overridden task' } });

      fireEvent.click(screen.getByTestId('commitment-internal'));
      const submitButton = screen.getByRole('button', { name: /create task/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(mockCreateMutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({
            sop_id: 'sop-1',
            energy_estimate: 3, // User override, not SOP's 5
            // Other SOP defaults still applied
            priority: 2,
            mystery_factor: 'significant',
            battery_impact: 'high_drain',
          })
        );
      });
    });
  });

  describe('SOP search functionality', () => {
    it('filters SOPs by search term', async () => {
      render(<TaskForm onSuccess={mockOnSuccess} onCancel={mockOnCancel} />);

      const sopInput = screen.getByPlaceholderText('Search SOPs...');
      fireEvent.change(sopInput, { target: { value: 'Bug' } });

      await waitFor(() => {
        expect(screen.getByText('Bug Fix SOP')).toBeInTheDocument();
      });
    });

    it('allows clearing SOP selection', async () => {
      render(<TaskForm onSuccess={mockOnSuccess} onCancel={mockOnCancel} />);

      // Select SOP
      const sopInput = screen.getByPlaceholderText('Search SOPs...');
      fireEvent.focus(sopInput);

      await waitFor(() => {
        expect(screen.getByText('Homepage Redesign SOP')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Homepage Redesign SOP'));

      // SOP should be selected (shown as display, not input)
      await waitFor(() => {
        expect(screen.getByText('Homepage Redesign SOP')).toBeInTheDocument();
      });

      // Clear it
      const clearButton = screen.getByText('✕');
      fireEvent.click(clearButton);

      // Search input should be back
      await waitFor(() => {
        expect(screen.getByPlaceholderText('Search SOPs...')).toBeInTheDocument();
      });
    });
  });

  describe('Edit mode with existing SOP', () => {
    it('preserves existing SOP when editing a task', async () => {
      const existingTask = {
        id: 'task-existing',
        title: 'Existing Task',
        description: null,
        status: 'in_progress' as const,
        priority: 2,
        is_focus: false,
        project_id: null,
        client_id: null,
        site_id: null,
        phase_id: null,
        phase: null,
        sort_order: 0,
        assignee_id: null,
        reviewer_id: null,
        approved: false,
        function_id: 'func-design',
        sop_id: 'sop-1',
        requirements: null,
        review_requirements: null,
        needs_review: true,
        energy_estimate: 5,
        mystery_factor: 'significant',
        battery_impact: 'high_drain',
        estimated_minutes: 300,
        due_date: null,
        started_at: null,
        notes: null,
        is_billable: true,
        billing_target: null,
        billing_amount: null,
        is_retainer_work: false,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      };

      render(
        <TaskForm
          task={existingTask as any}
          onSuccess={mockOnSuccess}
          onCancel={mockOnCancel}
        />
      );

      const submitButton = screen.getByRole('button', { name: /save changes/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(mockUpdateMutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({
            id: 'task-existing',
            data: expect.objectContaining({
              sop_id: 'sop-1',
              energy_estimate: 5,
              mystery_factor: 'significant',
              battery_impact: 'high_drain',
              priority: 2,
            }),
          })
        );
      });
    });
  });
});
