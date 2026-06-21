'use client';

import * as React from 'react';
import { X, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { parseTags } from '@/lib/utils/task-tags';
import { cn } from '@/lib/utils/cn';

export interface TagEditorProps {
  /** Current tags (e.g. ["stack:eleventy", "kind:setup"]). */
  tags: string[] | null | undefined;
  /** Called with the full next list whenever a tag is added or removed. */
  onChange: (tags: string[]) => void;
  /** Placeholder for the add-tag input. */
  placeholder?: string;
  /** Max length per tag — matches the API's `z.string().max(50)`. */
  maxLength?: number;
  className?: string;
}

/**
 * Editable counterpart to the read-only {@link TagChips}. Renders each tag as a removable chip
 * (styled via `parseTag` so namespaces/triage state stay color-consistent) plus an input to add
 * new tags. Trims input, ignores empty/whitespace, and dedupes against existing tags.
 */
export function TagEditor({
  tags,
  onChange,
  placeholder = 'Add a tag…',
  maxLength = 50,
  className,
}: TagEditorProps) {
  const current = React.useMemo(
    () => (tags ?? []).filter((t) => t && t.trim().length > 0),
    [tags]
  );
  const parsed = parseTags(current);
  const [draft, setDraft] = React.useState('');

  const addTag = () => {
    const value = draft.trim().slice(0, maxLength).trim();
    if (!value) return;
    // Dedupe case-insensitively so "Stack:X" and "stack:x" don't both land.
    if (current.some((t) => t.toLowerCase() === value.toLowerCase())) {
      setDraft('');
      return;
    }
    onChange([...current, value]);
    setDraft('');
  };

  const removeTag = (raw: string) => {
    onChange(current.filter((t) => t !== raw));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTag();
    }
    if (e.key === 'Backspace' && draft.length === 0 && current.length > 0) {
      // Quick-remove the last tag when the input is empty.
      e.preventDefault();
      removeTag(current[current.length - 1]);
    }
  };

  return (
    <div className={cn('space-y-2', className)}>
      {parsed.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {parsed.map((tag) => (
            <Badge key={tag.raw} variant={tag.variant} size="default" title={tag.raw} className="gap-1">
              {tag.namespace && <span className="opacity-60">{tag.namespace}:</span>}
              {tag.label}
              <button
                type="button"
                onClick={() => removeTag(tag.raw)}
                className="ml-0.5 -mr-0.5 rounded-full p-0.5 opacity-70 hover:opacity-100 transition-opacity"
                aria-label={`Remove tag ${tag.raw}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          maxLength={maxLength}
          className="flex-1"
        />
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={addTag}
          disabled={!draft.trim()}
        >
          <Plus className="h-4 w-4 mr-1" />
          Add
        </Button>
      </div>
    </div>
  );
}
