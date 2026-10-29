'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { diffImageUrls, type PixelDiffResult } from '@/lib/design/pixel-diff';

export const COMPARE_WIDTHS = [390, 768, 1280] as const;

export interface WidthPair {
  width: number;
  beforeId: string;
  afterId: string;
}

export const assetUrl = (sessionId: string, assetId: string) => `/api/design/sessions/${sessionId}/assets/${assetId}`;

/**
 * Pair a change's before/after asset ids per viewport width. Widths come from the session's `screenshot` events
 * (`asset_ids[i]` was shot at `widths[i]`); when no event names an id, the i-th asset is taken as the i-th width
 * of 390/768/1280.
 */
export function pairAssetsByWidth(
  change: { before_asset_ids?: string[]; after_asset_ids?: string[] },
  events: Array<{ kind: string; payload: unknown }>,
): WidthPair[] {
  const before = change.before_asset_ids ?? [];
  const after = change.after_asset_ids ?? [];
  const widthOf = new Map<string, number>();
  for (const e of events) {
    if (e.kind !== 'screenshot') continue;
    const p = e.payload as { asset_ids?: unknown; widths?: unknown } | null;
    if (!p || !Array.isArray(p.asset_ids) || !Array.isArray(p.widths)) continue;
    p.asset_ids.forEach((id, i) => {
      const w = (p.widths as unknown[])[i];
      if (typeof id === 'string' && typeof w === 'number') widthOf.set(id, w);
    });
  }
  const known = [...before, ...after].some((id) => widthOf.has(id));
  const pairs: WidthPair[] = [];
  for (const [i, w] of COMPARE_WIDTHS.entries()) {
    const b = known ? before.find((id) => widthOf.get(id) === w) : before[i];
    const a = known ? after.find((id) => widthOf.get(id) === w) : after[i];
    if (b && a) pairs.push({ width: w, beforeId: b, afterId: a });
  }
  return pairs;
}

export interface BeforeAfterProps {
  sessionId: string;
  pairs: WidthPair[];
  /** Injectable for tests. */
  diff?: (beforeUrl: string, afterUrl: string) => Promise<PixelDiffResult>;
}

export function BeforeAfter({ sessionId, pairs, diff = diffImageUrls }: BeforeAfterProps) {
  const [width, setWidth] = React.useState<number>(pairs[0]?.width ?? COMPARE_WIDTHS[0]);
  const [pos, setPos] = React.useState(50);
  const [showDiff, setShowDiff] = React.useState(false);
  const [result, setResult] = React.useState<PixelDiffResult | null>(null);
  const [failed, setFailed] = React.useState(false);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

  const pair = pairs.find((p) => p.width === width) ?? pairs[0];
  const beforeUrl = pair ? assetUrl(sessionId, pair.beforeId) : null;
  const afterUrl = pair ? assetUrl(sessionId, pair.afterId) : null;

  React.useEffect(() => {
    if (!showDiff || !beforeUrl || !afterUrl) return;
    let cancelled = false;
    setResult(null);
    setFailed(false);
    diff(beforeUrl, afterUrl).then(
      (r) => !cancelled && setResult(r),
      () => !cancelled && setFailed(true),
    );
    return () => {
      cancelled = true;
    };
  }, [showDiff, beforeUrl, afterUrl, diff]);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !result) return;
    canvas.width = result.width;
    canvas.height = result.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.putImageData(new ImageData(result.overlay as Uint8ClampedArray<ArrayBuffer>, result.width, result.height), 0, 0);
  }, [result]);

  if (!pair || !beforeUrl || !afterUrl) {
    return <p className="text-sm text-text-sub">No before and after screenshots for this change.</p>;
  }

  return (
    <div className="flex flex-col gap-2" data-testid="before-after">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Viewport width" className="flex gap-1">
          {pairs.map((p) => (
            <Button key={p.width} type="button" size="sm" variant={p.width === pair.width ? 'primary' : 'secondary'} aria-pressed={p.width === pair.width} onClick={() => setWidth(p.width)}>
              {p.width}
            </Button>
          ))}
        </div>
        <Button type="button" size="sm" variant="secondary" aria-pressed={showDiff} onClick={() => setShowDiff((v) => !v)}>
          {showDiff ? 'Hide pixel diff' : 'Show pixel diff'}
        </Button>
        {showDiff && result && (
          <span className="text-xs text-text-sub" data-testid="diff-count">
            {result.count} {result.count === 1 ? 'pixel differs' : 'pixels differ'}
            {result.sizeMismatch ? ' (sizes differ, overlap compared)' : ''}
          </span>
        )}
        {showDiff && failed && <span className="text-xs text-text-sub">The diff could not be computed.</span>}
      </div>

      <div className="relative overflow-hidden rounded-lg border border-border-warm bg-background-light">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={beforeUrl} alt={`Before at ${pair.width}px`} className="block w-full" />
        <div className="absolute inset-0" style={{ clipPath: `inset(0 0 0 ${pos}%)` }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={afterUrl} alt={`After at ${pair.width}px`} className="block w-full" />
        </div>
        <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-primary" style={{ left: `${pos}%` }} aria-hidden="true" />
        {showDiff && result && <canvas ref={canvasRef} aria-label="Pixel diff" className="pointer-events-none absolute inset-0 h-full w-full" />}
      </div>

      <label className="flex items-center gap-2 text-xs text-text-sub">
        Before
        <input
          type="range"
          min={0}
          max={100}
          value={pos}
          aria-label="Before and after slider"
          className="flex-1"
          onChange={(e) => setPos(Number(e.target.value))}
        />
        After
      </label>
    </div>
  );
}
