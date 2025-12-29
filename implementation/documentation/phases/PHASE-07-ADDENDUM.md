# Phase 7 Addendum: BlockNote + Inline Editing + Review Checklist

## Purpose

This addendum extends Phase 7 with three enhancements:

1. **BlockNote Migration** — Replace TipTap with BlockNote for a Notion-style block editing experience
2. **Pervasive Inline Editing** — Click any field to edit immediately (no modals, no "Edit" buttons)
3. **Review Requirements** — A second checklist on SOPs visible only to PM/Admin for QA steps. This checklist will be called "Quality Gate"

**Estimated Duration:** 4-6 hours  
**Prerequisites:** Phase 7 complete with TipTap implementation

---

## Scope

### A. BlockNote Migration

Affects **all locations** where the rich text editor component is used:

| Entity | Field | Location | Purpose |
|--------|-------|----------|---------|
| **SOPs (Runes)** | `content` | `/grimoire/runes/[id]/edit` | SOP documentation & procedures |
| **Recipes (Rituals)** | `documentation` | `/grimoire/rituals/[id]` | Recipe workflow documentation |

**Not affected** (these use structured data, not rich text):
- Task `requirements` — JSON array of checkbox items, not a block editor
- Task `description` — Plain text field

### B. Pervasive Inline Editing

Affects **all detail views** where fields are currently displayed as read-only with separate edit modals:

| Entity | Fields | Current | Target |
|--------|--------|---------|--------|
| **Tasks** | Name, status, assignee, priority, due date, energy, mystery, battery, phase, function, requirements | Mix of modal + inline | All inline |
| **Projects** | Name, status, due date, PM, client | Modal | All inline |
| **SOPs** | Name, all metadata | Modal | All inline |
| **Clients** | All fields | Modal | All inline |
| **Sites** | All fields | Modal | All inline |

### C. Review Requirements

Adds a new field to SOPs and Tasks:

| Entity | Field | Visibility | Purpose |
|--------|-------|------------|---------|
| **SOP** | `review_requirements` | PM/Admin only | Template for QA checklist |
| **Task** | `review_requirements` | PM/Admin only | Copied from SOP, used during review |

---

## A. BlockNote Migration

### A.1 Why BlockNote?

| Feature | TipTap (Current) | BlockNote |
|---------|------------------|-----------|
| Slash commands (`/`) | Manual extension required | ✅ Built-in |
| Block drag-and-drop | Manual extension required | ✅ Built-in |
| Block selection handles | Manual implementation | ✅ Built-in |
| Nested blocks | Complex setup | ✅ Built-in |
| Formatting toolbar | Built manually | ✅ Built-in (appears on selection) |
| Notion-like UX | Requires significant work | ✅ Native experience |
| Custom block types | Via node views | ✅ Via `createReactBlockSpec` |

---

## Migration Checklist

### A.1 Remove TipTap Dependencies

```bash
npm uninstall @tiptap/react @tiptap/starter-kit @tiptap/extension-link @tiptap/extension-image @tiptap/extension-placeholder @tiptap/extension-underline @tiptap/pm
```

### A.2 Install BlockNote

```bash
npm install @blocknote/core @blocknote/react @blocknote/mantine @mantine/core
```

**Note:** BlockNote uses Mantine for its default UI components. The `@mantine/core` peer dependency is required but you won't need to use Mantine elsewhere in your app.

### A.3 Add Mantine CSS Provider

BlockNote requires Mantine's CSS to be loaded. Add to your root layout or a provider component:

**Update `/app/(app)/layout.tsx`** (or create a provider):

```tsx
// Add at the top of the file
import '@mantine/core/styles.css';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
```

Alternatively, create a dedicated provider if you want to isolate BlockNote styles:

**Create `/components/providers/BlockNoteProvider.tsx`:**

```tsx
'use client';

import '@mantine/core/styles.css';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import { MantineProvider, createTheme } from '@mantine/core';

// Minimal Mantine theme - BlockNote handles its own styling
const theme = createTheme({
  // Keep defaults, BlockNote uses its own styling
});

export function BlockNoteProvider({ children }: { children: React.ReactNode }) {
  return (
    <MantineProvider theme={theme} forceColorScheme="light">
      {children}
    </MantineProvider>
  );
}
```

---

## Component Replacements

### A.4 Replace Rich Text Editor Component

**Delete:** `/components/ui/rich-text-editor.tsx` (the TipTap version)

**Create:** `/components/ui/rich-text-editor.tsx` (BlockNote version)

