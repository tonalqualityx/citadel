import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as React from 'react';

// Mock use-projects hook
const mockMutate = vi.fn();
vi.mock('@/lib/hooks/use-projects', () => ({
  useUpdateProject: () => ({
    mutate: mockMutate,
    isPending: false,
  }),
}));

// Mock use-auth hook
let mockIsPmOrAdmin = true;
vi.mock('@/lib/hooks/use-auth', () => ({
  useAuth: () => ({
    isPmOrAdmin: mockIsPmOrAdmin,
  }),
}));

// Mock RichTextEditor
vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: ({ content, onChange, readOnly, placeholder }: any) => (
    <div
      data-testid="rich-text-editor"
      data-readonly={readOnly}
      data-placeholder={placeholder}
    >
      {content ? JSON.stringify(content) : 'empty'}
      <button
        data-testid="trigger-change"
        onClick={() =>
          onChange?.([{ type: 'paragraph', content: [{ type: 'text', text: 'updated' }] }])
        }
      >
        Change
      </button>
    </div>
  ),
}));

// Import after mocks
import { ProjectBriefTab } from '../project-brief-tab';

describe('ProjectBriefTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockIsPmOrAdmin = true;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders RichTextEditor with description content', () => {
    const description = [
      { type: 'paragraph', content: [{ type: 'text', text: 'Project goals' }] },
    ];

    render(<ProjectBriefTab projectId="proj-1" description={description} />);

    const editor = screen.getByTestId('rich-text-editor');
    expect(editor).toBeInTheDocument();
    expect(editor.textContent).toContain('Project goals');
  });

  it('renders with null description', () => {
    render(<ProjectBriefTab projectId="proj-1" description={null} />);

    const editor = screen.getByTestId('rich-text-editor');
    expect(editor).toBeInTheDocument();
    expect(editor.textContent).toContain('empty');
  });

  it('calls updateProject.mutate on change after debounce', async () => {
    render(<ProjectBriefTab projectId="proj-1" description={null} />);

    const changeButton = screen.getByTestId('trigger-change');
    changeButton.click();

    // Should not call immediately
    expect(mockMutate).not.toHaveBeenCalled();

    // Advance timers past debounce (500ms)
    vi.advanceTimersByTime(600);

    expect(mockMutate).toHaveBeenCalledWith({
      id: 'proj-1',
      data: {
        description: [{ type: 'paragraph', content: [{ type: 'text', text: 'updated' }] }],
      },
    });
  });

  it('sets readOnly=true for non-PM/Admin users', () => {
    mockIsPmOrAdmin = false;

    render(<ProjectBriefTab projectId="proj-1" description={null} />);

    const editor = screen.getByTestId('rich-text-editor');
    expect(editor.getAttribute('data-readonly')).toBe('true');
  });

  it('sets readOnly=false for PM/Admin users', () => {
    mockIsPmOrAdmin = true;

    render(<ProjectBriefTab projectId="proj-1" description={null} />);

    const editor = screen.getByTestId('rich-text-editor');
    expect(editor.getAttribute('data-readonly')).toBe('false');
  });
});
