'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Rocket, TriangleAlert } from 'lucide-react';
import { PortalButton } from '@/components/portal/ui/button';
import { Callout } from '@/components/portal/ui/callout';
import { EmptyState } from '@/components/portal/ui/empty-state';
import { Field } from '@/components/portal/ui/field';
import { Skeleton, SkeletonRegion } from '@/components/portal/ui/skeleton';
import { StatusChip } from '@/components/portal/ui/status-chip';

const EXPIRED_BODY = 'Ask us for a new one at support@becomeindelible.com.';

interface OnboardData {
  accord_name: string;
  lead_name: string | null;
  lead_business_name: string | null;
  lead_email: string | null;
  lead_phone: string | null;
  already_onboarded?: boolean;
}

export default function OnboardPortalPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<OnboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [primaryContact, setPrimaryContact] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch(`/api/portal/onboard/${token}`);
        if (!res.ok) {
          const d = await res.json();
          setError(d.error || 'Onboarding not available');
          return;
        }
        const d = await res.json();
        setData(d);
        // Pre-fill from lead info
        if (d.lead_business_name) setName(d.lead_business_name);
        if (d.lead_name) setPrimaryContact(d.lead_name);
        if (d.lead_email) setEmail(d.lead_email);
        if (d.lead_phone) setPhone(d.lead_phone);
      } catch {
        setError('Failed to load onboarding');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [token]);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/portal/onboard/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          primary_contact: primaryContact || undefined,
          email: email || undefined,
          phone: phone || undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error || 'Failed to submit');
        return;
      }
      setCompleted(true);
    } catch {
      setError('Failed to submit onboarding');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <SkeletonRegion>
        <Skeleton block />
        <Skeleton lines={4} />
      </SkeletonRegion>
    );
  }

  if (!data) {
    return <EmptyState art="meadow" title="This link has expired" body={EXPIRED_BODY} />;
  }

  if (data.already_onboarded || completed) {
    return (
      <>
        <header className="ph no-motif">
          <p className="eyebrow">Onboarding</p>
          <h1 className="h1">{completed ? 'Welcome aboard' : 'Already set up'}</h1>
          <div>
            <StatusChip tone="done" label="Set up" />
          </div>
        </header>
        <EmptyState
          art="meadow"
          title={completed ? 'Your account is ready' : 'Onboarding complete'}
          body={
            completed
              ? "Your account has been created. We'll be in touch with next steps."
              : `Onboarding for ${data.accord_name} has already been completed.`
          }
        />
      </>
    );
  }

  return (
    <>
      <header className="ph no-motif">
        <p className="eyebrow">Onboarding</p>
        <h1 className="h1">Welcome</h1>
        <p>Let&apos;s get your account set up for {data.accord_name}.</p>
        <div>
          <StatusChip tone="attention" label="Waiting for you" />
        </div>
      </header>

      {error ? (
        <Callout
          tone="urgent"
          icon={TriangleAlert}
          title="Something went wrong"
          note={`${error}. Try again, or write to support@becomeindelible.com.`}
        />
      ) : null}

      <Callout icon={Rocket} title="Start onboarding" note="Only the business name is required.">
        <PortalButton href="#setup-form">Go to the form</PortalButton>
      </Callout>

      <section className="card" id="setup-form" aria-labelledby="setup-h">
        <p className="eyebrow">Step 1 of 1</p>
        <h2 id="setup-h">Business information</h2>
        <Field id="business-name" label="Business name">
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your business name" />
        </Field>
        <Field id="primary-contact" label="Primary contact">
          <input
            type="text"
            value={primaryContact}
            onChange={(e) => setPrimaryContact(e.target.value)}
            placeholder="Contact person name"
          />
        </Field>
        <Field id="onboard-email" label="Email">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email@company.com"
          />
        </Field>
        <Field id="onboard-phone" label="Phone">
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 555-5555" />
        </Field>
        <div className="actions">
          <PortalButton
            variant="primary"
            onClick={handleSubmit}
            disabled={submitting || !name.trim()}
            busy={submitting}
            busyLabel="Setting up..."
          >
            Complete setup
          </PortalButton>
        </div>
      </section>
    </>
  );
}