```tsx
'use client';

import { useEffect, useMemo } from 'react';
import { BlockNoteView } from '@blocknote/mantine';
import { useCreateBlockNote } from '@blocknote/react';
import {
  BlockNoteSchema,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  defaultStyleSpecs,
} from '@blocknote/core';

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
    // Add custom blocks here (see A.7 for Tool Embed example)
  },
  inlineContentSpecs: defaultInlineContentSpecs,
  styleSpecs: defaultStyleSpecs,
});

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
    if (!content) return undefined;
    // If content is already BlockNote format, use it directly
    if (Array.isArray(content)) return content;
    // If it's TipTap JSON format, we'll need migration (see A.6)
    return undefined;
  }, []);

  const editor = useCreateBlockNote({
    schema,
    initialContent,
    // Placeholder shown in empty paragraphs
    placeholders: {
      default: placeholder,
    },
  });

  // Sync content changes to parent
  useEffect(() => {
    if (readOnly) return;

    const handleChange = () => {
      onChange(editor.document);
    };

    // BlockNote doesn't have a simple onChange, so we use the underlying editor
    editor._tiptapEditor.on('update', handleChange);

    return () => {
      editor._tiptapEditor.off('update', handleChange);
    };
  }, [editor, onChange, readOnly]);

  return (
    <div className={`blocknote-wrapper ${className}`}>
      <BlockNoteView
        editor={editor}
        editable={!readOnly}
        theme="light"
        // Customize the theme to match your app
        data-theming-css-variables-demo
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
```

### A.5 Add Custom Styling

**Create:** `/components/ui/rich-text-editor.css`

```css
/* BlockNote customizations to match Indelible's design system */

.blocknote-wrapper {
  /* Container styling */
}

/* Match your warm off-white background */
.blocknote-wrapper [data-node-type="blockContainer"] {
  --bn-colors-editor-background: #FAF9F7;
}

/* Customize the slash menu */
.blocknote-wrapper [data-slash-menu] {
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

/* Amber accent for selections (matching your design system) */
.blocknote-wrapper [data-selected="true"] {
  background-color: rgba(245, 166, 35, 0.1);
}

/* Hide the side menu in read-only mode */
.blocknote-wrapper[data-readonly="true"] [data-side-menu] {
  display: none;
}

/* Prose styling for content */
.blocknote-wrapper .bn-editor {
  font-family: inherit;
  font-size: 0.9375rem;
  line-height: 1.6;
  color: #44403c; /* stone-700 */
}

.blocknote-wrapper h1 {
  font-size: 1.5rem;
  font-weight: 600;
  margin-top: 1.5rem;
  margin-bottom: 0.75rem;
}

.blocknote-wrapper h2 {
  font-size: 1.25rem;
  font-weight: 600;
  margin-top: 1.25rem;
  margin-bottom: 0.5rem;
}

.blocknote-wrapper h3 {
  font-size: 1.125rem;
  font-weight: 600;
  margin-top: 1rem;
  margin-bottom: 0.5rem;
}

/* Code blocks */
.blocknote-wrapper pre {
  background-color: #f5f5f4; /* stone-100 */
  border-radius: 6px;
  padding: 0.75rem 1rem;
}

/* Checkboxes - style to match your task checkboxes */
.blocknote-wrapper [data-content-type="checkListItem"] input[type="checkbox"] {
  accent-color: #F5A623; /* Your amber accent */
}
```

Import this CSS in the editor component:

```tsx
// At the top of rich-text-editor.tsx
import './rich-text-editor.css';
```

---

## Data Migration

### A.6 Content Format Migration

BlockNote uses a different JSON structure than TipTap. If you have existing SOP content in TipTap format, you'll need a migration utility.

**Create:** `/lib/content-migration.ts`

