'use client';

import * as React from 'react';
import { cn } from '@/lib/utils/cn';
import { deterministicCoverDataUri } from '@/lib/utils/deterministic-cover';

interface CoverBandProps {
  /** The item's already-resolved cover_url (set server-side at creation/backfill time —
   *  see lib/services/cover-assignment.ts). null/undefined renders nothing (pre-backfill
   *  state, or an item created before the assignment path existed). */
  coverUrl: string | null | undefined;
  /** The task/arc id — the stable hash key for the runtime SVG fallback, so a broken image
   *  always resolves to the SAME generated texture rather than flickering between renders. */
  itemId: string;
  className?: string;
}

// Clarity Phase 7 (Seeing Stone Reckoning) — the muted cover strip rendered on task and arc
// cards (TodayPickCard, ArcBoard's task cards, the arc workspace header). Deliberately a
// band ABOVE the card's text content, never behind it — the universal-design-readability
// reference is explicit ("no busy backgrounds, no imagery behind text"; meaning never in
// color alone). Low opacity keeps it reading as quiet texture rather than a photo competing
// for attention. If the stored URL fails to load (an external client og:image going dead is
// the realistic case — the bundled pool files never should), onError swaps to a generated,
// text-free, muted SVG so the card never shows a broken-image glyph.
export function CoverBand({ coverUrl, itemId, className }: CoverBandProps) {
  const [src, setSrc] = React.useState(coverUrl ?? null);

  React.useEffect(() => {
    setSrc(coverUrl ?? null);
  }, [coverUrl]);

  if (!src) return null;

  return (
    <div
      aria-hidden="true"
      data-testid="card-cover-band"
      className={cn('relative overflow-hidden', className)}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- a decorative, non-content
          background strip; next/image's remote-domain allowlist would need to cover every
          client site og:image host, which defeats the point of "any client site" here. */}
      <img
        src={src}
        alt=""
        className="h-full w-full object-cover opacity-25"
        onError={() => setSrc(deterministicCoverDataUri(itemId))}
      />
    </div>
  );
}
