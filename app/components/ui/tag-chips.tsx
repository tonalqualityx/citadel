import * as React from 'react';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { cn } from '@/lib/utils/cn';
import { parseTags } from '@/lib/utils/task-tags';

export interface TagChipsProps {
  /** Raw tag strings (e.g. ["stack:eleventy", "awaiting-clarification"]). */
  tags: string[] | null | undefined;
  /** Badge size — defaults to "sm" for compact list/board rows. */
  size?: BadgeProps['size'];
  className?: string;
}

/**
 * Read-only display of a task's (or SOP's) tags as small chips. Namespaced classification tags
 * (`stack:`, `kind:`) render their namespace as a muted prefix; triage-state tags get a meaningful
 * color. Renders nothing when there are no tags.
 */
export function TagChips({ tags, size = 'sm', className }: TagChipsProps) {
  const parsed = parseTags(tags);
  if (parsed.length === 0) return null;

  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)}>
      {parsed.map((tag) => (
        <Badge key={tag.raw} variant={tag.variant} size={size} title={tag.raw}>
          {tag.namespace && (
            <span className="opacity-60 mr-1">{tag.namespace}:</span>
          )}
          {tag.label}
        </Badge>
      ))}
    </div>
  );
}