```typescript
/**
 * Migrates TipTap JSON content to BlockNote format.
 * Run this migration on existing SOP content.
 */

import { Block } from '@blocknote/core';

interface TipTapNode {
  type: string;
  content?: TipTapNode[];
  text?: string;
  attrs?: Record<string, any>;
  marks?: Array<{ type: string; attrs?: Record<string, any> }>;
}

interface TipTapDocument {
  type: 'doc';
  content: TipTapNode[];
}

/**
 * Convert TipTap document to BlockNote blocks
 */
export function migrateTipTapToBlockNote(tipTapDoc: TipTapDocument | null): Block[] | null {
  if (!tipTapDoc || !tipTapDoc.content) return null;

  const blocks: Block[] = [];

  for (const node of tipTapDoc.content) {
    const block = convertNode(node);
    if (block) {
      blocks.push(block);
    }
  }

  return blocks.length > 0 ? blocks : null;
}

function convertNode(node: TipTapNode): Block | null {
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
      return convertListItems(node, 'bulletListItem');

    case 'orderedList':
      return convertListItems(node, 'numberedListItem');

    case 'listItem':
      // List items are handled by their parent
      return null;

    case 'codeBlock':
      return {
        id: crypto.randomUUID(),
        type: 'codeBlock',
        props: { language: node.attrs?.language || 'text' },
        content: [{ type: 'text', text: getTextContent(node), styles: {} }],
        children: [],
      };

    case 'blockquote':
      // BlockNote doesn't have native blockquote, use paragraph with styling
      // Or implement a custom block
      return {
        id: crypto.randomUUID(),
        type: 'paragraph',
        content: convertInlineContent(node.content?.[0]?.content || []),
        children: [],
      };

    case 'image':
      return {
        id: crypto.randomUUID(),
        type: 'image',
        props: {
          url: node.attrs?.src || '',
          caption: node.attrs?.alt || '',
          width: node.attrs?.width,
        },
        children: [],
      };

    default:
      console.warn(`Unknown TipTap node type: ${node.type}`);
      return null;
  }
}

function convertListItems(
  listNode: TipTapNode,
  blockType: 'bulletListItem' | 'numberedListItem'
): Block | null {
  // BlockNote handles lists differently - each item is its own block
  // For migration, we return the first item and log a warning
  const firstItem = listNode.content?.[0];
  if (!firstItem) return null;

  return {
    id: crypto.randomUUID(),
    type: blockType,
    content: convertInlineContent(firstItem.content?.[0]?.content || []),
    children: [],
  };
}

function convertInlineContent(nodes: TipTapNode[]): any[] {
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

function getTextContent(node: TipTapNode): string {
  if (node.text) return node.text;
  if (!node.content) return '';
  return node.content.map(getTextContent).join('');
}

/**
 * Check if content is TipTap format (needs migration)
 */
export function isTipTapFormat(content: any): boolean {
  return content && typeof content === 'object' && content.type === 'doc';
}

/**
 * Check if content is BlockNote format
 */
export function isBlockNoteFormat(content: any): boolean {
  return Array.isArray(content);
}

/**
 * Auto-detect and migrate content if needed
 */
export function ensureBlockNoteFormat(content: any): Block[] | null {
  if (!content) return null;
  if (isBlockNoteFormat(content)) return content;
  if (isTipTapFormat(content)) return migrateTipTapToBlockNote(content);
  return null;
}
```

### A.6.1 Database Migration Script

If you have existing SOPs or Recipes with TipTap content, create a migration script:

**Create:** `/scripts/migrate-rich-text-content.ts`

```typescript
/**
 * One-time migration script to convert existing rich text content from TipTap to BlockNote
 * Affects: SOPs (content field), Recipes (documentation field)
 * 
 * Run with: npx ts-node scripts/migrate-rich-text-content.ts
 */

import { PrismaClient } from '@prisma/client';
import { migrateTipTapToBlockNote, isTipTapFormat } from '../lib/content-migration';

const prisma = new PrismaClient();

async function migrateSopContent() {
  console.log('\n--- Migrating SOP Content ---');

  const sops = await prisma.sop.findMany({
    where: { content: { not: null } },
    select: { id: true, title: true, content: true },
  });

  console.log(`Found ${sops.length} SOPs with content`);

  let migratedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const sop of sops) {
    try {
      if (!isTipTapFormat(sop.content)) {
        console.log(`  [SKIP] ${sop.title} - already BlockNote format or empty`);
        skippedCount++;
        continue;
      }

      const blockNoteContent = migrateTipTapToBlockNote(sop.content as any);

      if (!blockNoteContent) {
        console.log(`  [SKIP] ${sop.title} - no content to migrate`);
        skippedCount++;
        continue;
      }

      await prisma.sop.update({
        where: { id: sop.id },
        data: { content: blockNoteContent },
      });

      console.log(`  [OK] ${sop.title}`);
      migratedCount++;
    } catch (error) {
      console.error(`  [ERROR] ${sop.title}:`, error);
      errorCount++;
    }
  }

  console.log(`SOPs - Migrated: ${migratedCount}, Skipped: ${skippedCount}, Errors: ${errorCount}`);
}

async function migrateRecipeDocumentation() {
  console.log('\n--- Migrating Recipe Documentation ---');

  const recipes = await prisma.recipe.findMany({
    where: { documentation: { not: null } },
    select: { id: true, name: true, documentation: true },
  });

  console.log(`Found ${recipes.length} Recipes with documentation`);

  let migratedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const recipe of recipes) {
    try {
      if (!isTipTapFormat(recipe.documentation)) {
        console.log(`  [SKIP] ${recipe.name} - already BlockNote format or empty`);
        skippedCount++;
        continue;
      }

      const blockNoteContent = migrateTipTapToBlockNote(recipe.documentation as any);

      if (!blockNoteContent) {
        console.log(`  [SKIP] ${recipe.name} - no content to migrate`);
        skippedCount++;
        continue;
      }

      await prisma.recipe.update({
        where: { id: recipe.id },
        data: { documentation: blockNoteContent },
      });

      console.log(`  [OK] ${recipe.name}`);
      migratedCount++;
    } catch (error) {
      console.error(`  [ERROR] ${recipe.name}:`, error);
      errorCount++;
    }
  }

  console.log(`Recipes - Migrated: ${migratedCount}, Skipped: ${skippedCount}, Errors: ${errorCount}`);
}

async function main() {
  console.log('Starting rich text content migration (TipTap → BlockNote)...');
  
  await migrateSopContent();
  await migrateRecipeDocumentation();
  
  console.log('\n--- Migration Complete ---');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
```

