# Phase 7: SOPs & Rich Text
## Detailed Implementation Guide for Claude Code

**Phase:** 7 of 10  
**Estimated Duration:** 2-3 days  
**Prerequisites:** Phase 6 complete (Recipe Wizard working)

---

## ðŸŽ¯ Phase Goal

Build SOP management with a rich text editor. By the end of this phase:
- SOPs can be created and edited with TipTap rich text editor
- SOPs can be linked to Functions and Tasks
- Tasks can reference SOPs and display their content
- Template requirements from SOPs populate task checklists

---

## ðŸ“š Required Reading

| Document | Sections to Focus On |
|----------|---------------------|
| `indelible-schema-addendum.md` | SOP template requirements |
| `indelible-api-endpoint-inventory.md` | SOP endpoints |
| `indelible-component-library.md` | Rich text editor component |

---

## ðŸ“‹ Phase Checklist

### 7.1 Extend Prisma Schema

#### 7.1.1 Add SOP Model

```prisma
// ============================================
// SOPS (STANDARD OPERATING PROCEDURES)
// ============================================

model Sop {
  id                    String   @id @default(uuid()) @db.Uuid
  title                 String   @db.VarChar(255)
  
  // Content (TipTap JSON format)
  content               Json?
  
  // Classification
  function_id           String?  @db.Uuid
  function              Function? @relation(fields: [function_id], references: [id])
  tags                  String[] @db.VarChar(50)
  
  // Time estimate
  estimated_minutes     Int?
  
  // Template requirements (copied to tasks)
  template_requirements Json?
  
  // Review tracking
  last_reviewed_at      DateTime?
  next_review_at        DateTime?
  
  // Metadata
  is_active             Boolean  @default(true)
  created_at            DateTime @default(now())
  updated_at            DateTime @updatedAt
  
  // Relations
  tasks                 Task[]
  recipe_tasks          RecipeTask[]
  
  @@index([function_id])
  @@map("sops")
}
```

- [ ] Run migration

---

### 7.2 TipTap Integration

#### 7.2.1 Install TipTap
```bash
npm install @tiptap/react @tiptap/starter-kit @tiptap/extension-link @tiptap/extension-image @tiptap/extension-placeholder @tiptap/extension-underline
```

#### 7.2.2 Create TipTap Editor Component
**Create `/components/ui/rich-text-editor.tsx`:**

```tsx
'use client';

import { useEditor, EditorContent, Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import Underline from '@tiptap/extension-underline';
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  List, ListOrdered, Link as LinkIcon, Image as ImageIcon,
  Heading1, Heading2, Heading3, Quote, Code, Undo, Redo
} from 'lucide-react';

interface RichTextEditorProps {
  content: any;
  onChange: (content: any) => void;
  placeholder?: string;
  readOnly?: boolean;
}

export function RichTextEditor({
  content,
  onChange,
  placeholder = 'Start writing...',
  readOnly = false,
}: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({
        openOnClick: false,
      }),
      Image,
      Placeholder.configure({
        placeholder,
      }),
    ],
    content,
    editable: !readOnly,
    onUpdate: ({ editor }) => {
      onChange(editor.getJSON());
    },
  });

  if (!editor) return null;

  if (readOnly) {
    return (
      <div className="prose prose-stone max-w-none">
        <EditorContent editor={editor} />
      </div>
    );
  }

  return (
    <div className="border border-stone-300 rounded-md overflow-hidden">
      <EditorToolbar editor={editor} />
      <div className="p-4 min-h-[300px]">
        <EditorContent editor={editor} className="prose prose-stone max-w-none" />
      </div>
    </div>
  );
}

function EditorToolbar({ editor }: { editor: Editor }) {
  return (
    <div className="flex flex-wrap gap-1 p-2 border-b border-stone-200 bg-stone-50">
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        active={editor.isActive('bold')}
        icon={<Bold className="h-4 w-4" />}
        title="Bold"
      />
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        active={editor.isActive('italic')}
        icon={<Italic className="h-4 w-4" />}
        title="Italic"
      />
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        active={editor.isActive('underline')}
        icon={<UnderlineIcon className="h-4 w-4" />}
        title="Underline"
      />
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleStrike().run()}
        active={editor.isActive('strike')}
        icon={<Strikethrough className="h-4 w-4" />}
        title="Strikethrough"
      />
      
      <div className="w-px h-6 bg-stone-300 mx-1" />
      
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        active={editor.isActive('heading', { level: 1 })}
        icon={<Heading1 className="h-4 w-4" />}
        title="Heading 1"
      />
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        active={editor.isActive('heading', { level: 2 })}
        icon={<Heading2 className="h-4 w-4" />}
        title="Heading 2"
      />
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        active={editor.isActive('heading', { level: 3 })}
        icon={<Heading3 className="h-4 w-4" />}
        title="Heading 3"
      />
      
      <div className="w-px h-6 bg-stone-300 mx-1" />
      
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        active={editor.isActive('bulletList')}
        icon={<List className="h-4 w-4" />}
        title="Bullet List"
      />
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        active={editor.isActive('orderedList')}
        icon={<ListOrdered className="h-4 w-4" />}
        title="Numbered List"
      />
      
      <div className="w-px h-6 bg-stone-300 mx-1" />
      
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        active={editor.isActive('blockquote')}
        icon={<Quote className="h-4 w-4" />}
        title="Quote"
      />
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        active={editor.isActive('codeBlock')}
        icon={<Code className="h-4 w-4" />}
        title="Code Block"
      />
      
      <div className="w-px h-6 bg-stone-300 mx-1" />
      
      <ToolbarButton
        onClick={() => editor.chain().focus().undo().run()}
        icon={<Undo className="h-4 w-4" />}
        title="Undo"
      />
      <ToolbarButton
        onClick={() => editor.chain().focus().redo().run()}
        icon={<Redo className="h-4 w-4" />}
        title="Redo"
      />
    </div>
  );
}

function ToolbarButton({
  onClick,
  active,
  icon,
  title,
}: {
  onClick: () => void;
  active?: boolean;
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`p-1.5 rounded hover:bg-stone-200 ${
        active ? 'bg-stone-200 text-amber-600' : 'text-stone-600'
      }`}
      title={title}
    >
      {icon}
    </button>
  );
}
```

