'use client';

import { useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

// The client-portal magic-link request page. Reached directly by clients, and as a redirect
// target from the redeem route (?error=invalid) and from the portal home on a 401. The request
// API is intentionally non-enumerating — it always returns { requested: true } — so this page
// never reveals whether a given email matched a client contact.

type SubmitState = 'idle' | 'submitting' | 'submitted' | 'rate_limited';

function ExpiredLinkBanner() {
  const searchParams = useSearchParams();
  if (searchParams.get('error') !== 'invalid') return null;

  return (
    <div className="mb-6 rounded-lg border border-status-error/30 bg-status-error/10 p-4">
      <p className="text-sm text-text-main">
        That sign-in link has expired or already been replaced. Request a fresh one below.
      </p>
    </div>
  );
}

function PortalLoginForm() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<SubmitState>('idle');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState('submitting');

    try {
      const res = await fetch('/api/portal/login/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      if (res.status === 429) {
        setState('rate_limited');
        return;
      }

      // Non-enumerating by design: whether this was a 2xx or some other failure, we never
      // reveal whether the email matched a client contact. Show the same confirmation either way.
      setState('submitted');
    } catch {
      setState('submitted');
    }
  }

  const submitting = state === 'submitting';

  return (
    <div className="rounded-lg border border-border bg-surface p-6">
      <div aria-live="polite">
        {state === 'submitted' ? (
          <div className="text-center">
            <h2 className="text-xl font-semibold text-text-main mb-2">Check your inbox</h2>
            <p className="text-text-secondary">
              If your email is registered with us, a sign-in link is on its way. It stays valid
              for 7 days.
            </p>
          </div>
        ) : (
          <>
            <h2 className="text-xl font-semibold text-text-main mb-1">
              Sign in to the client portal
            </h2>
            <p className="text-sm text-text-secondary mb-6">
              Enter your email and we&apos;ll send you a secure sign-in link.
            </p>

            {state === 'rate_limited' && (
              <p className="mb-4 text-sm text-status-error">
                Too many requests — wait a minute and try again.
              </p>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="portal-login-email" className="block text-sm font-medium text-text-main mb-1">
                  Email address
                </label>
                <input
                  id="portal-login-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 text-text-main placeholder:text-text-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="w-full px-4 py-2 rounded-md bg-brand-primary text-white font-medium hover:bg-brand-primary/90 transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2"
              >
                {submitting ? 'Sending…' : 'Send me a sign-in link'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

export default function PortalLoginPage() {
  return (
    <div>
      <Suspense fallback={null}>
        <ExpiredLinkBanner />
      </Suspense>
      <PortalLoginForm />
    </div>
  );
}