---

## Custom Blocks

### A.7 Tool Embed Block (Optional)

If you want to embed Tool license information in SOPs (as designed in the original spec):

**Create:** `/components/ui/editor-blocks/tool-embed.tsx`

```tsx
'use client';

import { createReactBlockSpec } from '@blocknote/react';
import { defaultProps } from '@blocknote/core';
import { Key } from 'lucide-react';

// Component that renders the embedded tool
function ToolEmbed({ toolId, toolName }: { toolId: string; toolName?: string }) {
  // In real implementation, fetch tool data or use from context
  return (
    <div className="flex items-center gap-3 p-3 bg-stone-100 rounded-lg border border-stone-200">
      <div className="p-2 bg-amber-100 rounded">
        <Key className="h-4 w-4 text-amber-600" />
      </div>
      <div>
        <div className="text-sm font-medium text-stone-700">
          {toolName || 'Tool Reference'}
        </div>
        <div className="text-xs text-stone-500">
          License key will be displayed here
        </div>
      </div>
    </div>
  );
}

// Define the custom block
export const ToolEmbedBlock = createReactBlockSpec(
  {
    type: 'toolEmbed',
    propSchema: {
      toolId: {
        default: '',
      },
      toolName: {
        default: '',
      },
    },
    content: 'none',
  },
  {
    render: ({ block }) => (
      <ToolEmbed
        toolId={block.props.toolId}
        toolName={block.props.toolName}
      />
    ),
  }
);

// Add this to the schema in rich-text-editor.tsx:
// blockSpecs: {
//   ...defaultBlockSpecs,
//   toolEmbed: ToolEmbedBlock,
// },
```

### A.8 Add Tool Embed to Slash Menu

To make the tool embed insertable via slash command:

```tsx
// In rich-text-editor.tsx, add custom slash menu items:

import { getDefaultSlashMenuItems } from '@blocknote/react';

// Create custom slash menu items
const getCustomSlashMenuItems = (editor: typeof schema.BlockNoteEditor) => [
  ...getDefaultSlashMenuItems(editor),
  {
    title: 'Tool Reference',
    subtext: 'Embed a tool with license key',
    aliases: ['tool', 'license', 'key'],
    group: 'Embeds',
    icon: <Key className="h-4 w-4" />,
    onItemClick: () => {
      // Open a modal to select tool, then insert
      // For now, insert placeholder
      editor.insertBlocks(
        [
          {
            type: 'toolEmbed',
            props: { toolId: '', toolName: 'Select a tool...' },
          },
        ],
        editor.getTextCursorPosition().block,
        'after'
      );
    },
  },
];
```

---

## Update Existing Components

### A.8.1 Update Recipe Documentation Editor

Recipes also have a `documentation` field that uses the rich text editor.

**Update:** `/app/(app)/grimoire/rituals/[id]/page.tsx` (or wherever Recipe editing occurs)

```tsx
'use client';

import { RichTextEditor, RichTextRenderer } from '@/components/ui/rich-text-editor';

// In the Recipe detail/edit page, the documentation section should use:

// For editing (PM/Admin):
<RichTextEditor
  content={recipe.documentation}
  onChange={(doc) => setDocumentation(doc)}
  placeholder="Document the recipe workflow, handoffs, and key considerations..."
/>

// For viewing:
<RichTextRenderer content={recipe.documentation} />
```

**API Changes:** None needed - the `documentation` field already stores JSON. Just ensure the format is BlockNote-compatible after migration (see A.6.1 migration script which handles both SOPs and Recipes).

---

### A.9 Update SOP Editor Page

**Update:** `/app/(app)/grimoire/runes/[id]/edit/page.tsx`

```tsx
'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { RichTextEditor, BlockNoteContent } from '@/components/ui/rich-text-editor';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

export default function EditRunePage() {
  const { id } = useParams();
  const router = useRouter();
  const [content, setContent] = useState<BlockNoteContent | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    async function loadSop() {
      try {
        const response = await fetch(`/api/sops/${id}`);
        if (!response.ok) throw new Error('Failed to load SOP');
        const { data } = await response.json();
        setContent(data.content);
      } catch (error) {
        toast.error('Failed to load SOP');
      } finally {
        setIsLoading(false);
      }
    }
    loadSop();
  }, [id]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const response = await fetch(`/api/sops/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });

      if (!response.ok) throw new Error('Failed to save');

      toast.success('SOP saved');
      router.push(`/grimoire/runes/${id}`);
    } catch (error) {
      toast.error('Failed to save SOP');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <div className="p-8">Loading...</div>;
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-stone-800">Edit Rune</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-stone-200 min-h-[500px]">
        <RichTextEditor
          content={content}
          onChange={setContent}
          placeholder="Start documenting this procedure..."
        />
      </div>
    </div>
  );
}
```

### A.10 Update SOP Viewer Component

**Update:** `/components/domain/sops/SopViewer.tsx`

```tsx
'use client';

