'use client';

import { useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { ActionLink } from '@/components/portal/ui/action-link';
import { PortalButton } from '@/components/portal/ui/button';
import { ASK_FOR_CHANGE, CANCEL_BUSY, CANCEL_CONFIRM, CANCEL_ERROR, CANCEL_KEEP, CANCEL_LINK, CANCEL_YES, GOING_LIVE_NOTE, changeToText } from '@/lib/portal/cancel-copy';
import type { CancelMode } from '@/lib/portal/cancel-state';

// "Cancel this request" (Mike's ruling, 2026-10-21): a quiet text button, never a primary one, then
// an inline confirm. Live work offers "Ask for a change" instead, which opens a fresh request with
// the title carried in. A cancelled request offers nothing: its chip reads "Cancelled by you".
// Backed by POST /api/portal/work/:id/cancel.
export function CancelRequest({
  taskId, title, mode, onCancelled, onAuthLost,
}: {
  taskId: string;
  title: string;
  mode: CancelMode;
  onCancelled?: () => void;
  onAuthLost?: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (mode === 'cancelled') return null;
  if (mode === 'live') {
    return (
      <p className="cancel-request" data-testid="ask-for-change">
        <ActionLink href={`/portal/requests/new?change=${encodeURIComponent(changeToText(title))}`}>{ASK_FOR_CHANGE}</ActionLink>
      </p>
    );
  }
  if (mode === 'going_live') {
    return (
      <p className="meta cancel-request" data-testid="going-live-note">
        {GOING_LIVE_NOTE}
      </p>
    );
  }

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/portal/work/${taskId}/cancel`, { method: 'POST' });
      if (res.status === 401) {
        onAuthLost?.();
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
        setError(res.status === 409 && body.error ? body.error : CANCEL_ERROR);
        onCancelled?.();
        return;
      }
      setAsking(false);
      onCancelled?.();
    } catch {
      setError(CANCEL_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cancel-request" data-testid="cancel-request">
      {!asking ? (
        <PortalButton writes variant="quiet" onClick={() => setAsking(true)}>
          {CANCEL_LINK}
        </PortalButton>
      ) : (
        <div role="group" aria-label={CANCEL_LINK} className="cancel-confirm">
          <p className="strong">{CANCEL_CONFIRM}</p>
          <div className="actions">
            <PortalButton writes variant="secondary" busy={busy} busyLabel={CANCEL_BUSY} onClick={cancel}>
              {CANCEL_YES}
            </PortalButton>
            <PortalButton variant="quiet" disabled={busy} onClick={() => setAsking(false)}>
              {CANCEL_KEEP}
            </PortalButton>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="err">
          <TriangleAlert className="i" aria-hidden="true" focusable="false" />
          {error}
        </p>
      )}
    </div>
  );
}
