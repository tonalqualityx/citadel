import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as React from 'react';

/**
 * These tests verify that RichTextRenderer properly handles BlockNote content,
 * which prevents React error #31 ("Objects are not valid as a React child")
 * that occurred when Rich Text content was rendered directly as {project.description}.
 *
 * The fix changed:
 *   <dd className="text-text-main whitespace-pre-wrap">
 *     {project.description}  // ❌ Causes error #31
 *   </dd>
 * to:
 *   <dd className="text-text-main">
 *     <RichTextRenderer content={project.description} />  // ✅ Proper rendering
 *   </dd>
 */

// Mock BlockNote components
vi.mock('@blocknote/mantine', () => ({
  BlockNoteView: ({ editor, editable, theme }: any) => (
    <div data-testid="blocknote-view" data-editable={editable} data-theme={theme}>
      BlockNote Editor
    </div>
  ),
}));

vi.mock('@blocknote/react', () => ({
  useCreateBlockNote: ({ initialContent }: any) => ({
    document: initialContent || [],
  }),
}));

// Import after mocks
import { RichTextRenderer, getBlockNotePlainText } from '../rich-text-editor';

describe('RichTextRenderer - React Error #31 Prevention', () => {
  describe('BlockNote Content Rendering', () => {
    it('renders BlockNote paragraph content without throwing error #31', () => {
      // This is the exact structure that caused React error #31
      const blockNoteContent = [
        {
          id: 'block-1',
          type: 'paragraph',
          props: {},
          content: [{ type: 'text', text: 'Project description text', styles: {} }],
          children: [],
        },
      ];

      // Should not throw "Objects are not valid as a React child"
      expect(() => {
        render(<RichTextRenderer content={blockNoteContent} />);
      }).not.toThrow();

      // Should render the editor
      expect(screen.getByTestId('blocknote-view')).toBeInTheDocument();
    });

    it('renders the exact structure from the bug report', () => {
      // The bug report error showed:
      // "object with keys {id, type, props, content, children}"
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

      expect(() => {
        render(<RichTextRenderer content={bugReportStructure} />);
      }).not.toThrow();

      expect(screen.getByTestId('blocknote-view')).toBeInTheDocument();
    });

    it('handles complex BlockNote content with multiple blocks', () => {
      const complexContent = [
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

      expect(() => {
        render(<RichTextRenderer content={complexContent} />);
      }).not.toThrow();

      expect(screen.getByTestId('blocknote-view')).toBeInTheDocument();
    });

    it('handles nested children structure', () => {
      const nestedContent = [
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

      expect(() => {
        render(<RichTextRenderer content={nestedContent} />);
      }).not.toThrow();

      expect(screen.getByTestId('blocknote-view')).toBeInTheDocument();
    });

    it('handles null content gracefully', () => {
      expect(() => {
        render(<RichTextRenderer content={null} />);
      }).not.toThrow();

      expect(screen.getByTestId('blocknote-view')).toBeInTheDocument();
    });

    it('handles empty array content gracefully', () => {
      expect(() => {
        render(<RichTextRenderer content={[]} />);
      }).not.toThrow();

      expect(screen.getByTestId('blocknote-view')).toBeInTheDocument();
    });

    it('sets editable=false for read-only mode', () => {
      const content = [
        { id: 'block-1', type: 'paragraph', props: {}, content: [], children: [] },
      ];

      render(<RichTextRenderer content={content} />);

      const view = screen.getByTestId('blocknote-view');
      expect(view.getAttribute('data-editable')).toBe('false');
    });
  });

  describe('getBlockNotePlainText Utility', () => {
    it('extracts plain text from BlockNote content', () => {
      const content = [
        {
          id: 'block-1',
          type: 'paragraph',
          props: {},
          content: [
            { type: 'text', text: 'Hello ', styles: {} },
            { type: 'text', text: 'world', styles: { bold: true } },
          ],
          children: [],
        },
      ];

      const plainText = getBlockNotePlainText(content);
      expect(plainText).toBe('Hello world');
    });

    it('handles multiple blocks', () => {
      const content = [
        {
          id: 'block-1',
          type: 'paragraph',
          props: {},
          content: [{ type: 'text', text: 'First paragraph', styles: {} }],
          children: [],
        },
        {
          id: 'block-2',
          type: 'paragraph',
          props: {},
          content: [{ type: 'text', text: 'Second paragraph', styles: {} }],
          children: [],
        },
      ];

      const plainText = getBlockNotePlainText(content);
      expect(plainText).toBe('First paragraph Second paragraph');
    });

    it('returns empty string for null content', () => {
      expect(getBlockNotePlainText(null)).toBe('');
    });

    it('returns empty string for empty array', () => {
      expect(getBlockNotePlainText([])).toBe('');
    });

    it('handles string content (edge case)', () => {
      expect(getBlockNotePlainText('plain string' as any)).toBe('plain string');
    });
  });

  describe('Regression Tests', () => {
    it('verifies the fix prevents direct object rendering', () => {
      // This test documents the fix: using RichTextRenderer instead of direct rendering
      const blockNoteObject = [
        {
          id: 'test-id',
          type: 'paragraph',
          props: { textAlignment: 'left' },
          content: [
            { type: 'text', text: 'Test content', styles: { bold: true } },
          ],
          children: [],
        },
      ];

      // The component wraps the content properly
      const { container } = render(<RichTextRenderer content={blockNoteObject} />);

      // Should render without errors
      expect(container.firstChild).toBeInTheDocument();

      // The blocknote-view should be present (the proper rendering path)
      expect(screen.getByTestId('blocknote-view')).toBeInTheDocument();
    });

    it('handles all BlockNote block types without errors', () => {
      const allBlockTypes = [
        { id: '1', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'Para', styles: {} }], children: [] },
        { id: '2', type: 'heading', props: { level: 1 }, content: [{ type: 'text', text: 'Heading', styles: {} }], children: [] },
        { id: '3', type: 'bulletListItem', props: {}, content: [{ type: 'text', text: 'Bullet', styles: {} }], children: [] },
        { id: '4', type: 'numberedListItem', props: {}, content: [{ type: 'text', text: 'Numbered', styles: {} }], children: [] },
        { id: '5', type: 'codeBlock', props: { language: 'javascript' }, content: [{ type: 'text', text: 'code', styles: {} }], children: [] },
      ];

      expect(() => {
        render(<RichTextRenderer content={allBlockTypes} />);
      }).not.toThrow();

      expect(screen.getByTestId('blocknote-view')).toBeInTheDocument();
    });
  });
});
