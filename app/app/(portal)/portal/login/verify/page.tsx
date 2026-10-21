'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

// Interstitial for magic links. Opening this page consumes NOTHING; the token is spent only when
// the person presses the button, which POSTs to /api/portal/login/consume. Mail scanners and link
// previewers only ever GET, so they cannot burn the link.
function VerifyCard() {
  const token = useSearchParams().get('token') ?? '';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onContinue() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/portal/login/consume', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      if (res.ok) {
        const body: { redirect?: string } = await res.json();
        window.location.assign(body.redirect || '/portal');
        return;
      }
      setError(
        res.status === 401
          ? 'This sign-in link has expired or was already used. Request a new one and we will email it right away.'
          : 'Something went wrong on our end. Please try again in a minute.'
      );
    } catch {
      setError('We could not reach the server. Please check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <div className="max-w-md mx-auto bg-surface border border-border rounded-lg p-6">
        <h2 className="text-xl font-semibold text-text-main mb-2">This link is incomplete</h2>
        <p className="text-sm text-text-sub mb-4">
          The sign-in link is missing part of its address. Request a new one and we will email it
          to you.
        </p>
        <Link href="/portal/login" className="text-sm font-medium text-accent underline">
          Go to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto bg-surface border border-border rounded-lg p-6">
      <h2 className="text-xl font-semibold text-text-main mb-2">Finish signing in</h2>
      <p className="text-sm text-text-sub mb-4">
        Press the button to sign in to your Indelible client portal on this device.
      </p>
      {error && (
        <div role="alert" className="mb-4 text-sm text-red-600">
          <p>{error}</p>
          <Link href="/portal/login" className="font-medium underline">
            Request a new sign-in link
          </Link>
        </div>
      )}
      <button
        type="button"
        onClick={onContinue}
        disabled={busy}
        className="w-full rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? 'Signing in...' : 'Sign in to the portal'}
      </button>
    </div>
  );
}

export default function PortalLoginVerifyPage() {
  return (
    <Suspense fallback={null}>
      <VerifyCard />
    </Suspense>
  );
}
