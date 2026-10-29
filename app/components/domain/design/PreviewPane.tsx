'use client';

import * as React from 'react';
import { Spinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';
import { parsePreviewInput, resolvePreviewUrl } from '@/lib/design/preview-path';
import { ViewportSwitcher, viewportWidth, type ViewportKey } from './ViewportSwitcher';

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
}

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
}

export function PreviewPane({ previewUrl, status, liveText, iframeRef, selectMode, onSelectModeChange, reportedPath }: PreviewPaneProps) {
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
      </div>
      {barError && (
        <p id="preview-url-error" role="alert" className="text-xs text-red-600">{barError}</p>
      )}
      <div className="relative min-h-[420px] flex-1 overflow-auto rounded-lg border border-border-warm bg-background-light">
        <div
          data-testid="preview-frame-wrapper"
          className={cn('mx-auto h-full min-h-[420px] bg-white', viewport !== 'fit' && 'shadow-soft')}
          style={{ width: viewportWidth(viewport), maxWidth: '100%' }}
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
              className="h-full min-h-[420px] w-full border-0"
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
