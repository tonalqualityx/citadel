'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Modal, ModalBody, ModalContent, ModalDescription, ModalFooter, ModalHeader, ModalTitle } from '@/components/ui/modal';
import { designKeys } from '@/lib/hooks/use-design';
import { DirectionError, directionKey, signDirection, type DirectionVersion, type MissingClientRequest } from '@/lib/hooks/use-design-direction';

export interface SignOffProps {
  sessionId: string;
  direction: DirectionVersion;
  stage: string;
  missing: MissingClientRequest[];
  /** Plain-language reasons the button is off (empty = ready). */
  reasons: string[];
  /** Start an answer for a missing client request. */
  onAnswer: (id: string) => void;
}

const POLARITY: Record<string, string> = { require: 'The client needs this', avoid: 'The client wants this avoided' };

/** The tab's own words for "someone saved while you were looking"; the form then shows the latest. */
export const MOVED_MESSAGE = 'This was just updated. Here is the latest.';

export function signErrorMessage(error: unknown): string {
  if (error instanceof DirectionError) {
    if (error.code === 'designer_only') return 'Only the designer on this project can sign off.';
    if (error.code === 'version_moved') return MOVED_MESSAGE;
    return error.message;
  }
  return 'Could not sign off. Try again.';
}

export function SignOff({ sessionId, direction, stage, missing, reasons, onAnswer }: SignOffProps) {
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<'refinements' | 'rebuild'>('refinements');
  const later = stage !== 'art_direction';
  const reasonsId = React.useId();
  // The version and revision on screen when the dialog opened: that is what she agrees to, so that is what is signed,
  // even if a newer one is fetched while the dialog is open.
  const [shown, setShown] = React.useState<{ version: number; revision: string } | null>(null);

  function openDialog() {
    setError(null);
    setShown({ version: direction.version, revision: direction.revision });
    setOpen(true);
  }

  // The direction moved under the open dialog (someone saved, and the refetch brought it in): close it, say so, and let
  // the form show the latest before she can sign again. Not while a sign is in flight: the server answers that one.
  React.useEffect(() => {
    if (!open || busy || !shown) return;
    if (direction.revision !== shown.revision || direction.version !== shown.version) {
      setOpen(false);
      setError(MOVED_MESSAGE);
    }
  }, [open, busy, shown, direction.revision, direction.version]);

  async function confirm() {
    if (!shown) return;
    setBusy(true);
    setError(null);
    try {
      await signDirection(sessionId, shown.version, later ? mode : undefined, shown.revision);
      setOpen(false);
      await Promise.all([qc.invalidateQueries({ queryKey: directionKey(sessionId) }), qc.invalidateQueries({ queryKey: designKeys.session(sessionId) })]);
    } catch (e) {
      setError(signErrorMessage(e));
      if (e instanceof DirectionError && e.code === 'version_moved') {
        setOpen(false);
        void qc.invalidateQueries({ queryKey: directionKey(sessionId) });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="signoff-title" className="rounded-xl border border-border-warm bg-surface p-4" data-testid="sign-off">
      <h3 id="signoff-title" className="text-base font-semibold text-text-main">Sign off</h3>
      {missing.length > 0 && (
        <div className="mt-3">
          <p className="text-sm font-medium text-text-main">Client requests still to answer</p>
          <ul className="mt-2 space-y-2" aria-label="Client requests still to answer">
            {missing.map((m) => (
              <li key={m.id} className="rounded-lg border border-border-warm p-3 text-sm" data-testid="missing-request">
                <p className="text-xs font-medium text-text-sub">{POLARITY[m.polarity ?? ''] ?? 'A client request'}{m.speaker_name ? `, from ${m.speaker_name}` : ''}</p>
                <blockquote className="mt-1 whitespace-pre-wrap break-words text-text-main">{m.quote}</blockquote>
                <Button type="button" variant="secondary" size="sm" className="mt-2 min-h-[44px] sm:min-h-0" onClick={() => onAnswer(m.id)}>
                  Answer this request
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-start gap-3">
        <Button type="button" disabled={reasons.length > 0} aria-describedby={reasonsId} className="min-h-[44px] sm:min-h-0" onClick={openDialog}>
          Sign off
        </Button>
        <div id={reasonsId} className="min-w-0 flex-1 text-sm text-text-sub" data-testid="sign-reasons">
          {reasons.length > 0 ? (
            <>
              <p className="font-medium text-text-main">Sign off is not ready yet:</p>
              <ul className="list-disc pl-5">{reasons.map((r) => <li key={r}>{r}</li>)}</ul>
            </>
          ) : (
            <p>Everything needed is filled in.</p>
          )}
        </div>
      </div>
      {error && !open && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}

      <Modal open={open} onOpenChange={(v) => { if (!busy) setOpen(v); }}>
        <ModalContent size="md">
          <ModalHeader>
            <ModalTitle>Sign off this direction?</ModalTitle>
            <ModalDescription>
              {later
                ? 'Signing fixes this version of the direction. The client and Mike receive it by email.'
                : 'Signing fixes the direction. The home page build starts, and the client and Mike receive the direction by email.'}
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            {later && (
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium text-text-main">What should happen to the home page?</legend>
                <label className="flex min-h-[44px] items-center gap-2 text-sm text-text-main">
                  <input type="radio" name="sign-mode" checked={mode === 'refinements'} onChange={() => setMode('refinements')} />
                  Apply the changes to the current home page
                </label>
                <label className="flex min-h-[44px] items-center gap-2 text-sm text-text-main">
                  <input type="radio" name="sign-mode" checked={mode === 'rebuild'} onChange={() => setMode('rebuild')} />
                  Rebuild the home page from this direction
                </label>
              </fieldset>
            )}
            {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
          </ModalBody>
          <ModalFooter>
            <Button type="button" variant="secondary" className="min-h-[44px] sm:min-h-0" disabled={busy} onClick={() => setOpen(false)}>Not yet</Button>
            <Button type="button" className="min-h-[44px] sm:min-h-0" disabled={busy} onClick={confirm}>{busy ? 'Signing' : 'Sign off'}</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </section>
  );
}
