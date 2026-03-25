'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

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
      <div className="flex items-center justify-center py-20">
        <div className="text-text-secondary">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-surface rounded-lg border border-border p-8 text-center">
        <h2 className="text-xl font-semibold text-text-main mb-2">Unable to load onboarding</h2>
        <p className="text-text-secondary">{error}</p>
      </div>
    );
  }

  if (!data) return null;

  if (data.already_onboarded || completed) {
    return (
      <div className="bg-status-success/10 rounded-lg border border-status-success/30 p-8 text-center">
        <h2 className="text-xl font-semibold text-text-main mb-2">
          {completed ? 'Welcome aboard!' : 'Already set up'}
        </h2>
        <p className="text-text-secondary">
          {completed
            ? 'Your account has been created. We\'ll be in touch with next steps.'
            : `Onboarding for ${data.accord_name} has already been completed.`}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-surface rounded-lg border border-border p-6">
        <h2 className="text-2xl font-bold text-text-main mb-1">Welcome!</h2>
        <p className="text-text-secondary">
          Let&apos;s get your account set up for <strong>{data.accord_name}</strong>.
        </p>
      </div>

      <div className="bg-surface rounded-lg border border-border p-6">
        <h3 className="text-lg font-semibold text-text-main mb-4">Business Information</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              Business Name <span className="text-status-error">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your business name"
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-text-main placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-brand-primary"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              Primary Contact
            </label>
            <input
              type="text"
              value={primaryContact}
              onChange={(e) => setPrimaryContact(e.target.value)}
              placeholder="Contact person name"
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-text-main placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-brand-primary"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@company.com"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-text-main placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-brand-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Phone</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(555) 555-5555"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-text-main placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-brand-primary"
              />
            </div>
          </div>
        </div>
        <div className="flex justify-end mt-6">
          <button
            onClick={handleSubmit}
            disabled={submitting || !name.trim()}
            className="px-6 py-2 rounded-md bg-brand-primary text-white hover:bg-brand-primary/90 transition-colors disabled:opacity-50"
          >
            {submitting ? 'Setting up...' : 'Complete Setup'}
          </button>
        </div>
      </div>
    </div>
  );
}
