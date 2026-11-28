'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Modal, ModalBody, ModalContent, ModalDescription, ModalFooter, ModalHeader, ModalTitle } from '@/components/ui/modal';
import { TRACK_BUILD_STAGES, useInferRest, type DesignSessionTrack } from '@/lib/hooks/use-design';

export interface BuildControlsProps {
  sessionId: string;
  track: DesignSessionTrack;
  /** Take her to the Figma link field and uploads on this tab. */
  onAddDesigns: () => void;
}

/** What tapping "Infer the rest" does, in her words. */
export const INFER_HELP = 'Infer the rest builds only the pages nobody has drawn or built yet, from your approved pages and library. It never changes a page you drew.';
export const ADD_HELP = 'Any design you add here is built as drawn, at any stage.';

/**
 * At every build stage (home, refine, rest of site, review): "Infer the rest" beside "Add more of my designs". One build
 * runs at a time on a track, so "Infer the rest" tapped while a build runs is held and starts when that build ends.
 */
export function BuildControls({ sessionId, track, onAddDesigns }: BuildControlsProps) {
  const infer = useInferRest(sessionId);
  const [open, setOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  if (!TRACK_BUILD_STAGES.includes(track.stage)) return null;
  const running = track.busy;
  const held = running && track.infer_requested === true;

  const confirm = () => {
    setError(null);
    infer.mutate(undefined, {
      onSuccess: () => setOpen(false),
      onError: (e) => {
        setOpen(false);
        setError(e instanceof Error && e.message ? e.message : 'Could not start. Try again.');
      },
    });
  };

  return (
    <section aria-labelledby="build-controls-title" className="rounded-xl border border-border-warm bg-surface p-4" data-testid="build-controls">
      <h3 id="build-controls-title" className="text-base font-semibold text-text-main">Keep building</h3>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" className="min-h-[44px] sm:min-h-0" disabled={held || infer.isPending} onClick={() => { setError(null); setOpen(true); }}>
          Infer the rest
        </Button>
        <Button type="button" variant="secondary" className="min-h-[44px] sm:min-h-0" onClick={onAddDesigns}>
          Add more of my designs
        </Button>
      </div>
      <p className="mt-2 text-sm text-text-sub">{INFER_HELP} {ADD_HELP}</p>
      {running && (
        <p className="mt-2 text-sm text-text-main" data-testid="build-running">
          {track.busy_line ?? 'Bast is building'}.{' '}
          {held ? 'Infer the rest starts when this build finishes.' : 'If you tap Infer the rest now, it starts when this build finishes.'}
        </p>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}

      <Modal open={open} onOpenChange={(v) => { if (!infer.isPending) setOpen(v); }}>
        <ModalContent size="md">
          <ModalHeader>
            <ModalTitle>Infer the rest of the site?</ModalTitle>
            <ModalDescription>{INFER_HELP}</ModalDescription>
          </ModalHeader>
          <ModalBody>
            {running ? (
              <p className="text-sm text-text-main">A build is running now. This starts when it finishes.</p>
            ) : track.stage === 'refine' && (
              <p className="text-sm text-text-main">This also tells Bast the home page is ready, and moves you on to the rest of the site.</p>
            )}
          </ModalBody>
          <ModalFooter>
            <Button type="button" variant="secondary" className="min-h-[44px] sm:min-h-0" disabled={infer.isPending} onClick={() => setOpen(false)}>Not yet</Button>
            <Button type="button" className="min-h-[44px] sm:min-h-0" disabled={infer.isPending} onClick={confirm}>{infer.isPending ? 'Starting' : 'Infer the rest'}</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </section>
  );
}
