'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal, ModalBody, ModalContent, ModalDescription, ModalFooter, ModalHeader, ModalTitle } from '@/components/ui/modal';
import { useConfirmPublish, useCreatePublishIntent, type PublishGate, type PublishShown } from '@/lib/hooks/use-design-publish';

export const isProductionTone = (shown: Pick<PublishShown, 'main_role'> | null | undefined) => shown?.main_role !== 'client_preview';

/** What "live" is, in words, for the button: "Publish to the LIVE production site at <url>" or the client preview. */
export function publishButtonText(shown: Pick<PublishShown, 'main_role' | 'live_url'>): string {
  const at = shown.live_url ? ` at ${shown.live_url}` : '';
  return isProductionTone(shown) ? `Publish to the LIVE production site${at}` : `Publish to the client preview${at}`;
}

export function GateList({ status, entries }: { status: string; entries: PublishGate[] }) {
  if (entries.length === 0) {
    return (
      <p className="text-sm text-text-main" data-testid="gate-status">
        Gates: {status === 'green' ? 'all green' : status === 'red' ? 'red' : 'not reported'}
      </p>
    );
  }
  return (
    <ul className="space-y-1" aria-label="Gates" data-testid="gate-status">
      {entries.map((g) => (
        <li key={g.name} data-gate-ok={g.ok} className="flex items-baseline gap-2 text-sm">
          <span className={g.ok ? 'font-medium text-success' : 'font-medium text-error'}>{g.ok ? 'Green' : 'Red'}</span>
          <span className="text-text-main">{g.name}</span>
          {g.summary && <span className="text-xs text-text-sub">{g.summary}</span>}
        </li>
      ))}
    </ul>
  );
}

export function DiffFacts({ shown }: { shown: Pick<PublishShown, 'diff_summary' | 'files_changed' | 'pages_affected' | 'cost_usd'> }) {
  const d = shown.diff_summary;
  return (
    <dl className="space-y-2 text-sm">
      <div>
        <dt className="font-medium text-text-main">Files changed</dt>
        <dd className="text-text-sub" data-testid="diff-summary">
          {d.files_changed} {d.files_changed === 1 ? 'file' : 'files'}, +{d.insertions} / -{d.deletions}
        </dd>
        {shown.files_changed.length > 0 && (
          <dd>
            <ul className="mt-1 max-h-28 overflow-auto font-mono text-xs text-text-sub">
              {shown.files_changed.map((f) => <li key={f}>{f}</li>)}
            </ul>
          </dd>
        )}
      </div>
      <div>
        <dt className="font-medium text-text-main">Pages affected</dt>
        <dd className="text-text-sub" data-testid="pages-affected">{shown.pages_affected.length > 0 ? shown.pages_affected.join(', ') : 'None listed'}</dd>
      </div>
      <div>
        <dt className="font-medium text-text-main">Cost so far</dt>
        <dd className="text-text-sub">${shown.cost_usd.toFixed(2)}</dd>
      </div>
    </dl>
  );
}

function secondsLeft(expiresAt: string, now: number): number {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 1000));
}

export interface PublishConfirmDialogProps {
  sessionId: string;
  /** The head the designer is looking at; the server refuses a stale one. */
  headSha: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Defaults to a push to the publish page. */
  onPublished?: (publishId: string) => void;
}