#### 7.2.3 Create Read-Only Renderer
**Create `/components/ui/rich-text-renderer.tsx`:**
- [ ] Renders TipTap JSON as HTML
- [ ] Applies prose styling

---

### 7.3 SOP API Endpoints

#### 7.3.1 Implement Endpoints
- [ ] `GET /api/sops` â€” List with filters
- [ ] `GET /api/sops/:id` â€” Detail
- [ ] `POST /api/sops` â€” Create (PM/Admin)
- [ ] `PATCH /api/sops/:id` â€” Update (PM/Admin)
- [ ] `DELETE /api/sops/:id` â€” Soft delete
- [ ] `GET /api/sops/by-function/:functionId` â€” SOPs for function

---

### 7.4 SOP UI Components

#### 7.4.1 Grimoire Section
- [ ] `/app/(app)/grimoire/runes/page.tsx` â€” SOP list
- [ ] `/app/(app)/grimoire/runes/[id]/page.tsx` â€” SOP detail (view mode)
- [ ] `/app/(app)/grimoire/runes/[id]/edit/page.tsx` â€” SOP edit (TipTap)
- [ ] `/components/domain/sops/SopCard.tsx`
- [ ] `/components/domain/sops/SopList.tsx`
- [ ] `/components/domain/sops/SopViewer.tsx`
- [ ] `/components/domain/sops/SopEditor.tsx`

#### 7.4.2 SOP Reference on Tasks
- [ ] Show linked SOP on task detail
- [ ] Expand/collapse SOP content inline
- [ ] Link to full SOP page

---

### 7.5 Template Requirements

#### 7.5.1 SOP Requirements Editor
- [ ] Add/edit template requirements on SOP
- [ ] Requirements copied to tasks using this SOP
- [ ] Show preview of requirements

---

## ðŸ§ª Testing Requirements

### Integration Tests
- [ ] `/__tests__/integration/api/sops.test.ts`
  - CRUD operations
  - Content saves correctly (JSON)
  - Function linking works

---

## âœ… Phase 7 Acceptance Criteria

### Functionality
- [ ] TipTap editor works for creating/editing SOPs
- [ ] SOPs display correctly in read-only mode
- [ ] SOPs can be linked to Functions
- [ ] Tasks show linked SOP content
- [ ] Template requirements are defined on SOPs

---

## ðŸ”œ Next Phase

After completing Phase 7, proceed to **Phase 8: Notifications & Polish**.

---

*Phase 7 Document â€” Last Updated: December 2025*