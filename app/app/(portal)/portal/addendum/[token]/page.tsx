'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { FileDiff, TriangleAlert } from 'lucide-react';
import { PortalButton } from '@/components/portal/ui/button';
import { Callout } from '@/components/portal/ui/callout';
import { EmptyState } from '@/components/portal/ui/empty-state';
import { Field } from '@/components/portal/ui/field';
import { Skeleton, SkeletonRegion } from '@/components/portal/ui/skeleton';
import { StatusChip } from '@/components/portal/ui/status-chip';

const EXPIRED_BODY = 'Ask us for a new one at support@becomeindelible.com.';

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
      <SkeletonRegion>
        <Skeleton block />
        <Skeleton lines={4} />
      </SkeletonRegion>
    );
  }

  if (!addendum) {
    return <EmptyState art="meadow" title="This link has expired" body={EXPIRED_BODY} />;
  }

  const alreadyResponded = addendum.status !== 'sent';
  const open = !alreadyResponded && !submitted;
  const pricing = addendum.pricing_snapshot;
  const changes = addendum.changes;
  const pricingTotal = Array.isArray(pricing)
    ? pricing.reduce((sum: number, item: any) => sum + Number(item.total || item.price || 0), 0)
    : 0;
  const chipStatus = submitted && responseAction ? responseAction : addendum.status;
  const chip =
    chipStatus === 'sent'
      ? { tone: 'attention' as const, label: 'Waiting for you' }
      : chipStatus === 'accepted'
        ? { tone: 'done' as const, label: 'Accepted' }
        : { tone: 'quiet' as const, label: chipStatus.replace('_', ' ') };

  return (
    <>
      <header className="ph no-motif">
        <p className="eyebrow">Addendum, version {addendum.version}</p>
        <h1 className="h1">{addendum.title}</h1>
        <p>{addendum.accord.name}</p>
        {addendum.accord.client ? <p>Prepared for {addendum.accord.client.name}</p> : null}
        <div>
          <StatusChip tone={chip.tone} label={chip.label} />
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

      {open ? (
        <Callout icon={FileDiff} title="Respond to the addendum" note="Read the changes below, then respond.">
          <PortalButton href="#respond-form">Go to your response</PortalButton>
        </Callout>
      ) : null}

      <section className="card" aria-labelledby="details-h">
        <h2 id="details-h">Details</h2>
        <dl className="kv">
          <div>
            <dt>Description</dt>
            <dd>{addendum.description}</dd>
          </div>
        </dl>
      </section>

      {addendum.contract_content ? (
        <section className="card" aria-labelledby="terms-h">
          <h2 id="terms-h">Addendum terms</h2>
          <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: addendum.contract_content }} />
        </section>
      ) : null}

      {changes ? (
        <section className="card" aria-labelledby="changes-h">
          <h2 id="changes-h">Changes</h2>
          {Array.isArray(changes) ? (
            <ul>
              {changes.map((change: any, i: number) => (
                <li key={i}>
                  <span>{change.type || 'Change'}:</span> <span>{change.item || change.description || JSON.stringify(change)}</span>
                  {change.price != null ? <span> ${Number(change.price).toLocaleString()}</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <pre className="whitespace-pre-wrap">
              {typeof changes === 'string' ? changes : JSON.stringify(changes, null, 2)}
            </pre>
          )}
        </section>
      ) : null}

      {pricing ? (
        <section className="card" aria-labelledby="pricing-h">
          <h2 id="pricing-h">Pricing</h2>
          {Array.isArray(pricing) ? (
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Item</th>
                    <th scope="col">Price</th>
                    <th scope="col">Qty</th>
                    <th scope="col">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {pricing.map((item: any, i: number) => (
                    <tr key={i}>
                      <td>
                        <div>{item.name || item.item}</div>
                        {item.description ? <div>{item.description}</div> : null}
                      </td>
                      <td>${Number(item.price || 0).toLocaleString()}</td>
                      <td>{item.quantity || 1}</td>
                      <td>${Number(item.total || item.price || 0).toLocaleString()}</td>
                    </tr>
                  ))}
                  <tr className="total">
                    <td>Total</td>
                    <td />
                    <td />
                    <td>${pricingTotal.toLocaleString()}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
            <pre className="whitespace-pre-wrap">
              {typeof pricing === 'string' ? pricing : JSON.stringify(pricing, null, 2)}
            </pre>
          )}
        </section>
      ) : null}

      {submitted ? (
        <EmptyState
          art="meadow"
          title={
            responseAction === 'accepted'
              ? 'Addendum accepted'
              : responseAction === 'rejected'
                ? 'Addendum rejected'
                : 'Changes requested'
          }
          body={
            responseAction === 'accepted'
              ? "Thank you for accepting. We'll proceed with the updated scope."
              : responseAction === 'rejected'
                ? "We've received your response. We'll be in touch."
                : "We've received your feedback and will revise the addendum."
          }
        />
      ) : null}

      {alreadyResponded && !submitted ? (
        <EmptyState
          art="meadow"
          title="Already responded"
          body={`This addendum has been ${addendum.status.replace('_', ' ')}${
            addendum.client_responded_at
              ? ` on ${new Date(addendum.client_responded_at).toLocaleDateString()}`
              : ''
          }.${addendum.client_note ? ` Note: ${addendum.client_note}` : ''}`}
        />
      ) : null}

      {open ? (
        <section className="card" id="respond-form" aria-labelledby="respond-h">
          <h2 id="respond-h">Respond to addendum</h2>
          <p>Please review the addendum terms above and provide your response below.</p>
          <Field id="signer-name" label="Full name">
            <input
              type="text"
              value={signerName}
              onChange={(e) => setSignerName(e.target.value)}
              placeholder="Your full name"
            />
          </Field>
          <Field id="signer-email" label="Email address">
            <input
              type="email"
              value={signerEmail}
              onChange={(e) => setSignerEmail(e.target.value)}
              placeholder="your@email.com"
            />
          </Field>
          <Field id="client-note" label="Note (optional)">
            <textarea
              value={clientNote}
              onChange={(e) => setClientNote(e.target.value)}
              placeholder="Any comments or requested changes..."
              rows={3}
            />
          </Field>
          <div className="actions">
            <PortalButton
              variant="secondary"
              onClick={() => handleRespond('changes_requested')}
              disabled={submitting}
              busy={submitting}
              busyLabel="Submitting..."
            >
              Request changes
            </PortalButton>
            <PortalButton
              variant="secondary"
              onClick={() => handleRespond('rejected')}
              disabled={submitting}
              busy={submitting}
              busyLabel="Submitting..."
            >
              Reject
            </PortalButton>
            <PortalButton
              variant="primary"
              onClick={() => handleRespond('accepted')}
              disabled={submitting || !signerName.trim() || !signerEmail.trim()}
              busy={submitting}
              busyLabel="Submitting..."
            >
              Accept addendum
            </PortalButton>
          </div>
        </section>
      ) : null}

      {addendum.accord.owner ? (
        <p>
          Questions? Contact {addendum.accord.owner.name} at{' '}
          <a href={`mailto:${addendum.accord.owner.email}`}>{addendum.accord.owner.email}</a>
        </p>
      ) : null}
    </>
  );
}
