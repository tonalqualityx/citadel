'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';

// Portal sign-in. Standalone wording: a person arriving here cold, from an expired-session
// redirect or a bookmark, learns what this is and what to do without any other context.
function LoginForm() {
  const searchParams = useSearchParams();
  const linkProblem = searchParams.get('error') === 'invalid';
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/portal/login/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (res.status === 400) {
        setError('That does not look like an email address. Please check it and try again.');
        return;
      }
      if (!res.ok) {
        setError('Something went wrong on our end. Please try again in a minute.');
        return;
      }
      setSent(true);
    } catch {
      setError('We could not reach the server. Please check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <div className="max-w-md mx-auto bg-surface border border-border rounded-lg p-6">
        <h2 className="text-xl font-semibold text-text-main mb-2">Check your email</h2>
        <p className="text-sm text-text-sub">
          If {email.trim()} has access to the Indelible client portal, we have sent a sign-in link
          to it. The link works once and expires in 15 minutes. If nothing arrives, check your spam
          folder, or ask your Indelible contact to add you.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto bg-surface border border-border rounded-lg p-6">
      <h2 className="text-xl font-semibold text-text-main mb-2">Sign in to your Indelible portal</h2>
      <p className="text-sm text-text-sub mb-4">
        Enter the email address your Indelible team has on file for you. We will email you a
        one-time link to sign in. There is no password to remember.
      </p>
      {linkProblem && (
        <p role="alert" className="text-sm text-red-600 mb-4">
          That sign-in link has expired or was already used. Enter your email below and we will
          send a fresh one.
        </p>
      )}
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label htmlFor="portal-email" className="block text-sm font-medium text-text-main mb-1">
            Email address
          </label>
          <input
            id="portal-email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-main"
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={submitting || email.trim() === ''}
          className="w-full rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {submitting ? 'Sending...' : 'Email me a sign-in link'}
        </button>
      </form>
    </div>
  );
}

export default function PortalLoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
