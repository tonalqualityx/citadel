'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

interface ProposalData {
  id: string;
  version: number;
  content: string;
  status: string;
  pricing_snapshot: any[];
  sent_at: string | null;
  client_responded_at: string | null;
  accord: {
    name: string;
    client: { name: string } | null;
    owner: { name: string; email: string } | null;
    charter_items?: Array<{
      name: string;
      base_price: number;
      final_price: number;
      billing_period: string;
      duration_months: number;
      total_contract_value: number;
    }>;
    commission_items?: Array<{
      name: string;
      estimated_price: number | null;
      final_price: number | null;
    }>;
    keep_items?: Array<{
      site_name: string;
      hosting_final_price: number | null;
      maintenance_final_price: number | null;
      monthly_total: number | null;
    }>;
  };
}

export default function ProposalPortalPage() {
  const { token } = useParams<{ token: string }>();
  const [proposal, setProposal] = useState<ProposalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [responding, setResponding] = useState(false);
  const [responseNote, setResponseNote] = useState('');
  const [responded, setResponded] = useState(false);

  useEffect(() => {
    async function fetchProposal() {
      try {
        const res = await fetch(`/api/portal/proposals/${token}`);
        if (!res.ok) {
          const data = await res.json();
          setError(data.error || 'Proposal not found');
          return;
        }
        const data = await res.json();
        setProposal(data);
      } catch {
        setError('Failed to load proposal');
      } finally {
        setLoading(false);
      }
    }
    fetchProposal();
  }, [token]);

  const handleRespond = async (action: 'accept' | 'reject' | 'changes_requested') => {
    setResponding(true);
    try {
      const res = await fetch(`/api/portal/proposals/${token}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, note: responseNote || undefined }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to submit response');
        return;
      }
      setResponded(true);
      // Refresh data
      const refreshRes = await fetch(`/api/portal/proposals/${token}`);
      if (refreshRes.ok) {
        setProposal(await refreshRes.json());
      }
    } catch {
      setError('Failed to submit response');
    } finally {
      setResponding(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-text-secondary">Loading proposal...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-surface rounded-lg border border-border p-8 text-center">
        <h2 className="text-xl font-semibold text-text-main mb-2">Unable to load proposal</h2>
        <p className="text-text-secondary">{error}</p>
      </div>
    );
  }

  if (!proposal) return null;

  const charterItems = proposal.accord.charter_items || [];
  const commissionItems = proposal.accord.commission_items || [];
  const keepItems = proposal.accord.keep_items || [];
  const hasItems = charterItems.length > 0 || commissionItems.length > 0 || keepItems.length > 0;
  const alreadyResponded = proposal.status !== 'sent';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-surface rounded-lg border border-border p-6">
        <h2 className="text-2xl font-bold text-text-main mb-1">{proposal.accord.name}</h2>
        {proposal.accord.client && (
          <p className="text-text-secondary">Prepared for {proposal.accord.client.name}</p>
        )}
        <p className="text-sm text-text-tertiary mt-1">Version {proposal.version}</p>
      </div>

      {/* Content */}
      {proposal.content && (
        <div className="bg-surface rounded-lg border border-border p-6">
          <h3 className="text-lg font-semibold text-text-main mb-4">Proposal Details</h3>
          <div className="prose prose-sm max-w-none text-text-main" dangerouslySetInnerHTML={{ __html: proposal.content }} />
        </div>
      )}

      {/* Pricing */}
      {hasItems && (
        <div className="bg-surface rounded-lg border border-border p-6">
          <h3 className="text-lg font-semibold text-text-main mb-4">Pricing</h3>

          {/* Charter items */}
          {charterItems.length > 0 && (
            <div className="mb-4">
              <h4 className="text-sm font-medium text-text-secondary mb-2">Recurring Services</h4>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 text-sm font-medium text-text-secondary">Service</th>
                    <th className="text-right py-2 text-sm font-medium text-text-secondary">Price</th>
                    <th className="text-right py-2 text-sm font-medium text-text-secondary">Billing</th>
                    <th className="text-right py-2 text-sm font-medium text-text-secondary">Total Value</th>
                  </tr>
                </thead>
                <tbody>
                  {charterItems.map((item, i) => (
                    <tr key={i} className="border-b border-border/50">
                      <td className="py-3 text-text-main">{item.name}</td>
                      <td className="py-3 text-right text-text-main">${item.final_price.toLocaleString()}</td>
                      <td className="py-3 text-right text-text-main">{item.billing_period}</td>
                      <td className="py-3 text-right font-medium text-text-main">${item.total_contract_value.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Commission items */}
          {commissionItems.length > 0 && (
            <div className="mb-4">
              <h4 className="text-sm font-medium text-text-secondary mb-2">Project Services</h4>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 text-sm font-medium text-text-secondary">Service</th>
                    <th className="text-right py-2 text-sm font-medium text-text-secondary">Price</th>
                  </tr>
                </thead>
                <tbody>
                  {commissionItems.map((item, i) => (
                    <tr key={i} className="border-b border-border/50">
                      <td className="py-3 text-text-main">{item.name}</td>
                      <td className="py-3 text-right font-medium text-text-main">
                        {item.final_price ? `$${item.final_price.toLocaleString()}` : 'TBD'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Keep items */}
          {keepItems.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-text-secondary mb-2">Hosting & Maintenance</h4>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 text-sm font-medium text-text-secondary">Site</th>
                    <th className="text-right py-2 text-sm font-medium text-text-secondary">Monthly</th>
                  </tr>
                </thead>
                <tbody>
                  {keepItems.map((item, i) => (
                    <tr key={i} className="border-b border-border/50">
                      <td className="py-3 text-text-main">{item.site_name}</td>
                      <td className="py-3 text-right font-medium text-text-main">
                        {item.monthly_total ? `$${item.monthly_total.toLocaleString()}/mo` : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Status / Response */}
      {responded && (
        <div className="bg-status-success/10 rounded-lg border border-status-success/30 p-6 text-center">
          <h3 className="text-lg font-semibold text-text-main">Response submitted</h3>
          <p className="text-text-secondary mt-1">Thank you for your response. We&apos;ll be in touch shortly.</p>
        </div>
      )}

      {alreadyResponded && !responded && (
        <div className="bg-surface rounded-lg border border-border p-6 text-center">
          <p className="text-text-secondary">
            This proposal has been <span className="font-medium">{proposal.status.replace('_', ' ')}</span>.
          </p>
        </div>
      )}

      {!alreadyResponded && !responded && (
        <div className="bg-surface rounded-lg border border-border p-6">
          <h3 className="text-lg font-semibold text-text-main mb-4">Your Response</h3>
          <div className="mb-4">
            <label className="block text-sm font-medium text-text-secondary mb-1">
              Notes (optional)
            </label>
            <textarea
              value={responseNote}
              onChange={(e) => setResponseNote(e.target.value)}
              placeholder="Any comments or questions..."
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-text-main placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-brand-primary"
              rows={3}
            />
          </div>
          <div className="flex gap-3 justify-end">
            <button
              onClick={() => handleRespond('changes_requested')}
              disabled={responding}
              className="px-4 py-2 rounded-md border border-border text-text-main hover:bg-surface-secondary transition-colors disabled:opacity-50"
            >
              Request Changes
            </button>
            <button
              onClick={() => handleRespond('reject')}
              disabled={responding}
              className="px-4 py-2 rounded-md bg-status-error text-white hover:bg-status-error/90 transition-colors disabled:opacity-50"
            >
              Decline
            </button>
            <button
              onClick={() => handleRespond('accept')}
              disabled={responding}
              className="px-4 py-2 rounded-md bg-brand-primary text-white hover:bg-brand-primary/90 transition-colors disabled:opacity-50"
            >
              Accept Proposal
            </button>
          </div>
        </div>
      )}

      {/* Contact */}
      {proposal.accord.owner && (
        <div className="text-center text-sm text-text-tertiary">
          Questions? Contact {proposal.accord.owner.name} at{' '}
          <a href={`mailto:${proposal.accord.owner.email}`} className="text-brand-primary hover:underline">
            {proposal.accord.owner.email}
          </a>
        </div>
      )}
    </div>
  );
}
