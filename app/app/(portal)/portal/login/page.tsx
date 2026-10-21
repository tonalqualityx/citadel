'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Mail, TriangleAlert } from 'lucide-react';
import { PageHeader } from '@/components/portal/ui/page-header';
import { Field } from '@/components/portal/ui/field';
import { PortalButton } from '@/components/portal/ui/button';
import { Callout } from '@/components/portal/ui/callout';

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
      <>
        <PageHeader
          motif="meadow"
          title="Check your email"
          lede={`If ${email.trim()} has access to the Indelible client portal, we have sent a sign-in link to it. The link works once and expires soon.`}
        />
        <div className="card">
          <p>If nothing arrives, check your spam folder, or ask your Indelible contact to add you.</p>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        motif="meadow"
        title="Sign in to your Indelible portal"
        lede="We email you a link. No password to remember."
      />
      <form onSubmit={onSubmit} className="card">
        {linkProblem && (
          <Callout tone="urgent" icon={TriangleAlert} title="That sign-in link has expired or was already used">
            <p>Enter your email below and we will send a fresh one.</p>
          </Callout>
        )}
        <Field id="portal-email" label="Email address" hint="Use the address your Indelible team has on file for you." error={error}>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <PortalButton
          type="submit"
          icon={Mail}
          disabled={email.trim() === ''}
          busy={submitting}
          busyLabel="Sending"
        >
          Send me a link
        </PortalButton>
      </form>
    </>
  );
}

export default function PortalLoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
