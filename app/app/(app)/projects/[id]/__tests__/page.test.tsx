import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

/**
 * These tests verify that RichTextRenderer is properly used for rendering
 * Rich Text content in the Project Details tab, preventing React error #31
 * ("Objects are not valid as a React child").
 *
 * The key fix was replacing:
 *   {project.description} // ❌ Direct rendering causes error #31
 * with:
 *   <RichTextRenderer content={project.description} /> // ✅ Proper component rendering
 */

// Track RichTextRenderer calls
let renderedRichTextContent: any = null;
let richTextRendererCallCount = 0;

// Mock next/navigation
const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'proj-1' }),
  useRouter: () => ({ push: mockPush }),
}));

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// Create a factory for mock project data to ensure fresh instances
const createMockProjectData = (description: any = null) => ({
  id: 'proj-1',
  name: 'Test Project',
  status: 'active',
  type: 'web',
  client: { id: 'client-1', name: 'Test Client', status: 'active' },
  site: null,
  start_date: null,
  target_date: null,
  completed_date: null,
  budget_hours: null,
  hourly_rate: null,
  budget_amount: null,
  budget_locked: false,
  budget_locked_at: null,
  is_retainer: false,
  description, // Will be set per test
  notes: null,
  tasks_count: 0,
  completed_tasks_count: 0,
  team_assignments: [],
  tasks: [],
  phases: [],
  milestones: [],
  calculated: {
    estimated_hours_min: 0,
    estimated_hours_max: 0,
    estimated_range: '-',
    time_spent_minutes: 0,
    task_count: 0,
    completed_task_count: 0,
    total_energy_minutes: 0,
    completed_energy_minutes: 0,
    progress_percent: 0,
  },
  created_by_id: 'user-1',
  created_by: { id: 'user-1', name: 'Test User' },
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
});

// This will hold the current mock data for each test
let currentMockProjectData = createMockProjectData();

// Mock use-projects hooks
const mockMutate = vi.fn();
vi.mock('@/lib/hooks/use-projects', () => ({
  useProject: () => ({
    data: currentMockProjectData,
    isLoading: false,
    error: null,
  }),
  useUpdateProject: () => ({
    mutate: mockMutate,
    isPending: false,
  }),
  useUpdateProjectStatus: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useDeleteProject: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useLockProjectBudget: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useCreateProjectPhase: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useUpdateProjectPhase: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useDeleteProjectPhase: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useReorderProjectPhases: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}));

// Mock use-tasks hooks
vi.mock('@/lib/hooks/use-tasks', () => ({
  useCreateTask: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateTaskInProject: () => ({ mutate: vi.fn(), isPending: false }),
  useReorderProjectTasks: () => ({ mutate: vi.fn(), isPending: false }),
  useMoveTask: () => ({ mutate: vi.fn(), isPending: false }),
  useBulkUpdateTasks: () => ({ mutate: vi.fn(), isPending: false }),
  useBulkDeleteTasks: () => ({ mutate: vi.fn(), isPending: false }),
}));

// Mock use-auth hook
vi.mock('@/lib/hooks/use-auth', () => ({
  useAuth: () => ({
    isPmOrAdmin: true,
  }),
}));

// Mock use-terminology hook
vi.mock('@/lib/hooks/use-terminology', () => ({
  useTerminology: () => ({ t: (key: string) => key }),
}));

// Mock RichTextEditor and RichTextRenderer - track if RichTextRenderer is called
vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: ({ content, onChange, readOnly, placeholder }: any) => (
    <div data-testid="rich-text-editor" data-readonly={readOnly}>
      {content ? JSON.stringify(content) : 'empty'}
    </div>
  ),
  RichTextRenderer: ({ content }: any) => {
    renderedRichTextContent = content;
    richTextRendererCallCount++;
    return (
      <div data-testid={`rich-text-renderer-${richTextRendererCallCount}`}>
        {content ? JSON.stringify(content) : 'empty'}
      </div>
    );
  },
}));

// Mock other components
vi.mock('@/components/domain/projects/project-workload-tab', () => ({
  ProjectWorkloadTab: () => <div data-testid="workload-tab">Workload Tab</div>,
}));

vi.mock('@/components/domain/projects/project-time-tab', () => ({
  ProjectTimeTab: () => <div data-testid="time-tab">Time Tab</div>,
}));

vi.mock('@/components/domain/projects/project-team-tab', () => ({
  ProjectTeamTab: () => <div data-testid="team-tab">Team Tab</div>,
}));

vi.mock('@/components/domain/projects/milestone-list', () => ({
  MilestoneList: () => <div data-testid="milestone-list">Milestones</div>,
}));

vi.mock('@/components/domain/projects/resource-links', () => ({
  ResourceLinks: () => <div data-testid="resource-links">Resource Links</div>,
}));

vi.mock('@/components/domain/projects/project-form', () => ({
  ProjectForm: () => <div data-testid="project-form">Project Form</div>,
}));

vi.mock('@/components/domain/tasks/task-peek-drawer', () => ({
  TaskPeekDrawer: () => <div data-testid="task-peek-drawer">Task Peek</div>,
}));

vi.mock('@/components/domain/tasks/bulk-edit-tasks-modal', () => ({
  BulkEditTasksModal: () => <div data-testid="bulk-edit-modal">Bulk Edit</div>,
}));

vi.mock('@/components/ui/task-list', () => ({
  TaskList: () => <div data-testid="task-list">Task List</div>,
}));

vi.mock('@/components/ui/field-selects', () => ({
  ProjectStatusInlineSelect: ({ value }: any) => (
    <div data-testid="status-select">{value}</div>
  ),
}));

vi.mock('@/components/ui/icon-picker', () => ({
  InlineIconPicker: () => <div data-testid="icon-picker">Icon</div>,
}));

