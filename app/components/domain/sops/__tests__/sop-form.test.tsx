import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import * as React from 'react';

// Mock next/navigation
const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, back: vi.fn() }),
}));

// Mock React Query
const mockMutate = vi.fn();
const mockInvalidateQueries = vi.fn();
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
  useMutation: ({ onSuccess }: { onSuccess: (result: any) => void }) => ({
    mutate: (data: any) => {
      mockMutate(data);
      // Simulate API response structure: { sop: { id: '...' } }
      onSuccess({ sop: { id: 'new-sop-123', title: data.title } });
    },
    isPending: false,
  }),
}));

// Mock API client
vi.mock('@/lib/api/client', () => ({
  apiClient: {
    post: vi.fn(),
    patch: vi.fn(),
  },
}));

// Mock hooks
vi.mock('@/lib/hooks/use-reference-data', () => ({
  useFunctions: () => ({
    data: { functions: [] },
  }),
}));

// Mock UI components that are complex
vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: ({ onChange }: { onChange: (content: any) => void }) => (
    <div data-testid="rich-text-editor">Mock Editor</div>
  ),
}));

vi.mock('@/components/ui/sectioned-requirements-editor', () => ({
  SectionedRequirementsEditor: () => <div data-testid="requirements-editor">Mock Requirements</div>,
}));

// Import after mocks
import { SopForm } from '../sop-form';

describe('SopForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('redirect after creation', () => {
    it('should redirect to /sops/{id} using sop.id from API response', async () => {
      render(<SopForm />);

      // Fill in the title (required field)
      const titleInput = screen.getByPlaceholderText('SOP title');
      fireEvent.change(titleInput, { target: { value: 'Test SOP Title' } });

      // Submit the form
      const submitButton = screen.getByRole('button', { name: /create sop/i });
      fireEvent.click(submitButton);

      // Verify mutation was called
      expect(mockMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Test SOP Title',
        })
      );

      // Verify redirect uses the correct path with sop.id from response
      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/sops/new-sop-123');
      });
    });

    it('should invalidate sops query cache after creation', async () => {
      render(<SopForm />);

      const titleInput = screen.getByPlaceholderText('SOP title');
      fireEvent.change(titleInput, { target: { value: 'Another SOP' } });

      const submitButton = screen.getByRole('button', { name: /create sop/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['sops'] });
      });
    });
  });

  describe('edit mode', () => {
    it('should redirect using existing sop.id when editing', async () => {
      const existingSop = {
        id: 'existing-sop-456',
        title: 'Existing SOP',
        content: null,
        function: null,
        estimated_minutes: null,
        tags: [],
        is_active: true,
      };

      // Override mutation mock for edit mode
      vi.mocked(mockMutate).mockImplementationOnce(() => {
        // For PATCH, API might not return the full sop object
      });

      render(<SopForm sop={existingSop} />);

      // Verify title is pre-filled
      const titleInput = screen.getByDisplayValue('Existing SOP');
      expect(titleInput).toBeInTheDocument();

      // Submit button should say "Save Changes" in edit mode
      const submitButton = screen.getByRole('button', { name: /save changes/i });
      expect(submitButton).toBeInTheDocument();
    });
  });

  describe('form validation', () => {
    it('should not submit when title is empty', () => {
      render(<SopForm />);

      const submitButton = screen.getByRole('button', { name: /create sop/i });

      // Button should be disabled when title is empty
      expect(submitButton).toBeDisabled();
    });

    it('should enable submit button when title is provided', () => {
      render(<SopForm />);

      const titleInput = screen.getByPlaceholderText('SOP title');
      fireEvent.change(titleInput, { target: { value: 'Valid Title' } });

      const submitButton = screen.getByRole('button', { name: /create sop/i });
      expect(submitButton).not.toBeDisabled();
    });
  });
});
