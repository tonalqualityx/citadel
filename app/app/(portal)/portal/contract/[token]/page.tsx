'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

interface ContractData {
  id: string;
  version: number;
  content: string;
  status: string;
  pricing_snapshot: any[];
  sent_at: string | null;
  signed_at: string | null;
  accord: {
    name: string;
    client: { name: string } | null;
    owner: { name: string; email: string } | null;
    charter_items?: Array<{
      name: string;
      final_price: number;
      billing_period: string;
      duration_months: number;
      total_contract_value: number;
    }>;
    commission_items?: Array<{
      name: string;
      type: string | null;
      final_price: number | null;
    }>;
    keep_items?: Array<{
      site_name: string;
      hosting_final_price: number | null;
      maintenance_final_price: number | null;
      monthly_total: number | null;
    }>;
  };
  msa_version: { version: string } | null;
}

export default function ContractPortalPage() {
  const { token } = useParams<{ token: string }>();
  const [contract, setContract] = useState<ContractData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [signed, setSigned] = useState(false);
  const [signerName, setSignerName] = useState('');
  const [signerEmail, setSignerEmail] = useState('');

  useEffect(() => {
    async function fetchContract() {
      try {
        const res = await fetch(`/api/portal/contracts/${token}`);
        if (!res.ok) {
          const data = await res.json();
          setError(data.error || 'Contract not found');
          return;
        }
        const data = await res.json();
        setContract(data);
      } catch {
        setError('Failed to load contract');
      } finally {
        setLoading(false);
      }
    }
    fetchContract();
  }, [token]);

  const handleSign = async () => {
    if (!signerName.trim() || !signerEmail.trim()) return;
    setSigning(true);
    try {
      const res = await fetch(`/api/portal/contracts/${token}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signer_name: signerName, signer_email: signerEmail }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to sign contract');
        return;
      }
      setSigned(true);
      // Refresh data
      const refreshRes = await fetch(`/api/portal/contracts/${token}`);
      if (refreshRes.ok) {
        setContract(await refreshRes.json());
      }
    } catch {
      setError('Failed to sign contract');
    } finally {
      setSigning(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-text-secondary">Loading contract...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-surface rounded-lg border border-border p-8 text-center">
        <h2 className="text-xl font-semibold text-text-main mb-2">Unable to load contract</h2>
        <p className="text-text-secondary">{error}</p>
      </div>
    );
  }

  if (!contract) return null;

  const charterItems = contract.accord.charter_items || [];
  const commissionItems = contract.accord.commission_items || [];
  const keepItems = contract.accord.keep_items || [];
  const hasItems = charterItems.length > 0 || commissionItems.length > 0 || keepItems.length > 0;
  const alreadySigned = contract.status === 'signed';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-surface rounded-lg border border-border p-6">
        <h2 className="text-2xl font-bold text-text-main mb-1">{contract.accord.name}</h2>
        {contract.accord.client && (
          <p className="text-text-secondary">Prepared for {contract.accord.client.name}</p>
        )}
        <div className="flex items-center gap-4 mt-2">
          <span className="text-sm text-text-tertiary">Version {contract.version}</span>
          {contract.msa_version && (
            <span className="text-sm text-text-tertiary">MSA {contract.msa_version.version}</span>
          )}
        </div>
      </div>

      {/* Contract Content */}
      {contract.content && (
        <div className="bg-surface rounded-lg border border-border p-6">
          <h3 className="text-lg font-semibold text-text-main mb-4">Contract Details</h3>
          <div className="prose prose-sm max-w-none text-text-main" dangerouslySetInnerHTML={{ __html: contract.content }} />
        </div>
      )}

      {/* Pricing */}
      {hasItems && (
        <div className="bg-surface rounded-lg border border-border p-6">
          <h3 className="text-lg font-semibold text-text-main mb-4">Pricing</h3>

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

          {commissionItems.length > 0 && (
            <div className="mb-4">
              <h4 className="text-sm font-medium text-text-secondary mb-2">Project Services</h4>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 text-sm font-medium text-text-secondary">Service</th>
                    <th className="text-left py-2 text-sm font-medium text-text-secondary">Type</th>
                    <th className="text-right py-2 text-sm font-medium text-text-secondary">Price</th>
                  </tr>
                </thead>
                <tbody>
                  {commissionItems.map((item, i) => (
                    <tr key={i} className="border-b border-border/50">
                      <td className="py-3 text-text-main">{item.name}</td>
                      <td className="py-3 text-text-secondary text-sm">{item.type || '-'}</td>
                      <td className="py-3 text-right font-medium text-text-main">
                        {item.final_price ? `$${item.final_price.toLocaleString()}` : 'TBD'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {keepItems.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-text-secondary mb-2">Hosting & Maintenance</h4>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 text-sm font-medium text-text-secondary">Site</th>
                    <th className="text-right py-2 text-sm font-medium text-text-secondary">Hosting</th>
                    <th className="text-right py-2 text-sm font-medium text-text-secondary">Maintenance</th>
                    <th className="text-right py-2 text-sm font-medium text-text-secondary">Monthly</th>
                  </tr>
                </thead>
                <tbody>
                  {keepItems.map((item, i) => (
                    <tr key={i} className="border-b border-border/50">
                      <td className="py-3 text-text-main">{item.site_name}</td>
                      <td className="py-3 text-right text-text-main">
                        {item.hosting_final_price ? `$${item.hosting_final_price.toLocaleString()}` : '-'}
                      </td>
                      <td className="py-3 text-right text-text-main">
                        {item.maintenance_final_price ? `$${item.maintenance_final_price.toLocaleString()}` : '-'}
                      </td>
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

      {/* Signed confirmation */}
      {signed && (
        <div className="bg-status-success/10 rounded-lg border border-status-success/30 p-6 text-center">
          <h3 className="text-lg font-semibold text-text-main">Contract Signed</h3>
          <p className="text-text-secondary mt-1">Thank you for signing. We&apos;ll be in touch with next steps.</p>
        </div>
      )}

      {/* Already signed */}
      {alreadySigned && !signed && (
        <div className="bg-surface rounded-lg border border-border p-6 text-center">
          <p className="text-text-secondary">
            This contract has been <span className="font-medium">signed</span>
            {contract.signed_at && ` on ${new Date(contract.signed_at).toLocaleDateString()}`}.
          </p>
        </div>
      )}

      {/* Signing form */}
      {!alreadySigned && !signed && (
        <div className="bg-surface rounded-lg border border-border p-6">
          <h3 className="text-lg font-semibold text-text-main mb-4">Sign Contract</h3>
          <p className="text-sm text-text-secondary mb-4">
            By signing below, you agree to the terms outlined in this contract and the referenced Master Service Agreement.
          </p>
          <div className="space-y-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">
                Full Name <span className="text-status-error">*</span>
              </label>
              <input
                type="text"
                value={signerName}
                onChange={(e) => setSignerName(e.target.value)}
                placeholder="Your full name"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-text-main placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-brand-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">
                Email Address <span className="text-status-error">*</span>
              </label>
              <input
                type="email"
                value={signerEmail}
                onChange={(e) => setSignerEmail(e.target.value)}
                placeholder="your@email.com"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-text-main placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-brand-primary"
              />
            </div>
          </div>
          <div className="flex justify-end">
            <button
              onClick={handleSign}
              disabled={signing || !signerName.trim() || !signerEmail.trim()}
              className="px-6 py-2 rounded-md bg-brand-primary text-white hover:bg-brand-primary/90 transition-colors disabled:opacity-50"
            >
              {signing ? 'Signing...' : 'Sign Contract'}
            </button>
          </div>
        </div>
      )}

      {/* Contact */}
      {contract.accord.owner && (
        <div className="text-center text-sm text-text-tertiary">
          Questions? Contact {contract.accord.owner.name} at{' '}
          <a href={`mailto:${contract.accord.owner.email}`} className="text-brand-primary hover:underline">
            {contract.accord.owner.email}
          </a>
        </div>
      )}
    </div>
  );
}