import { RichTextRenderer } from '@/components/ui/rich-text-editor';

interface SopViewerProps {
  content: any;
  className?: string;
}

export function SopViewer({ content, className = '' }: SopViewerProps) {
  if (!content) {
    return (
      <div className="text-stone-500 italic py-4">
        No documentation content yet.
      </div>
    );
  }

  return (
    <div className={className}>
      <RichTextRenderer content={content} />
    </div>
  );
}
```

---

## Testing

### A.11 Updated Test Cases

Update `/\_\_tests\_\_/integration/api/sops.test.ts` to use BlockNote format:

```typescript
describe('SOP Content (BlockNote format)', () => {
  const blockNoteContent = [
    {
      id: 'test-block-1',
      type: 'heading',
      props: { level: 1 },
      content: [{ type: 'text', text: 'Test Heading', styles: {} }],
      children: [],
    },
    {
      id: 'test-block-2',
      type: 'paragraph',
      content: [
        { type: 'text', text: 'This is ', styles: {} },
        { type: 'text', text: 'bold', styles: { bold: true } },
        { type: 'text', text: ' text.', styles: {} },
      ],
      children: [],
    },
  ];

  it('should save BlockNote content', async () => {
    const response = await fetch('/api/sops', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Test SOP',
        content: blockNoteContent,
      }),
    });

    expect(response.status).toBe(201);
    const { data } = await response.json();
    expect(data.content).toEqual(blockNoteContent);
  });

  it('should return content in BlockNote format', async () => {
    const response = await fetch(`/api/sops/${sopId}`);
    const { data } = await response.json();

    expect(Array.isArray(data.content)).toBe(true);
    expect(data.content[0]).toHaveProperty('type');
    expect(data.content[0]).toHaveProperty('content');
  });
});
```

---

## Acceptance Criteria

### Functionality - SOPs
- [ ] BlockNote editor loads and renders on SOP edit page
- [ ] Slash command menu appears on typing `/`
- [ ] Blocks can be dragged to reorder
- [ ] All standard blocks work: paragraph, headings, lists, code, images
- [ ] Read-only mode displays content without editing UI
- [ ] SOP content saves to database in BlockNote JSON format
- [ ] Existing TipTap SOP content is migrated (if applicable)

### Functionality - Recipes
- [ ] BlockNote editor loads on Recipe documentation section
- [ ] Recipe documentation saves correctly
- [ ] Read-only mode works for non-editors
- [ ] Existing TipTap Recipe documentation is migrated (if applicable)

### Functionality - Inline Editing
- [ ] Task name editable on click (text input)
- [ ] Task status editable on click (dropdown)
- [ ] Task assignee editable on click (user picker)
- [ ] Task priority editable on click (dropdown)
- [ ] Task due date editable on click (date picker)
- [ ] Task energy/mystery/battery editable on click
- [ ] Requirements items editable inline
- [ ] Enter saves, Escape cancels on all inline edits
- [ ] Blur saves value
- [ ] Optimistic updates with rollback on error
- [ ] BlockNote content autosaves with debounce

### Functionality - Review Requirements
- [ ] SOP edit page shows two separate requirement sections
- [ ] "Review Checklist" section clearly labeled as PM/Admin only
- [ ] Task creation copies both requirement types from SOP
- [ ] Tech users cannot see `review_requirements` in API responses
- [ ] Tech users cannot see review checklist in Task UI
- [ ] PM/Admin users see review checklist on Task detail
- [ ] Review items can be toggled complete by PM/Admin

### UX Matches Design System
- [ ] Colors use Indelible palette (warm off-white, stone, amber accents)
- [ ] Typography matches app typography
- [ ] No jarring style conflicts with Shadcn components
- [ ] Inline edit hover states are subtle and clear

### Performance
- [ ] Editor loads within 500ms
- [ ] No layout shift on load
- [ ] Large documents (50+ blocks) remain responsive
- [ ] Inline edits feel instant (optimistic updates)

---

## Rollback Plan

If BlockNote causes issues:

1. Keep the TipTap packages commented in `package.json` until migration is validated
2. Content migration script creates backups before modifying
3. The content format migration is reversible (BlockNote → TipTap utility can be written if needed)

---

## B. Additional Phase 7 Enhancements

The following features extend Phase 7 beyond the BlockNote migration.

---

## B.1 Pervasive Inline Editing

### Principle

**Click = Edit.** Every editable field should become editable immediately on click, without requiring an "Edit" button or opening a modal. This reduces friction and aligns with neurodivergent-optimized design principles (fewer clicks, faster context).

### Fields That Should Be Inline-Editable

| Entity | Field | Edit Interaction |
|--------|-------|------------------|
| **Task** | Name | Click → text input, blur/Enter saves |
| **Task** | Status | Click → dropdown, select saves |
| **Task** | Assignee | Click → user picker, select saves |
| **Task** | Priority | Click → dropdown, select saves |
| **Task** | Due Date | Click → date picker, select saves |
| **Task** | Energy Impact | Click → number input or slider |
| **Task** | Mystery Factor | Click → dropdown |
| **Task** | Battery Impact | Click → dropdown |
| **Task** | Phase | Click → dropdown |
| **Task** | Function | Click → dropdown |
| **Task** | Requirements | Click item → inline text edit |
| **Task** | Content area | Click → BlockNote editor activates |
| **Project** | Name | Click → text input |
| **Project** | Status | Click → dropdown |
| **Project** | Due Date | Click → date picker |
| **SOP** | Name | Click → text input |
| **SOP** | All metadata fields | Click → appropriate input |
| **Client** | All fields | Click → appropriate input |
| **Site** | All fields | Click → appropriate input |

### Component Pattern: `InlineEdit`

**Create:** `/components/ui/inline-edit.tsx`

```tsx
'use client';