vi.mock('@/components/ui/inline-edit/inline-date', () => ({
  InlineDate: ({ value }: any) => <div data-testid="inline-date">{value || 'No date'}</div>,
}));

// Mock use-toast
vi.mock('@/lib/hooks/use-toast', () => ({
  showToast: {
    success: vi.fn(),
    apiError: vi.fn(),
  },
}));

import ProjectDetailPage from '../../[id]/page';

describe('ProjectDetailPage Details Tab - Rich Text Rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    renderedRichTextContent = null;
    richTextRendererCallCount = 0;
  });

  describe('React Error #31 Prevention', () => {
    it('uses RichTextRenderer for BlockNote description objects', async () => {
      // This is the format that caused React error #31 when rendered directly
      const blockNoteDescription = [
        {
          id: 'block-1',
          type: 'paragraph',
          props: {},
          content: [{ type: 'text', text: 'Project description text', styles: {} }],
          children: [],
        },
      ];

      currentMockProjectData = createMockProjectData(blockNoteDescription);

      // This should NOT throw "Objects are not valid as a React child" error
      // because we're using RichTextRenderer instead of {project.description}
      expect(() => {
        render(<ProjectDetailPage />);
      }).not.toThrow();

      // Click on the Details tab to see the description
      const detailsTab = screen.getByRole('tab', { name: 'Details' });
      await userEvent.click(detailsTab);

      // Verify RichTextRenderer was used with the correct content
      expect(renderedRichTextContent).toEqual(blockNoteDescription);
    });

    it('prevents React error #31 with complex BlockNote content', async () => {
      const complexDescription = [
        {
          id: 'block-1',
          type: 'heading',
          props: { level: 1 },
          content: [{ type: 'text', text: 'Project Title', styles: {} }],
          children: [],
        },
        {
          id: 'block-2',
          type: 'paragraph',
          props: {},
          content: [
            { type: 'text', text: 'Bold text', styles: { bold: true } },
            { type: 'text', text: ' and normal text', styles: {} },
          ],
          children: [],
        },
        {
          id: 'block-3',
          type: 'bulletListItem',
          props: {},
          content: [{ type: 'text', text: 'Bullet point', styles: {} }],
          children: [],
        },
      ];

      currentMockProjectData = createMockProjectData(complexDescription);

      // Should not throw React error #31
      expect(() => {
        render(<ProjectDetailPage />);
      }).not.toThrow();

      // Click on the Details tab to see the description
      const detailsTab = screen.getByRole('tab', { name: 'Details' });
      await userEvent.click(detailsTab);

      // Verify RichTextRenderer received the full content
      expect(renderedRichTextContent).toEqual(complexDescription);
    });

    it('handles null description gracefully', async () => {
      currentMockProjectData = createMockProjectData(null);

      render(<ProjectDetailPage />);

      // Click on the Details tab to see the description
      const detailsTab = screen.getByRole('tab', { name: 'Details' });
      await userEvent.click(detailsTab);

      // RichTextRenderer should render with null content
      expect(renderedRichTextContent).toBeNull();
    });

    it('handles empty array description gracefully', async () => {
      currentMockProjectData = createMockProjectData([]);

      render(<ProjectDetailPage />);

      // Click on the Details tab to see the description
      const detailsTab = screen.getByRole('tab', { name: 'Details' });
      await userEvent.click(detailsTab);

      // RichTextRenderer should receive empty array
      expect(renderedRichTextContent).toEqual([]);
    });

    it('handles BlockNote content with nested children', async () => {
      const nestedDescription = [
        {
          id: 'block-1',
          type: 'paragraph',
          props: {},
          content: [{ type: 'text', text: 'Parent paragraph', styles: {} }],
          children: [
            {
              id: 'block-2',
              type: 'paragraph',
              props: {},
              content: [{ type: 'text', text: 'Nested child', styles: {} }],
              children: [],
            },
          ],
        },
      ];

      currentMockProjectData = createMockProjectData(nestedDescription);

      // Should not throw with nested structures
      expect(() => {
        render(<ProjectDetailPage />);
      }).not.toThrow();

      // Click on the Details tab to see the description
      const detailsTab = screen.getByRole('tab', { name: 'Details' });
      await userEvent.click(detailsTab);

      expect(renderedRichTextContent).toEqual(nestedDescription);
    });
  });

  describe('Regression Prevention', () => {
    it('verifies RichTextRenderer is called when description is present', async () => {
      const description = [{ type: 'paragraph', content: [], children: [] }];
      currentMockProjectData = createMockProjectData(description);

      render(<ProjectDetailPage />);

      // Click on the Details tab to see the description
      const detailsTab = screen.getByRole('tab', { name: 'Details' });
      await userEvent.click(detailsTab);

      // RichTextRenderer should have been called at least once
      expect(richTextRendererCallCount).toBeGreaterThanOrEqual(1);
    });

    it('handles the exact error object structure from the bug report', async () => {
      // The bug report showed: object with keys {id, type, props, content, children}
      const bugReportStructure = [
        {
          id: 'unique-id-123',
          type: 'paragraph',
          props: { textAlignment: 'left' },
          content: [
            { type: 'text', text: 'This structure caused error #31', styles: {} },
          ],
          children: [],
        },
      ];

      currentMockProjectData = createMockProjectData(bugReportStructure);

      // Should render without error
      expect(() => {
        render(<ProjectDetailPage />);
      }).not.toThrow();

      // Click on the Details tab to see the description
      const detailsTab = screen.getByRole('tab', { name: 'Details' });
      await userEvent.click(detailsTab);

      expect(renderedRichTextContent).toEqual(bugReportStructure);
    });
  });
});
