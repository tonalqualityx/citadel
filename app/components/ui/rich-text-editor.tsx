'use client';

import { useMemo, useCallback } from 'react';
import { BlockNoteView } from '@blocknote/mantine';
import { useCreateBlockNote } from '@blocknote/react';
import {
  BlockNoteSchema,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  defaultStyleSpecs,
  Block,
} from '@blocknote/core';
import './rich-text-editor.css';

// ============================================
// TYPES
// ============================================

export type BlockNoteContent = any; // BlockNote's document type

interface RichTextEditorProps {
  content: BlockNoteContent | null;
  onChange: (content: BlockNoteContent) => void;
  placeholder?: string;
  readOnly?: boolean;
  className?: string;
}

// ============================================
// SCHEMA (extend here for custom blocks)
// ============================================

const schema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    // Add custom blocks here if needed
  },
  inlineContentSpecs: defaultInlineContentSpecs,
  styleSpecs: defaultStyleSpecs,
});

// ============================================
// CONTENT FORMAT HELPERS
// ============================================

/**
 * Check if content is TipTap format (needs migration)
 */
function isTipTapFormat(content: any): boolean {
  return content && typeof content === 'object' && content.type === 'doc';
}

/**
 * Check if content is BlockNote format
 */
function isBlockNoteFormat(content: any): boolean {
  return Array.isArray(content);
}

/**
 * Simple TipTap to BlockNote migration for inline content
 */
function migrateTipTapContent(tipTapDoc: any): any[] | undefined {
  if (!tipTapDoc || !tipTapDoc.content) return undefined;

  const blocks: any[] = [];

  for (const node of tipTapDoc.content) {
    const block = convertTipTapNode(node);
    if (block) {
      blocks.push(block);
    }
  }

  return blocks.length > 0 ? blocks : undefined;
}

function convertTipTapNode(node: any): any | null {
  switch (node.type) {
    case 'paragraph':
      return {
        id: crypto.randomUUID(),
        type: 'paragraph',
        content: convertInlineContent(node.content || []),
        children: [],
      };

    case 'heading':
      const level = node.attrs?.level || 1;
      return {
        id: crypto.randomUUID(),
        type: 'heading',
        props: { level: Math.min(level, 3) as 1 | 2 | 3 },
        content: convertInlineContent(node.content || []),
        children: [],
      };

    case 'bulletList':
      // Convert list items
      return node.content?.map((item: any) => ({
        id: crypto.randomUUID(),
        type: 'bulletListItem',
        content: convertInlineContent(item.content?.[0]?.content || []),
        children: [],
      }))?.[0] || null;

    case 'orderedList':
      return node.content?.map((item: any) => ({
        id: crypto.randomUUID(),
        type: 'numberedListItem',
        content: convertInlineContent(item.content?.[0]?.content || []),
        children: [],
      }))?.[0] || null;

    case 'codeBlock':
      return {
        id: crypto.randomUUID(),
        type: 'codeBlock',
        props: { language: node.attrs?.language || 'text' },
        content: [{ type: 'text', text: getTextContent(node), styles: {} }],
        children: [],
      };

    case 'blockquote':
      return {
        id: crypto.randomUUID(),
        type: 'paragraph',
        content: convertInlineContent(node.content?.[0]?.content || []),
        children: [],
      };

    default:
      return null;
  }
}

function convertInlineContent(nodes: any[]): any[] {
  const content: any[] = [];

  for (const node of nodes) {
    if (node.type === 'text' && node.text) {
      const styles: Record<string, boolean> = {};

      if (node.marks) {
        for (const mark of node.marks) {
          switch (mark.type) {
            case 'bold':
              styles.bold = true;
              break;
            case 'italic':
              styles.italic = true;
              break;
            case 'underline':
              styles.underline = true;
              break;
            case 'strike':
              styles.strike = true;
              break;
            case 'code':
              styles.code = true;
              break;
          }
        }
      }

      content.push({
        type: 'text',
        text: node.text,
        styles,
      });
    } else if (node.type === 'hardBreak') {
      content.push({ type: 'text', text: '\n', styles: {} });
    }
  }

  return content;
}

function getTextContent(node: any): string {
  if (node.text) return node.text;
  if (!node.content) return '';
  return node.content.map(getTextContent).join('');
}

/**
 * Auto-detect and migrate content if needed
 */
function ensureBlockNoteFormat(content: any): any[] | undefined {
  if (!content) return undefined;
  if (isBlockNoteFormat(content)) return content;
  if (isTipTapFormat(content)) return migrateTipTapContent(content);
  return undefined;
}

// ============================================
// DARK MODE DETECTION
// ============================================

function useIsDarkMode(): boolean {
  // Check if we're in dark mode via theme classes or system preference
  if (typeof window === 'undefined') return false;

  const root = document.documentElement;

  // Indelible uses theme-dark and theme-dim classes
  if (root.classList.contains('theme-dark')) return true;
  if (root.classList.contains('theme-dim')) return true;
  if (root.classList.contains('theme-light')) return false;

  // Fall back to system preference (when no explicit theme class)
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

// ============================================
// FILE UPLOAD HANDLER
// ============================================

async function uploadFile(file: File): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch('/api/uploads', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Upload failed');
  }

  const data = await response.json();
  return data.url;
}

// ============================================
// EDITOR COMPONENT
// ============================================

export function RichTextEditor({
  content,
  onChange,
  placeholder = 'Type "/" for commands...',
  readOnly = false,
  className = '',
}: RichTextEditorProps) {
  // Parse initial content - BlockNote expects an array of blocks
  const initialContent = useMemo(() => {
    return ensureBlockNoteFormat(content);
  }, []);

  const editor = useCreateBlockNote({
    schema,
    initialContent,
    uploadFile,
  });

  // Handle content changes - use BlockNote's proper onChange
  const handleChange = useCallback(() => {
    if (!readOnly) {
      onChange(editor.document);
    }
  }, [editor, onChange, readOnly]);

  // Detect dark mode
  const isDark = useIsDarkMode();

  return (
    <div className={`blocknote-wrapper ${className}`} data-readonly={readOnly}>
      <BlockNoteView
        editor={editor}
        editable={!readOnly}
        theme={isDark ? 'dark' : 'light'}
        onChange={handleChange}
      />
    </div>
  );
}

// ============================================
// READ-ONLY RENDERER (simpler version)
// ============================================

interface RichTextRendererProps {
  content: BlockNoteContent | null;
  className?: string;
}

export function RichTextRenderer({ content, className = '' }: RichTextRendererProps) {
  return (
    <RichTextEditor
      content={content}
      onChange={() => {}}
      readOnly={true}
      className={className}
    />
  );
}

// ============================================
// PLAIN TEXT EXTRACTION UTILITY
// ============================================

/**
 * Extract plain text from BlockNote content for display in lists/previews
 * Useful when you need to show a text snippet without rich formatting
 */
export function getBlockNotePlainText(content: BlockNoteContent | null | undefined): string {
  if (!content) return '';

  // Handle string content (already plain text)
  if (typeof content === 'string') return content;

  // Handle non-array content
  if (!Array.isArray(content)) return '';

  const textParts: string[] = [];

  for (const block of content) {
    if (block.content && Array.isArray(block.content)) {
      for (const inline of block.content) {
        if (inline.type === 'text' && inline.text) {
          textParts.push(inline.text);
        }
      }
    }
    // Add space between blocks
    textParts.push(' ');
  }

  return textParts.join('').trim();
}