export function PublishConfirmDialog({ sessionId, headSha, open, onOpenChange, onPublished }: PublishConfirmDialogProps) {
  const router = useRouter();
  const intent = useCreatePublishIntent(sessionId);
  const confirm = useConfirmPublish(sessionId);
  const [step, setStep] = React.useState<1 | 2>(1);
  const [typed, setTyped] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [now, setNow] = React.useState(() => Date.now());
  const { mutate: startIntent, data: review, error: intentError, isPending: reviewing, reset: resetIntent } = intent;

  const reviewAgain = React.useCallback(() => {
    setStep(1);
    setTyped('');
    setError(null);
    confirm.reset();
    if (headSha) startIntent(headSha);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headSha, startIntent]);

  React.useEffect(() => {
    if (open) reviewAgain();
    else {
      resetIntent();
      setStep(1);
      setTyped('');
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  React.useEffect(() => {
    if (!open || !review) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [open, review]);

  const shown = review?.shown ?? null;
  const production = isProductionTone(shown);
  const left = review ? secondsLeft(review.expires_at, now) : 0;
  const expired = !!review && left === 0;
  const matches = !!shown && typed === shown.main_branch;
  const canConfirm = !!review && !!review.confirmation_token && matches && !expired && !confirm.isPending;

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    // Never without a token and the exact branch name.
    if (!review || !review.confirmation_token || !shown || typed !== shown.main_branch || expired) return;
    setError(null);
    confirm.mutate(
      { publishId: review.publish_id, confirmation_token: review.confirmation_token, typed_confirmation: typed },
      {
        onSuccess: (res) => {
          onOpenChange(false);
          if (onPublished) onPublished(res.publish_id);
          else router.push(`/design/publishes/${res.publish_id}`);
        },
        onError: (e) => setError(e instanceof Error && e.message ? e.message : 'This could not be published.'),
      },
    );
  };

  const needsReviewAgain = !!error || expired;
  const toneBox = production ? 'border-error bg-error/10' : 'border-border-warm bg-background-light';

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent size="lg">
        <form onSubmit={submit} data-testid="publish-dialog" data-tone={shown ? (production ? 'production' : 'client_preview') : 'loading'}>
          <ModalHeader>
            <ModalTitle className={production && shown ? 'text-error' : undefined}>
              {shown ? (step === 1 ? `Review publish: ${shown.heading}` : 'Confirm publish') : 'Review publish'}
            </ModalTitle>
            <ModalDescription>
              {step === 1 ? 'Check what goes out before you publish.' : `Type ${shown?.main_branch ?? 'the main branch'} to confirm.`}
            </ModalDescription>
          </ModalHeader>
          <ModalBody className="space-y-4">
            {!headSha && <p className="text-sm text-text-sub">There is nothing to publish yet.</p>}
            {reviewing && <p className="text-sm text-text-sub">Checking the gates and the diff...</p>}
            {intentError && !reviewing && (
              <div role="alert" className="space-y-2 text-sm">
                <p className="text-error">{intentError instanceof Error ? intentError.message : 'Could not start the review.'}</p>
                <Button type="button" variant="secondary" size="sm" onClick={reviewAgain}>Review again</Button>
              </div>
            )}
            {shown && (
              <>
                <div className={`rounded-lg border p-3 ${toneBox}`} data-testid="publish-target" data-tone={production ? 'production' : 'client_preview'}>
                  {production && <p className="text-xs font-semibold uppercase tracking-wide text-error">Live production site</p>}
                  <p className={`text-sm ${production ? 'font-semibold text-error' : 'text-text-main'}`}>
                    This publishes to {shown.target_words}
                    {shown.live_url ? <>: <span className="break-all">{shown.live_url}</span></> : '.'}
                  </p>
                  {production && <p className="mt-1 text-xs text-text-sub">Real visitors see this the moment it deploys.</p>}
                </div>
                {step === 1 ? (
                  <>
                    <DiffFacts shown={shown} />
                    <GateList status={shown.gates.status} entries={shown.gates.entries} />
                  </>
                ) : (
                  <Input
                    label={shown.type_to_confirm}
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    autoFocus
                  />
                )}
                <p className="text-xs text-text-sub" data-testid="publish-countdown" aria-live="off">
                  {expired ? 'This review expired.' : `This review expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}.`}
                </p>
              </>
            )}
            {error && <p role="alert" className="text-sm text-error">{error}</p>}
          </ModalBody>
          <ModalFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            {needsReviewAgain && <Button type="button" variant="secondary" onClick={reviewAgain}>Review again</Button>}
            {shown && step === 1 && (
              <Button type="button" variant={production ? 'destructive' : 'primary'} disabled={expired} onClick={() => setStep(2)}>
                Continue
              </Button>
            )}
            {shown && step === 2 && (
              <Button type="submit" variant={production ? 'destructive' : 'primary'} disabled={!canConfirm}>
                {confirm.isPending ? 'Publishing...' : publishButtonText(shown)}
              </Button>
            )}
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}