import { useState, useRef, useEffect, ReactNode } from 'react';
import { Check, X } from 'lucide-react';

interface InlineEditProps {
  value: string;
  onSave: (value: string) => Promise<void> | void;
  renderDisplay?: (value: string) => ReactNode;
  renderInput?: (props: {
    value: string;
    onChange: (value: string) => void;
    onBlur: () => void;
    onKeyDown: (e: React.KeyboardEvent) => void;
    inputRef: React.RefObject<HTMLInputElement>;
  }) => ReactNode;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function InlineEdit({
  value,
  onSave,
  renderDisplay,
  renderInput,
  placeholder = 'Click to edit',
  disabled = false,
  className = '',
}: InlineEditProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  useEffect(() => {
    setEditValue(value);
  }, [value]);

  const handleSave = async () => {
    if (editValue === value) {
      setIsEditing(false);
      return;
    }

    setIsSaving(true);
    try {
      await onSave(editValue);
      setIsEditing(false);
    } catch (error) {
      // Revert on error
      setEditValue(value);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setEditValue(value);
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      handleCancel();
    }
  };

  if (disabled) {
    return (
      <span className={className}>
        {renderDisplay ? renderDisplay(value) : value || placeholder}
      </span>
    );
  }

  if (isEditing) {
    if (renderInput) {
      return renderInput({
        value: editValue,
        onChange: setEditValue,
        onBlur: handleSave,
        onKeyDown: handleKeyDown,
        inputRef,
      });
    }

    return (
      <div className="inline-flex items-center gap-1">
        <input
          ref={inputRef}
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleSave}
          onKeyDown={handleKeyDown}
          disabled={isSaving}
          className="px-2 py-1 border border-amber-400 rounded focus:outline-none focus:ring-2 focus:ring-amber-400/50 bg-white"
        />
      </div>
    );
  }

  return (
    <span
      onClick={() => setIsEditing(true)}
      className={`cursor-pointer hover:bg-stone-100 px-1 -mx-1 rounded transition-colors ${className}`}
      title="Click to edit"
    >
      {renderDisplay ? renderDisplay(value) : value || (
        <span className="text-stone-400 italic">{placeholder}</span>
      )}
    </span>
  );
}
```

### Component Pattern: `InlineSelect`

**Create:** `/components/ui/inline-select.tsx`

```tsx
'use client';

import { useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface Option {
  value: string;
  label: string;
  icon?: React.ReactNode;
  color?: string;
}

interface InlineSelectProps {
  value: string;
  options: Option[];
  onSave: (value: string) => Promise<void> | void;
  renderValue?: (option: Option | undefined) => React.ReactNode;
  disabled?: boolean;
  className?: string;
}

export function InlineSelect({
  value,
  options,
  onSave,
  renderValue,
  disabled = false,
  className = '',
}: InlineSelectProps) {
  const [isSaving, setIsSaving] = useState(false);
  const currentOption = options.find((o) => o.value === value);

  const handleChange = async (newValue: string) => {
    if (newValue === value) return;

    setIsSaving(true);
    try {
      await onSave(newValue);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Select value={value} onValueChange={handleChange} disabled={disabled || isSaving}>
      <SelectTrigger 
        className={`border-0 bg-transparent hover:bg-stone-100 focus:ring-0 h-auto p-1 -m-1 ${className}`}
      >
        {renderValue ? (
          renderValue(currentOption)
        ) : (
          <SelectValue />
        )}
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            <span className="flex items-center gap-2">
              {option.icon}
              {option.label}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
```

### Usage Example: Task Detail

```tsx
// In TaskDetail.tsx

function TaskMetadataBar({ task }: { task: Task }) {
  const { mutateAsync: updateTask } = useUpdateTask();

  return (
    <div className="flex items-center gap-4 text-sm">
      {/* Status - inline select */}
      <InlineSelect
        value={task.status}
        options={TASK_STATUS_OPTIONS}
        onSave={(status) => updateTask({ id: task.id, status })}
        renderValue={(opt) => <TaskStatusBadge status={opt?.value} />}
      />

      {/* Assignee - inline select */}
      <InlineSelect
        value={task.assignee_id || ''}
        options={userOptions}
        onSave={(assignee_id) => updateTask({ id: task.id, assignee_id })}
        renderValue={(opt) => <UserAvatar user={opt} size="sm" />}
      />

      {/* Priority - inline select */}
      <InlineSelect
        value={task.priority}
        options={PRIORITY_OPTIONS}
        onSave={(priority) => updateTask({ id: task.id, priority })}
        renderValue={(opt) => <PriorityBadge priority={opt?.value} />}
      />

      {/* Due Date - inline date picker */}
      <InlineDatePicker
        value={task.due_date}
        onSave={(due_date) => updateTask({ id: task.id, due_date })}
      />

      {/* Energy - inline number */}
      <InlineEdit
        value={String(task.energy_impact || '')}
        onSave={(val) => updateTask({ id: task.id, energy_impact: Number(val) })}
        renderDisplay={(val) => <span>⚡ {val || '—'}</span>}
      />
    </div>
  );
}
```

### Behavior Requirements

| Behavior | Implementation |
|----------|----------------|
| **Click to edit** | Single click activates edit mode |
| **Auto-focus** | Input receives focus immediately |
| **Select all** | Text is selected for easy replacement |
| **Blur saves** | Clicking away saves the value |
| **Enter saves** | Pressing Enter saves and exits edit mode |
| **Escape cancels** | Pressing Escape reverts changes |
| **Loading state** | Show subtle spinner during save |
| **Error handling** | Revert to previous value on error, show toast |
| **Optimistic update** | Update UI immediately, rollback on error |

### Autosave for Rich Text

For BlockNote content areas, use debounced autosave:

```tsx
function ContentEditor({ taskId, content }: { taskId: string; content: any }) {
  const { mutateAsync: updateTask } = useUpdateTask();
  const [localContent, setLocalContent] = useState(content);

  // Debounced save
  const debouncedSave = useDebouncedCallback(
    async (newContent: any) => {
      await updateTask({ id: taskId, content: newContent });
    },
    1000 // Save 1 second after last change
  );

  const handleChange = (newContent: any) => {
    setLocalContent(newContent);
    debouncedSave(newContent);
  };

  return (
    <RichTextEditor
      content={localContent}
      onChange={handleChange}
      placeholder="Add task details..."
    />
  );
}
```

---

## B.2 Review Requirements (PM-Only Checklist)

### Purpose

SOPs should have **two separate checklists**:

1. **Template Requirements** (existing) — Copied to tasks, visible to all roles
2. **Review Requirements** (new) — Copied to tasks, visible only to PM/Admin

This allows SOPs to include QA/review steps that the reviewer should verify before approving a task, without cluttering the Tech user's view.

### Schema Changes

**Update Prisma schema for SOP:**

```prisma
model Sop {
  id                    String   @id @default(uuid()) @db.Uuid
  title                 String   @db.VarChar(255)
  content               Json?
  
  // ... existing fields ...
  
  // Template requirements (copied to tasks, visible to all)
  template_requirements Json?
  
  // NEW: Review requirements (copied to tasks, visible to PM/Admin only)
  review_requirements   Json?
  
  // ... rest of model ...
}
```

**Update Prisma schema for Task:**

```prisma
model Task {
  id              String   @id @default(uuid()) @db.Uuid
  name            String   @db.VarChar(255)
  
  // ... existing fields ...
  
  // Requirements visible to all (from SOP template_requirements)
  requirements    Json?
  
  // NEW: Review requirements visible to PM/Admin only
  review_requirements Json?
  
  // ... rest of model ...
}
```

**Run migration:**

```bash
npx prisma migrate dev --name add_review_requirements
```

### Data Structure

Same structure as `template_requirements`:

```json
{
  "review_requirements": [
    {
      "id": "uuid",
      "text": "Verify responsive breakpoints work correctly",
      "completed": false,
      "completed_at": null,
      "completed_by": null,
      "sort_order": 1
    },
    {
      "id": "uuid", 
      "text": "Check cross-browser compatibility",
      "completed": false,
      "completed_at": null,
      "completed_by": null,
      "sort_order": 2
    }
  ]
}
```

### Task Creation Flow

When a Task is created from an SOP:

```typescript
// In task creation logic
function createTaskFromSop(sop: Sop, taskData: CreateTaskInput) {
  return {
    ...taskData,
    sop_id: sop.id,
    
    // Copy template requirements (visible to all)
    requirements: sop.template_requirements?.map((req) => ({
      id: crypto.randomUUID(),
      text: req.text,
      completed: false,
      completed_at: null,
      completed_by: null,
      sort_order: req.sort_order,
    })) || [],
    
    // Copy review requirements (visible to PM/Admin only)
    review_requirements: sop.review_requirements?.map((req) => ({
      id: crypto.randomUUID(),
      text: req.text,
      completed: false,
      completed_at: null,
      completed_by: null,
      sort_order: req.sort_order,
    })) || [],
  };
}
```

### API Response Filtering

**Update Task serialization** to hide `review_requirements` from Tech users:

```typescript
// In /api/tasks/[id]/route.ts or serialization layer

function serializeTask(task: Task, userRole: Role): TaskResponse {
  const serialized = {
    id: task.id,
    name: task.name,
    // ... other fields ...
    requirements: task.requirements,
  };

  // Only include review_requirements for PM/Admin
  if (userRole === 'pm' || userRole === 'admin') {
    serialized.review_requirements = task.review_requirements;
  }

  return serialized;
}
```

### UI Components

**Update SOP Detail page** to show both checklists:

```tsx
// In SOP edit/detail page

function SopRequirementsEditor({ sop }: { sop: Sop }) {
  return (
    <div className="space-y-8">
      {/* Template Requirements - visible to all when task is created */}
      <section>
        <h3 className="text-sm font-medium text-stone-700 mb-2">
          Task Requirements
        </h3>
        <p className="text-xs text-stone-500 mb-3">
          These will be visible to anyone assigned to the task.
        </p>
        <RequirementsEditor
          requirements={sop.template_requirements || []}
          onChange={(reqs) => updateSop({ template_requirements: reqs })}
        />
      </section>

      {/* Review Requirements - PM/Admin only */}
      <section>
        <h3 className="text-sm font-medium text-stone-700 mb-2 flex items-center gap-2">
          Review Checklist
          <Badge variant="outline" className="text-xs">PM/Admin only</Badge>
        </h3>
        <p className="text-xs text-stone-500 mb-3">
          These are only visible to reviewers (PM/Admin) and won't appear for Tech users.
        </p>
        <RequirementsEditor
          requirements={sop.review_requirements || []}
          onChange={(reqs) => updateSop({ review_requirements: reqs })}
        />
      </section>
    </div>
  );
}
```

**Update Task Detail page** to show review checklist for PM/Admin:

```tsx
// In Task detail Content tab

function TaskRequirements({ task, userRole }: { task: Task; userRole: Role }) {
  return (
    <div className="space-y-6">
      {/* Regular requirements - visible to all */}
      <section>
        <h4 className="text-sm font-medium text-stone-700 mb-2">
          Requirements
        </h4>
        <RequirementsList
          requirements={task.requirements || []}
          onToggle={handleToggleRequirement}
          editable={canEdit}
        />
      </section>

      {/* Review checklist - PM/Admin only */}
      {(userRole === 'pm' || userRole === 'admin') && task.review_requirements?.length > 0 && (
        <section className="border-t border-stone-200 pt-4">
          <h4 className="text-sm font-medium text-stone-700 mb-2 flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4" />
            Review Checklist
          </h4>
          <RequirementsList
            requirements={task.review_requirements}
            onToggle={handleToggleReviewRequirement}
            editable={true}
          />
        </section>
      )}
    </div>
  );
}
```

### Review Flow Integration

When a task is submitted for review, the reviewer sees the review checklist. Consider adding validation:

```typescript
// Optional: Require all review items checked before approving

function canApproveTask(task: Task): { allowed: boolean; reason?: string } {
  const uncheckedReviewItems = task.review_requirements?.filter(
    (req) => !req.completed
  );

  if (uncheckedReviewItems?.length > 0) {
    return {
      allowed: false,
      reason: `${uncheckedReviewItems.length} review item(s) not checked`,
    };
  }

  return { allowed: true };
}
```

### Acceptance Criteria - Review Requirements

- [ ] SOP edit page shows two separate requirement sections
- [ ] "Review Checklist" section clearly labeled as PM/Admin only
- [ ] Task creation copies both requirement types from SOP
- [ ] Tech users cannot see `review_requirements` in API responses
- [ ] Tech users cannot see review checklist in Task UI
- [ ] PM/Admin users see review checklist on Task detail
- [ ] Review items can be toggled complete by PM/Admin
- [ ] (Optional) Task approval blocked until review items complete

---

## References

- [BlockNote Documentation](https://www.blocknotejs.org/)
- [BlockNote GitHub](https://github.com/TypeCellOS/BlockNote)
- [Mantine UI](https://mantine.dev/) (required peer dependency)

---

*Phase 7 Addendum — BlockNote Migration — December 2024*