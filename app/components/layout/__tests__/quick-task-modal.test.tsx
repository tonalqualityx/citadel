import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import * as React from 'react';
import { addBusinessDays, formatDateForInput } from '@/lib/utils/time';

// Mock next/navigation
const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

// Mock the hooks
const mockMutateAsync = vi.fn();

vi.mock('@/lib/hooks/use-tasks', () => ({
  useCreateTask: () => ({
    mutateAsync: mockMutateAsync,
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
      clients: [
        { id: 'client-1', name: 'Test Client' },
      ],
    },
    isLoading: false,
  }),
}));

vi.mock('@/lib/hooks/use-sites', () => ({
  useSites: () => ({
    data: { sites: [] },
    isLoading: false,
  }),
}));

vi.mock('@/lib/hooks/use-sops', () => ({
  useSops: () => ({
    data: { sops: [] },
    isLoading: false,
  }),
}));

vi.mock('@/lib/hooks/use-users', () => ({
  useUsers: () => ({
    data: {
      users: [
        { id: 'user-1', name: 'Test User', email: 'test@example.com' },
      ],
    },
    isLoading: false,
  }),
}));

vi.mock('@/lib/hooks/use-terminology', () => ({
  useTerminology: () => ({
    t: (key: string) => {
      const terms: Record<string, string> = {
        task: 'Task',
        tasks: 'Tasks',
        newTask: 'New Task',
        project: 'Project',
        client: 'Client',
      };
      return terms[key] || key;
    },
  }),
}));

vi.mock('@/lib/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { id: 'user-1', role: 'pm' },
  }),
}));

// Import after mocks
import { QuickTaskModal } from '../quick-task-modal';

