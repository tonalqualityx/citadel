'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { FileText, TriangleAlert } from 'lucide-react';
import { PortalButton } from '@/components/portal/ui/button';
import { Callout } from '@/components/portal/ui/callout';
import { EmptyState } from '@/components/portal/ui/empty-state';
import { Field } from '@/components/portal/ui/field';
import { Skeleton, SkeletonRegion } from '@/components/portal/ui/skeleton';
import { StatusChip } from '@/components/portal/ui/status-chip';

const EXPIRED_BODY = 'Ask us for a new one at support@becomeindelible.com.';
const FAILED_BODY = 'Please try again in a minute. If it keeps happening, email support@becomeindelible.com.';

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
  const [expired, setExpired] = useState(false);
  const [responding, setResponding] = useState(false);
  const [responseNote, setResponseNote] = useState('');
  const [responded, setResponded] = useState(false);

  useEffect(() => {
    async function fetchProposal() {
      try {
        const res = await fetch(`/api/portal/proposals/${token}`);
        if (!res.ok) {
          if (res.status === 404 || res.status === 410) setExpired(true);
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
      <SkeletonRegion>
        <Skeleton block />
        <Skeleton lines={4} />
      </SkeletonRegion>
    );
  }

  if (!proposal) {
    if (!expired) {
      return <EmptyState art="meadow" headingLevel="h1" title="Something went wrong" body={FAILED_BODY} />;
    }
    return <EmptyState art="meadow" headingLevel="h1" title="This link has expired" body={EXPIRED_BODY} />;
  }

  const charterItems = proposal.accord.charter_items || [];
  const commissionItems = proposal.accord.commission_items || [];
  const keepItems = proposal.accord.keep_items || [];
  const hasItems = charterItems.length > 0 || commissionItems.length > 0 || keepItems.length > 0;
  const open = proposal.status === 'sent' && !responded;
  const charterTotal = charterItems.reduce((sum, item) => sum + item.total_contract_value, 0);
  const keepTotal = keepItems.reduce((sum, item) => sum + (item.monthly_total || 0), 0);
  const statusChip = responded
    ? { tone: 'done' as const, label: 'Response sent' }
    : proposal.status === 'sent'
      ? { tone: 'attention' as const, label: 'Waiting for you' }
      : proposal.status === 'accepted'
        ? { tone: 'done' as const, label: 'Accepted' }
        : { tone: 'quiet' as const, label: proposal.status.replace('_', ' ') };

  return (
    <>
      <header className="ph no-motif">
        <p className="eyebrow">Proposal, version {proposal.version}</p>
        <h1 className="h1">{proposal.accord.name}</h1>
        {proposal.accord.client ? <p>Prepared for {proposal.accord.client.name}</p> : null}
        <div>
          <StatusChip tone={statusChip.tone} label={statusChip.label} />
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
        <Callout icon={FileText} title="Accept the proposal" note="Read the details below, then respond.">
          <PortalButton href="#response">Go to your response</PortalButton>
        </Callout>
      ) : null}

      <section className="card" aria-labelledby="details-h">
        <h2 id="details-h">Details</h2>
        <dl className="kv">
          {proposal.accord.client ? (
            <div>
              <dt>Prepared for</dt>
              <dd>{proposal.accord.client.name}</dd>
            </div>
          ) : null}
          <div>
            <dt>Version</dt>
            <dd>{proposal.version}</dd>
          </div>
          {proposal.sent_at ? (
            <div>
              <dt>Sent</dt>
              <dd>{new Date(proposal.sent_at).toLocaleDateString()}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      {proposal.content ? (
        <section className="card" aria-labelledby="content-h">
          <h2 id="content-h">Proposal details</h2>
          <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: proposal.content }} />
        </section>
      ) : null}

      {hasItems ? (
        <section className="card" aria-labelledby="pricing-h">
          <h2 id="pricing-h">Pricing</h2>

          {charterItems.length > 0 ? (
            <>
              <h3>Recurring services</h3>
              <div className="tablewrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Service</th>
                      <th scope="col">Price</th>
                      <th scope="col">Billing</th>
                      <th scope="col">Total value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {charterItems.map((item, i) => (
                      <tr key={i}>
                        <td>{item.name}</td>
                        <td>${item.final_price.toLocaleString()}</td>
                        <td>{item.billing_period}</td>
                        <td>${item.total_contract_value.toLocaleString()}</td>
                      </tr>
                    ))}
                    <tr className="total">
                      <td>Total</td>
                      <td />
                      <td />
                      <td>${charterTotal.toLocaleString()}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </>
          ) : null}

          {commissionItems.length > 0 ? (
            <>
              <h3>Project services</h3>
              <div className="tablewrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Service</th>
                      <th scope="col">Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {commissionItems.map((item, i) => (
                      <tr key={i}>
                        <td>{item.name}</td>
                        <td>{item.final_price ? `$${item.final_price.toLocaleString()}` : 'TBD'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}

          {keepItems.length > 0 ? (
            <>
              <h3>Hosting and maintenance</h3>
              <div className="tablewrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Site</th>
                      <th scope="col">Monthly</th>
                    </tr>
                  </thead>
                  <tbody>
                    {keepItems.map((item, i) => (
                      <tr key={i}>
                        <td>{item.site_name}</td>
                        <td>{item.monthly_total ? `$${item.monthly_total.toLocaleString()}/mo` : '-'}</td>
                      </tr>
                    ))}
                    <tr className="total">
                      <td>Total</td>
                      <td>${keepTotal.toLocaleString()}/mo</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </section>
      ) : null}

      {responded ? (
        <EmptyState art="meadow" title="Response submitted" body="Thank you for your response. A person at Indelible reads every reply." />
      ) : null}

      {!open && !responded ? (
        <EmptyState
          art="meadow"
          title="Already responded"
          body={`This proposal has been ${proposal.status.replace('_', ' ')}.`}
        />
      ) : null}

      {open ? (
        <section className="card" id="response" aria-labelledby="response-h">
          <h2 id="response-h">Your response</h2>
          <Field id="response-note" label="Notes (optional)">
            <textarea
              value={responseNote}
              onChange={(e) => setResponseNote(e.target.value)}
              placeholder="Any comments or questions..."
              rows={3}
            />
          </Field>
          <div className="actions">
            <PortalButton writes
              variant="secondary"
              onClick={() => handleRespond('changes_requested')}
              disabled={responding}
            >
              Request changes
            </PortalButton>
            <PortalButton writes variant="secondary" onClick={() => handleRespond('reject')} disabled={responding}>
              Decline
            </PortalButton>
            <PortalButton writes variant="primary" onClick={() => handleRespond('accept')} disabled={responding}>
              Accept proposal
            </PortalButton>
          </div>
        </section>
      ) : null}

      {proposal.accord.owner ? (
        <p>
          Questions? Contact {proposal.accord.owner.name} at{' '}
          <a href={`mailto:${proposal.accord.owner.email}`}>{proposal.accord.owner.email}</a>
        </p>
      ) : null}
    </>
  );
}
