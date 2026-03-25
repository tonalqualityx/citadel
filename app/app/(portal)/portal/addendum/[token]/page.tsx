'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

interface AddendumData {
  id: string;
  version: number;
  title: string;
  description: string;
  contract_content: string;
  status: string;
  changes: any;
  pricing_snapshot: any;
  sent_at: string | null;
  signed_at: string | null;
  client_responded_at: string | null;
  client_note: string | null;
  accord: {
    name: string;
    client: { name: string } | null;
    owner: { name: string; email: string } | null;
  };
}

type ResponseAction = 'accepted' | 'rejected' | 'changes_requested';

export default function AddendumPortalPage() {
  const { token } = useParams<{ token: string }>();
  const [addendum, setAddendum] = useState<AddendumData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [responseAction, setResponseAction] = useState<ResponseAction | null>(null);
  const [signerName, setSignerName] = useState('');
  const [signerEmail, setSignerEmail] = useState('');
  const [clientNote, setClientNote] = useState('');

  useEffect(() => {
    async function fetchAddendum() {
      try {
        const res = await fetch(`/api/portal/addendums/${token}`);
        if (!res.ok) {
          const data = await res.json();
          setError(data.error || 'Addendum not found');
          return;
        }
        const data = await res.json();
        setAddendum(data);
      } catch {
        setError('Failed to load addendum');
      } finally {
        setLoading(false);
      }
    }
    fetchAddendum();
  }, [token]);

  const handleRespond = async (action: ResponseAction) => {
    if (action === 'accepted' && (!signerName.trim() || !signerEmail.trim())) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/portal/addendums/${token}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          signer_name: action === 'accepted' ? signerName : undefined,
          signer_email: action === 'accepted' ? signerEmail : undefined,
          client_note: clientNote || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to submit response');
        return;
      }
      setSubmitted(true);
      setResponseAction(action);
      // Refresh data
      const refreshRes = await fetch(`/api/portal/addendums/${token}`);
      if (refreshRes.ok) {
        setAddendum(await refreshRes.json());
      }
    } catch {
      setError('Failed to submit response');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-text-secondary">Loading addendum...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-surface rounded-lg border border-border p-8 text-center">
        <h2 className="text-xl font-semibold text-text-main mb-2">Unable to load addendum</h2>
        <p className="text-text-secondary">{error}</p>
      </div>
    );
  }

  if (!addendum) return null;

  const alreadyResponded = addendum.status !== 'sent';
  const pricing = addendum.pricing_snapshot;
  const changes = addendum.changes;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-surface rounded-lg border border-border p-6">
        <h2 className="text-2xl font-bold text-text-main mb-1">{addendum.accord.name}</h2>
        {addendum.accord.client && (
          <p className="text-text-secondary">Prepared for {addendum.accord.client.name}</p>
        )}
        <div className="flex items-center gap-4 mt-2">
          <span className="text-sm text-text-tertiary">
            Addendum v{addendum.version}: {addendum.title}
          </span>
        </div>
      </div>

      {/* Description */}
      <div className="bg-surface rounded-lg border border-border p-6">
        <h3 className="text-lg font-semibold text-text-main mb-2">Description</h3>
        <p className="text-text-secondary text-sm">{addendum.description}</p>
      </div>

      {/* Contract Content */}
      {addendum.contract_content && (
        <div className="bg-surface rounded-lg border border-border p-6">
          <h3 className="text-lg font-semibold text-text-main mb-4">Addendum Terms</h3>
          <div
            className="prose prose-sm max-w-none text-text-main"
            dangerouslySetInnerHTML={{ __html: addendum.contract_content }}
          />
        </div>
      )}

      {/* Changes Summary */}
      {changes && (
        <div className="bg-surface rounded-lg border border-border p-6">
          <h3 className="text-lg font-semibold text-text-main mb-4">Changes</h3>
          {Array.isArray(changes) ? (
            <ul className="space-y-2">
              {changes.map((change: any, i: number) => (
                <li key={i} className="flex items-start gap-2 text-sm text-text-main">
                  <span className="font-medium capitalize">{change.type || 'Change'}:</span>
                  <span>{change.item || change.description || JSON.stringify(change)}</span>
                  {change.price != null && (
                    <span className="ml-auto font-medium">${Number(change.price).toLocaleString()}</span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <pre className="text-sm text-text-secondary whitespace-pre-wrap">
              {typeof changes === 'string' ? changes : JSON.stringify(changes, null, 2)}
            </pre>
          )}
        </div>
      )}

      {/* Pricing */}
      {pricing && (
        <div className="bg-surface rounded-lg border border-border p-6">
          <h3 className="text-lg font-semibold text-text-main mb-4">Pricing</h3>
          {Array.isArray(pricing) ? (
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 text-sm font-medium text-text-secondary">Item</th>
                  <th className="text-right py-2 text-sm font-medium text-text-secondary">Price</th>
                  <th className="text-right py-2 text-sm font-medium text-text-secondary">Qty</th>
                  <th className="text-right py-2 text-sm font-medium text-text-secondary">Total</th>
                </tr>
              </thead>
              <tbody>
                {pricing.map((item: any, i: number) => (
                  <tr key={i} className="border-b border-border/50">
                    <td className="py-3 text-text-main">
                      <div>{item.name || item.item}</div>
                      {item.description && (
                        <div className="text-sm text-text-tertiary">{item.description}</div>
                      )}
                    </td>
                    <td className="py-3 text-right text-text-main">
                      ${Number(item.price || 0).toLocaleString()}
                    </td>
                    <td className="py-3 text-right text-text-main">{item.quantity || 1}</td>
                    <td className="py-3 text-right font-medium text-text-main">
                      ${Number(item.total || item.price || 0).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <pre className="text-sm text-text-secondary whitespace-pre-wrap">
              {typeof pricing === 'string' ? pricing : JSON.stringify(pricing, null, 2)}
            </pre>
          )}
        </div>
      )}

      {/* Success confirmation */}
      {submitted && (
        <div className="bg-status-success/10 rounded-lg border border-status-success/30 p-6 text-center">
          <h3 className="text-lg font-semibold text-text-main">
            {responseAction === 'accepted'
              ? 'Addendum Accepted'
              : responseAction === 'rejected'
                ? 'Addendum Rejected'
                : 'Changes Requested'}
          </h3>
          <p className="text-text-secondary mt-1">
            {responseAction === 'accepted'
              ? "Thank you for accepting. We'll proceed with the updated scope."
              : responseAction === 'rejected'
                ? "We've received your response. We'll be in touch."
                : "We've received your feedback and will revise the addendum."}
          </p>
        </div>
      )}

      {/* Already responded */}
      {alreadyResponded && !submitted && (
        <div className="bg-surface rounded-lg border border-border p-6 text-center">
          <p className="text-text-secondary">
            This addendum has been{' '}
            <span className="font-medium">{addendum.status.replace('_', ' ')}</span>
            {addendum.client_responded_at &&
              ` on ${new Date(addendum.client_responded_at).toLocaleDateString()}`}
            .
          </p>
          {addendum.client_note && (
            <p className="text-text-tertiary text-sm mt-2">Note: {addendum.client_note}</p>
          )}
        </div>
      )}

      {/* Response form */}
      {!alreadyResponded && !submitted && (
        <div className="bg-surface rounded-lg border border-border p-6">
          <h3 className="text-lg font-semibold text-text-main mb-4">Respond to Addendum</h3>
          <p className="text-sm text-text-secondary mb-4">
            Please review the addendum terms above and provide your response below.
          </p>

          {/* Signer info (for accept) */}
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
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">
                Note <span className="text-text-tertiary">(optional)</span>
              </label>
              <textarea
                value={clientNote}
                onChange={(e) => setClientNote(e.target.value)}
                placeholder="Any comments or requested changes..."
                rows={3}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-text-main placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-brand-primary resize-none"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button
              onClick={() => handleRespond('changes_requested')}
              disabled={submitting}
              className="px-4 py-2 rounded-md border border-border text-text-main hover:bg-surface-hover transition-colors disabled:opacity-50"
            >
              {submitting ? 'Submitting...' : 'Request Changes'}
            </button>
            <button
              onClick={() => handleRespond('rejected')}
              disabled={submitting}
              className="px-4 py-2 rounded-md bg-status-error/10 text-status-error border border-status-error/30 hover:bg-status-error/20 transition-colors disabled:opacity-50"
            >
              {submitting ? 'Submitting...' : 'Reject'}
            </button>
            <button
              onClick={() => handleRespond('accepted')}
              disabled={submitting || !signerName.trim() || !signerEmail.trim()}
              className="px-6 py-2 rounded-md bg-brand-primary text-white hover:bg-brand-primary/90 transition-colors disabled:opacity-50"
            >
              {submitting ? 'Submitting...' : 'Accept Addendum'}
            </button>
          </div>
        </div>
      )}

      {/* Contact */}
      {addendum.accord.owner && (
        <div className="text-center text-sm text-text-tertiary">
          Questions? Contact {addendum.accord.owner.name} at{' '}
          <a
            href={`mailto:${addendum.accord.owner.email}`}
            className="text-brand-primary hover:underline"
          >
            {addendum.accord.owner.email}
          </a>
        </div>
      )}
    </div>
  );
}
