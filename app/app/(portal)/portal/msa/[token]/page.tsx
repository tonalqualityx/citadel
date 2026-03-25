'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

interface MsaData {
  id: string;
  client: { name: string };
  msa_version: {
    version: string;
    content: string;
    effective_date: string;
  };
  already_signed: boolean;
  signed_at: string | null;
}

export default function MsaPortalPage() {
  const { token } = useParams<{ token: string }>();
  const [msa, setMsa] = useState<MsaData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [signed, setSigned] = useState(false);
  const [signerName, setSignerName] = useState('');
  const [signerEmail, setSignerEmail] = useState('');

  useEffect(() => {
    async function fetchMsa() {
      try {
        const res = await fetch(`/api/portal/msa/${token}`);
        if (!res.ok) {
          const data = await res.json();
          setError(data.error || 'MSA not found');
          return;
        }
        setMsa(await res.json());
      } catch {
        setError('Failed to load MSA');
      } finally {
        setLoading(false);
      }
    }
    fetchMsa();
  }, [token]);

  const handleSign = async (e: React.FormEvent) => {
    e.preventDefault();
    setSigning(true);
    try {
      const res = await fetch(`/api/portal/msa/${token}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signer_name: signerName, signer_email: signerEmail }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to sign MSA');
        return;
      }
      setSigned(true);
    } catch {
      setError('Failed to sign MSA');
    } finally {
      setSigning(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-text-secondary">Loading agreement...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-surface rounded-lg border border-border p-8 text-center">
        <h2 className="text-xl font-semibold text-text-main mb-2">Unable to load agreement</h2>
        <p className="text-text-secondary">{error}</p>
      </div>
    );
  }

  if (!msa) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-surface rounded-lg border border-border p-6">
        <h2 className="text-2xl font-bold text-text-main mb-1">Master Service Agreement</h2>
        <p className="text-text-secondary">For {msa.client.name}</p>
        <p className="text-sm text-text-tertiary mt-1">
          Version {msa.msa_version.version} &middot; Effective{' '}
          {new Date(msa.msa_version.effective_date).toLocaleDateString()}
        </p>
      </div>

      {/* MSA Content */}
      <div className="bg-surface rounded-lg border border-border p-6">
        <div className="prose prose-sm max-w-none text-text-main" dangerouslySetInnerHTML={{ __html: msa.msa_version.content }} />
      </div>

      {/* Signed confirmation */}
      {(msa.already_signed || signed) && (
        <div className="bg-status-success/10 rounded-lg border border-status-success/30 p-6 text-center">
          <h3 className="text-lg font-semibold text-text-main">
            {signed ? 'Agreement Signed' : 'Already Signed'}
          </h3>
          <p className="text-text-secondary mt-1">
            {signed
              ? 'Thank you for signing the agreement.'
              : `This agreement was signed on ${new Date(msa.signed_at!).toLocaleDateString()}.`}
          </p>
        </div>
      )}

      {/* Signing form */}
      {!msa.already_signed && !signed && (
        <div className="bg-surface rounded-lg border border-border p-6">
          <h3 className="text-lg font-semibold text-text-main mb-4">Sign Agreement</h3>
          <p className="text-sm text-text-secondary mb-4">
            By signing below, you agree to the terms outlined in this Master Service Agreement.
          </p>
          <form onSubmit={handleSign} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Full Name</label>
              <input
                type="text"
                required
                value={signerName}
                onChange={(e) => setSignerName(e.target.value)}
                placeholder="Your full legal name"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-text-main placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-brand-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Email Address</label>
              <input
                type="email"
                required
                value={signerEmail}
                onChange={(e) => setSignerEmail(e.target.value)}
                placeholder="your@email.com"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-text-main placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-brand-primary"
              />
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={signing || !signerName || !signerEmail}
                className="px-6 py-2 rounded-md bg-brand-primary text-white font-medium hover:bg-brand-primary/90 transition-colors disabled:opacity-50"
              >
                {signing ? 'Signing...' : 'Sign Agreement'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
