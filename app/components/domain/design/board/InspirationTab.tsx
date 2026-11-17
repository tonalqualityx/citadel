'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { hasDesignFile, referenceRole, useBoardReferences } from '@/lib/hooks/use-design-board';
import type { TrackTabProps } from '../track-tab-props';
import { AddSite } from './AddSite';
import { ReferenceList } from './ReferenceList';

/** The Inspiration tab: sites, from Bast, the client or the designer. Cards work as they did on the Board. */
export function InspirationTab({ sessionId }: TrackTabProps) {
  const { data, isLoading, isError, refetch } = useBoardReferences(sessionId);
  const [announce, setAnnounce] = React.useState('');

  const all = data?.references ?? [];
  const refs = all.filter((r) => referenceRole(r) === 'inspiration');
  const hasDesign = hasDesignFile(all);

  return (
    // `relative` keeps the cards' visually hidden radio inputs (absolute) scrolling with the panel.
    <div className="relative space-y-4 p-3 sm:p-4" data-testid="inspiration-tab">
      <p role="status" aria-live="polite" className="sr-only">{announce}</p>

      {!isLoading && !isError && (
        <p className="text-sm text-text-sub" data-testid="inspiration-note">
          {hasDesign
            ? 'You have added your own design, so the build follows that. These sites are here for your reference only.'
            : 'These are used only when you ask for the design to be built from inspiration.'}
        </p>
      )}

      <AddSite sessionId={sessionId} onAdded={setAnnounce} />

      {isLoading && <p className="text-sm text-text-sub">Loading the sites.</p>}
      {isError && (
        <div role="alert" className="text-sm text-red-700">
          The sites did not load. <Button type="button" variant="link" size="sm" onClick={() => refetch()}>Try again</Button>
        </div>
      )}
      {!isLoading && !isError && refs.length === 0 && <p className="text-sm text-text-sub">No inspiration sites yet. Add a site you like, or wait for Bast&apos;s picks.</p>}

      <ReferenceList sessionId={sessionId} refs={refs} label="Inspiration cards" />
    </div>
  );
}
