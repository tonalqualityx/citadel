'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { referenceRole, useBoardReferences } from '@/lib/hooks/use-design-board';
import type { TrackTabProps } from '../track-tab-props';
import { AddFigma } from './AddFigma';
import { ReferenceList } from './ReferenceList';
import { UploadPanel, useBoardUploads } from './UploadZone';

/** The Board tab: the designer's own design files. Figma frames and uploads, yes and no, markup (SPEC 4.3). Sites are on the Inspiration tab. */
export function BoardTab({ sessionId }: TrackTabProps) {
  const { data, isLoading, isError, refetch } = useBoardReferences(sessionId);
  const [announce, setAnnounce] = React.useState('');
  const [dragging, setDragging] = React.useState(false);

  const all = data?.references ?? [];
  const refs = all.filter((r) => referenceRole(r) === 'design_file');
  // The 100-upload limit counts every card on the track, whichever tab shows it.
  const used = all.reduce((n, r) => n + r.uploads.length, 0);
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

      <AddFigma sessionId={sessionId} onAdded={setAnnounce} />
      <UploadPanel controls={uploads} />

      {isLoading && <p className="text-sm text-text-sub">Loading the board.</p>}
      {isError && (
        <div role="alert" className="text-sm text-red-700">
          The board did not load. <Button type="button" variant="link" size="sm" onClick={() => refetch()}>Try again</Button>
        </div>
      )}
      {!isLoading && !isError && refs.length === 0 && <p className="text-sm text-text-sub">Nothing here yet. Paste a Figma link or upload your designs to start.</p>}

      <ReferenceList sessionId={sessionId} refs={refs} label="Board cards" />
    </div>
  );
}
