'use client';

import * as React from 'react';
import { Spinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';
import { parsePreviewInput, resolvePreviewUrl } from '@/lib/design/preview-path';
import { computeViewportScale } from '@/lib/design/viewport-scale';
import { ViewportSwitcher, viewportWidth, VIEWPORTS, type ViewportKey } from './ViewportSwitcher';

/** Exactly D7: scripts and same-origin for the overlay; no forms, no top navigation, no popups. */
export const PREVIEW_SANDBOX = 'allow-scripts allow-same-origin';

export interface PreviewPaneProps {
  previewUrl: string | null;
  status: string;
  liveText?: string | null;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  selectMode: boolean;
  onSelectModeChange: (on: boolean) => void;
  /** Path the frame last reported through the bridge; mirrors into the URL bar. */
  reportedPath?: string | null;
  /** Fires when the page path or the viewport width changes: what the designer is looking at. */
  onViewChange?: (view: { path: string; width: number }) => void;
}

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
}

export function PreviewPane({ previewUrl, status, liveText, iframeRef, selectMode, onSelectModeChange, reportedPath, onViewChange }: PreviewPaneProps) {
  const [viewport, setViewport] = React.useState<ViewportKey>('fit');
  const [framePath, setFramePath] = React.useState<string>('/');
  const [barText, setBarText] = React.useState('/');
  const [barError, setBarError] = React.useState<string | null>(null);
  const [lastReported, setLastReported] = React.useState<string | null>(null);

  // Mirror the frame's own navigation into the bar (does not change the iframe src).
  if (reportedPath && reportedPath !== lastReported) {
    setLastReported(reportedPath);
    setBarText(reportedPath);
    setBarError(null);
  }

  // The current page: what the frame reported, else the last path opened from the URL bar. Width: the chosen
  // preset, or for "fit" the measured wrapper width (1280 until measured).
  const wrapperRef = React.useRef<HTMLDivElement | null>(null);
  const [fitWidth, setFitWidth] = React.useState(1280);
  React.useEffect(() => {
    const el = wrapperRef.current;
    if (viewport !== 'fit' || !el) return;
    const measure = () => {
      const w = Math.round(el.getBoundingClientRect().width);
      if (w > 0) setFitWidth(w);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  });
  // The frame area: the iframe fills it, at the true selected width, scaled down when the area is narrower.
  const areaRef = React.useRef<HTMLDivElement | null>(null);
  const [area, setArea] = React.useState({ w: 0, h: 0 });
  React.useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const measure = () => {
      const w = Math.floor(el.clientWidth);
      const h = Math.floor(el.clientHeight);
      setArea((p) => (p.w === w && p.h === h ? p : { w, h }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  });
  const selectedWidth = VIEWPORTS.find((v) => v.key === viewport)?.width ?? null;
  const vs = computeViewportScale(area.w, selectedWidth);
  const currentPath = reportedPath || framePath;
  const currentWidth = VIEWPORTS.find((v) => v.key === viewport)?.width ?? fitWidth;
  const viewRef = React.useRef(onViewChange);
  React.useEffect(() => {
    viewRef.current = onViewChange;
  });
  React.useEffect(() => {
    viewRef.current?.({ path: currentPath, width: currentWidth });
  }, [currentPath, currentWidth]);

  const src = React.useMemo(() => {
    const url = resolvePreviewUrl(previewUrl, framePath);
    return url ? url.toString() : null;
  }, [previewUrl, framePath]);

  const host = React.useMemo(() => {
    try {
      return previewUrl ? new URL(previewUrl).host : '';
    } catch {
      return '';
    }
  }, [previewUrl]);

  const selectRef = React.useRef({ selectMode, onSelectModeChange });
  React.useEffect(() => {
    selectRef.current = { selectMode, onSelectModeChange };
  });

  // S toggles Select, Esc turns it off. Ignored while typing or with a modifier held.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      const { selectMode: on, onSelectModeChange: set } = selectRef.current;
      if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        set(!on);
      } else if (e.key === 'Escape' && on) {
        set(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function go(e: React.FormEvent) {
    e.preventDefault();
    const path = parsePreviewInput(previewUrl, barText);
    if (!path) {
      setBarError(`Only pages on ${host || 'the preview site'} can be opened here.`);
      return;
    }
    setBarError(null);
    setBarText(path);
    setFramePath(path);
  }

  if (!previewUrl || status === 'pending') {
    return (
      <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-3 rounded-lg border border-border-warm bg-surface p-6 text-center" role="status">
        <Spinner />
        <p className="text-sm font-medium text-text-main">Setting up your preview</p>
        <p className="max-w-sm text-xs text-text-sub">{liveText || 'Creating your branch and building the first preview. This usually takes a few minutes.'}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <form onSubmit={go} className="flex min-w-0 flex-1 items-center gap-2" aria-label="Preview address">
          <label htmlFor="preview-url-bar" className="sr-only">Preview path</label>
          <span className="hidden max-w-[40%] truncate text-xs text-text-sub sm:inline" title={host}>{host}</span>
          <input
            id="preview-url-bar"
            value={barText}
            onChange={(e) => setBarText(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={barError ? true : undefined}
            aria-describedby={barError ? 'preview-url-error' : undefined}
            className="min-h-[44px] min-w-0 flex-1 rounded-md border border-border-warm bg-surface px-3 text-sm text-text-main sm:min-h-9"
          />
          <Button type="submit" variant="secondary" size="sm">Go</Button>
        </form>
        <Button
          type="button"
          variant={selectMode ? 'primary' : 'secondary'}
          size="sm"
          aria-pressed={selectMode}
          onClick={() => onSelectModeChange(!selectMode)}
          title="Select an element (S). Esc turns it off."
        >
          Select
        </Button>
        <ViewportSwitcher value={viewport} onChange={setViewport} />
        {vs.scaled && (
          <span data-testid="scale-badge" className="rounded-md border border-border-warm bg-surface px-2 py-1 text-xs text-text-sub" title={`The page lays out at the true ${vs.layoutWidth}px and is shown smaller to fit`}>
            Scaled to {vs.percent}%
          </span>
        )}
      </div>
      {barError && (
        <p id="preview-url-error" role="alert" className="text-xs text-red-600">{barError}</p>
      )}
      <div ref={areaRef} className="relative min-h-[320px] flex-1 overflow-hidden rounded-lg border border-border-warm bg-background-light">
        <div
          ref={wrapperRef}
          data-testid="preview-frame-wrapper"
          data-scale={vs.scale}
          className={cn('mx-auto h-full overflow-hidden bg-white', viewport !== 'fit' && 'shadow-soft')}
          style={{ width: vs.scaled ? `${Math.floor(vs.layoutWidth * vs.scale)}px` : viewportWidth(viewport), maxWidth: '100%' }}
        >
          {src && (
            <iframe
              ref={iframeRef}
              title="Site preview"
              src={src}
              sandbox={PREVIEW_SANDBOX}
              // "origin", not "no-referrer": the overlay resolves its parent from document.referrer (design 9.2) and
              // stays inert without it. Only this Citadel origin is sent, never a path or query.
              referrerPolicy="origin"
              className="block border-0"
              style={
                vs.scaled || area.h > 0
                  ? { width: selectedWidth == null ? '100%' : `${vs.layoutWidth}px`, height: `${Math.ceil(area.h / vs.scale)}px`, transform: vs.scaled ? `scale(${vs.scale})` : undefined, transformOrigin: 'top left', maxWidth: 'none' }
                  : { width: '100%', height: '100%', minHeight: '420px' }
              }
            />
          )}
        </div>
        {status === 'publishing' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface/85" role="status" data-testid="publishing-overlay">
            <Spinner />
            <p className="text-sm font-medium text-text-main">Publishing...</p>
            <p className="text-xs text-text-sub">The preview is paused until the publish finishes.</p>
          </div>
        )}
      </div>
    </div>
  );
}
