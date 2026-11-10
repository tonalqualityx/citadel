'use client';

import * as React from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useBoardReferences, useDecideReference } from '@/lib/hooks/use-design-board';
import type { TrackTabProps } from '../track-tab-props';
import { AddSite } from './AddSite';
import { ReferenceCard } from './ReferenceCard';
import { UploadPanel, useBoardUploads } from './UploadZone';

/** The Board tab: reference cards, yes and no, add a site, uploads, markup (SPEC 4.3). */
export function BoardTab({ sessionId }: TrackTabProps) {
  const { data, isLoading, isError, refetch } = useBoardReferences(sessionId);
  const decide = useDecideReference(sessionId);
  const [announce, setAnnounce] = React.useState('');
  const [dragging, setDragging] = React.useState(false);
  const [asideOpen, setAsideOpen] = React.useState(false);
  const asideId = React.useId();

  const refs = data?.references ?? [];
  const live = refs.filter((r) => r.decision !== 'no');
  const aside = refs.filter((r) => r.decision === 'no');
  const used = refs.reduce((n, r) => n + r.uploads.length, 0);
  const uploads = useBoardUploads(sessionId, used, setAnnounce);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length > 0) uploads.addFiles(files);
  };

  return (
    <div
      className="relative space-y-4 p-3 sm:p-4"
      data-testid="board-drop-zone"
      onDragOver={(e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
      onDrop={onDrop}
    >
      {dragging && <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 rounded-lg border-2 border-dashed border-primary bg-primary/10" />}
      <p role="status" aria-live="polite" className="sr-only">{announce}</p>

      <AddSite sessionId={sessionId} onAdded={setAnnounce} />
      <UploadPanel controls={uploads} />

      {isLoading && <p className="text-sm text-text-sub">Loading the board.</p>}
      {isError && (
        <div role="alert" className="text-sm text-red-700">
          The board did not load. <Button type="button" variant="link" size="sm" onClick={() => refetch()}>Try again</Button>
        </div>
      )}
      {!isLoading && !isError && refs.length === 0 && <p className="text-sm text-text-sub">Nothing on the board yet. Add a site or upload some samples to start.</p>}

      {live.length > 0 && (
        <ul className="space-y-4" aria-label="Board cards">
          {live.map((r) => <ReferenceCard key={r.id} sessionId={sessionId} reference={r} />)}
        </ul>
      )}

      {aside.length > 0 && (
        <section aria-label="Set aside" className="rounded-lg border border-border-warm bg-background-light p-3">
          <button
            type="button"
            aria-expanded={asideOpen}
            aria-controls={asideId}
            onClick={() => setAsideOpen((o) => !o)}
            className="flex min-h-[44px] items-center gap-2 rounded text-sm font-medium text-text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:min-h-9"
          >
            {asideOpen ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}
            Set aside ({aside.length})
          </button>
          {asideOpen && (
            <ul id={asideId} className="mt-2 space-y-2">
              {aside.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 text-sm text-text-main" data-testid="set-aside-item">
                  <span className="min-w-0 flex-1">{r.title}{r.decision_note ? <span className="text-text-sub"> - {r.decision_note}</span> : null}</span>
                  <Button type="button" size="sm" variant="secondary" className="min-h-[44px] sm:min-h-8" onClick={() => decide.mutate({ refId: r.id, decision: 'pending' })}>
                    Bring back<span className="sr-only"> {r.title}</span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