describe('QuickTaskModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMutateAsync.mockResolvedValue({ id: 'new-task-123', title: 'Test Task' });
  });

  describe('Modal open/close', () => {
    it('renders the trigger button', () => {
      render(<QuickTaskModal />);

      const button = screen.getByRole('button', { name: /new task/i });
      expect(button).toBeInTheDocument();
    });

    it('opens modal when trigger button is clicked', async () => {
      render(<QuickTaskModal />);

      const button = screen.getByRole('button', { name: /new task/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Quick Create Task')).toBeInTheDocument();
      });
    });

    it('closes modal when cancel is clicked', async () => {
      render(<QuickTaskModal />);

      // Open modal
      const button = screen.getByRole('button', { name: /new task/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Quick Create Task')).toBeInTheDocument();
      });

      // Click cancel
      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      fireEvent.click(cancelButton);

      await waitFor(() => {
        expect(screen.queryByText('Quick Create Task')).not.toBeInTheDocument();
      });
    });
  });

  describe('Task creation', () => {
    it('creates task with only title provided', async () => {
      render(<QuickTaskModal />);

      // Open modal
      const button = screen.getByRole('button', { name: /new task/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Quick Create Task')).toBeInTheDocument();
      });

      // Fill in title
      const titleInput = screen.getByPlaceholderText('Task title');
      fireEvent.change(titleInput, { target: { value: 'Test Task Title' } });

      // Click Create button
      const createButton = screen.getByRole('button', { name: /^create$/i });
      fireEvent.click(createButton);

      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Test Task Title',
            priority: 3, // Default priority
            status: 'not_started',
          })
        );
      });
    });

    it('creates task and navigates when Create & Open is clicked', async () => {
      render(<QuickTaskModal />);

      // Open modal
      const button = screen.getByRole('button', { name: /new task/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Quick Create Task')).toBeInTheDocument();
      });

      // Fill in title
      const titleInput = screen.getByPlaceholderText('Task title');
      fireEvent.change(titleInput, { target: { value: 'Test Task' } });

      // Click Create & Open button
      const createOpenButton = screen.getByRole('button', { name: /create & open/i });
      fireEvent.click(createOpenButton);

      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalled();
        expect(mockPush).toHaveBeenCalledWith('/tasks/new-task-123');
      });
    });

    it('closes modal after successful creation', async () => {
      render(<QuickTaskModal />);

      // Open modal
      const button = screen.getByRole('button', { name: /new task/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Quick Create Task')).toBeInTheDocument();
      });

      // Fill in title
      const titleInput = screen.getByPlaceholderText('Task title');
      fireEvent.change(titleInput, { target: { value: 'Test Task' } });

      // Click Create button
      const createButton = screen.getByRole('button', { name: /^create$/i });
      fireEvent.click(createButton);

      await waitFor(() => {
        expect(screen.queryByText('Quick Create Task')).not.toBeInTheDocument();
      });
    });

    it('resets form after successful creation', async () => {
      render(<QuickTaskModal />);

      // Open modal and create task
      const button = screen.getByRole('button', { name: /new task/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Quick Create Task')).toBeInTheDocument();
      });

      const titleInput = screen.getByPlaceholderText('Task title');
      fireEvent.change(titleInput, { target: { value: 'First Task' } });

      const createButton = screen.getByRole('button', { name: /^create$/i });
      fireEvent.click(createButton);

      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalled();
      });

      // Re-open modal
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Quick Create Task')).toBeInTheDocument();
      });

      // Title should be empty
      const newTitleInput = screen.getByPlaceholderText('Task title');
      expect(newTitleInput).toHaveValue('');
    });
  });

  describe('Form validation', () => {
    it('does not submit when title is empty', async () => {
      render(<QuickTaskModal />);

      // Open modal
      const button = screen.getByRole('button', { name: /new task/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Quick Create Task')).toBeInTheDocument();
      });

      // Try to submit without filling in title
      const createButton = screen.getByRole('button', { name: /^create$/i });
      fireEvent.click(createButton);

      // Mutation should not be called
      expect(mockMutateAsync).not.toHaveBeenCalled();
    });
  });

  describe('Error handling', () => {
    it('handles creation error gracefully', async () => {
      mockMutateAsync.mockRejectedValueOnce(new Error('API Error'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      render(<QuickTaskModal />);

      // Open modal
      const button = screen.getByRole('button', { name: /new task/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Quick Create Task')).toBeInTheDocument();
      });

      // Fill in title
      const titleInput = screen.getByPlaceholderText('Task title');
      fireEvent.change(titleInput, { target: { value: 'Test Task' } });

      // Click Create
      const createButton = screen.getByRole('button', { name: /^create$/i });
      fireEvent.click(createButton);

      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalled();
        expect(consoleSpy).toHaveBeenCalledWith('Failed to create task:', expect.any(Error));
      });

      consoleSpy.mockRestore();
    });
  });

  describe('Billing section visibility', () => {
    it('shows billing section for PM users', async () => {
      render(<QuickTaskModal />);

      // Open modal
      const button = screen.getByRole('button', { name: /new task/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Billing')).toBeInTheDocument();
        expect(screen.getByLabelText(/fixed billing amount/i)).toBeInTheDocument();
      });
    });
  });

  describe('Due date field', () => {
    it('has default value of 4 business days from today', async () => {
      render(<QuickTaskModal />);

      const button = screen.getByRole('button', { name: /new task/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Quick Create Task')).toBeInTheDocument();
      });

      const dueDateInput = screen.getByLabelText(/due date/i) as HTMLInputElement;

      // Calculate expected default (4 business days from now)
      const today = new Date();
      const expectedDate = addBusinessDays(today, 4);
      const expectedValue = formatDateForInput(expectedDate);

      expect(dueDateInput.value).toBe(expectedValue);
    });

    it('includes due_date in payload when creating task', async () => {
      render(<QuickTaskModal />);

      const button = screen.getByRole('button', { name: /new task/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Quick Create Task')).toBeInTheDocument();
      });

      const titleInput = screen.getByPlaceholderText('Task title');
      fireEvent.change(titleInput, { target: { value: 'Test Task' } });

      const dueDateInput = screen.getByLabelText(/due date/i);
      fireEvent.change(dueDateInput, { target: { value: '2026-02-15' } });

      const createButton = screen.getByRole('button', { name: /^create$/i });
      fireEvent.click(createButton);

      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Test Task',
            due_date: expect.stringContaining('2026-02-15'),
          })
        );
      });
    });

    it('allows due_date to be cleared', async () => {
      render(<QuickTaskModal />);

      const button = screen.getByRole('button', { name: /new task/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Quick Create Task')).toBeInTheDocument();
      });

      const titleInput = screen.getByPlaceholderText('Task title');
      fireEvent.change(titleInput, { target: { value: 'Test Task' } });

      const dueDateInput = screen.getByLabelText(/due date/i);
      fireEvent.change(dueDateInput, { target: { value: '' } });

      const createButton = screen.getByRole('button', { name: /^create$/i });
      fireEvent.click(createButton);

      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({
            due_date: null,
          })
        );
      });
    });

    it('resets due_date to default after creating task', async () => {
      render(<QuickTaskModal />);

      const button = screen.getByRole('button', { name: /new task/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Quick Create Task')).toBeInTheDocument();
      });

      // Change due date
      const dueDateInput = screen.getByLabelText(/due date/i);
      fireEvent.change(dueDateInput, { target: { value: '2026-12-25' } });

      const titleInput = screen.getByPlaceholderText('Task title');
      fireEvent.change(titleInput, { target: { value: 'Test Task' } });

      const createButton = screen.getByRole('button', { name: /^create$/i });
      fireEvent.click(createButton);

      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalled();
      });

      // Re-open modal
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Quick Create Task')).toBeInTheDocument();
      });

      // Should be back to default (4 business days)
      const newDueDateInput = screen.getByLabelText(/due date/i) as HTMLInputElement;
      const today = new Date();
      const expectedDate = addBusinessDays(today, 4);
      const expectedValue = formatDateForInput(expectedDate);

      expect(newDueDateInput.value).toBe(expectedValue);
    });
  });
});
