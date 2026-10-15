import * as React from 'react';
import { Pencil } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { draftBadgeLabel } from './intake-drawer-logic';

interface DraftBadgeProps {
  marker: { at: string; url: string };
  timezone: string;
  /** Test seam; defaults to the real clock. */
  now?: Date;
}

// Draft-started marker (Mike 2026-10-15): one click opens the half-written reply. The
// marker comes from draftMarker(), which only returns https://mail.google.com/ links.
export function DraftBadge({ marker, timezone, now }: DraftBadgeProps) {
  if (!marker.url.startsWith('https://mail.google.com/')) return null;
  return (
    <a
      href={marker.url}
      target="_blank"
      rel="noopener noreferrer"
      className="w-fit"
      data-testid="draft-badge"
    >
      <Badge variant="warning" className="gap-1 hover:opacity-80">
        <Pencil className="h-3 w-3" aria-hidden="true" />
        {draftBadgeLabel(marker.at, timezone, now ?? new Date())}
      </Badge>
    </a>
  );
}
