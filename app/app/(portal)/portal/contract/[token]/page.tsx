'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { FileSignature, TriangleAlert } from 'lucide-react';
import { PortalButton } from '@/components/portal/ui/button';
import { Callout } from '@/components/portal/ui/callout';
import { EmptyState } from '@/components/portal/ui/empty-state';
import { Field } from '@/components/portal/ui/field';
import { Skeleton, SkeletonRegion } from '@/components/portal/ui/skeleton';
import { StatusChip } from '@/components/portal/ui/status-chip';

const EXPIRED_BODY = 'Ask us for a new one at support@becomeindelible.com.';
const FAILED_BODY = 'Please try again in a minute. If it keeps happening, email support@becomeindelible.com.';

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
  const [expired, setExpired] = useState(false);
  const [signing, setSigning] = useState(false);
  const [signed, setSigned] = useState(false);
  const [signerName, setSignerName] = useState('');
  const [signerEmail, setSignerEmail] = useState('');

  useEffect(() => {
    async function fetchContract() {
      try {
        const res = await fetch(`/api/portal/contracts/${token}`);
        if (!res.ok) {
          if (res.status === 404 || res.status === 410) setExpired(true);
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
      <SkeletonRegion>
        <Skeleton block />
        <Skeleton lines={4} />
      </SkeletonRegion>
    );
  }

  if (!contract) {
    if (!expired) {
      return <EmptyState art="meadow" headingLevel="h1" title="Something went wrong" body={FAILED_BODY} />;
    }
    return <EmptyState art="meadow" headingLevel="h1" title="This link has expired" body={EXPIRED_BODY} />;
  }

  const charterItems = contract.accord.charter_items || [];
  const commissionItems = contract.accord.commission_items || [];
  const keepItems = contract.accord.keep_items || [];
  const hasItems = charterItems.length > 0 || commissionItems.length > 0 || keepItems.length > 0;
  const alreadySigned = contract.status === 'signed';
  const open = !alreadySigned && !signed;
  const charterTotal = charterItems.reduce((sum, item) => sum + item.total_contract_value, 0);
  const keepTotal = keepItems.reduce((sum, item) => sum + (item.monthly_total || 0), 0);

  return (
    <>
      <header className="ph no-motif">
        <p className="eyebrow">Contract, version {contract.version}</p>
        <h1 className="h1">{contract.accord.name}</h1>
        {contract.accord.client ? <p>Prepared for {contract.accord.client.name}</p> : null}
        <div>
          {alreadySigned || signed ? (
            <StatusChip tone="done" label="Signed" />
          ) : (
            <StatusChip tone="attention" label="Waiting for you" />
          )}
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
        <Callout icon={FileSignature} title="Sign the contract" note="Read the terms below, then sign with your name and email.">
          <PortalButton href="#sign-form">Go to signing</PortalButton>
        </Callout>
      ) : null}

      <section className="card" aria-labelledby="details-h">
        <h2 id="details-h">Details</h2>
        <dl className="kv">
          <div>
            <dt>Version</dt>
            <dd>{contract.version}</dd>
          </div>
          {contract.msa_version ? (
            <div>
              <dt>Master service agreement</dt>
              <dd>{contract.msa_version.version}</dd>
            </div>
          ) : null}
          {contract.signed_at ? (
            <div>
              <dt>Signed</dt>
              <dd>{new Date(contract.signed_at).toLocaleDateString()}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      {contract.content ? (
        <section className="card" aria-labelledby="content-h">
          <h2 id="content-h">Contract details</h2>
          <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: contract.content }} />
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
                      <th scope="col">Type</th>
                      <th scope="col">Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {commissionItems.map((item, i) => (
                      <tr key={i}>
                        <td>{item.name}</td>
                        <td>{item.type || '-'}</td>
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
                      <th scope="col">Hosting</th>
                      <th scope="col">Maintenance</th>
                      <th scope="col">Monthly</th>
                    </tr>
                  </thead>
                  <tbody>
                    {keepItems.map((item, i) => (
                      <tr key={i}>
                        <td>{item.site_name}</td>
                        <td>{item.hosting_final_price ? `$${item.hosting_final_price.toLocaleString()}` : '-'}</td>
                        <td>
                          {item.maintenance_final_price ? `$${item.maintenance_final_price.toLocaleString()}` : '-'}
                        </td>
                        <td>{item.monthly_total ? `$${item.monthly_total.toLocaleString()}/mo` : '-'}</td>
                      </tr>
                    ))}
                    <tr className="total">
                      <td>Total</td>
                      <td />
                      <td />
                      <td>${keepTotal.toLocaleString()}/mo</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </section>
      ) : null}

      {signed ? (
        <EmptyState art="meadow" title="Contract signed" body="Signed. Thank you." />
      ) : null}

      {alreadySigned && !signed ? (
        <EmptyState
          art="meadow"
          title="Already signed"
          body={`This contract has been signed${
            contract.signed_at ? ` on ${new Date(contract.signed_at).toLocaleDateString()}` : ''
          }.`}
        />
      ) : null}

      {open ? (
        <section className="card" id="sign-form" aria-labelledby="sign-h">
          <h2 id="sign-h">Sign the contract</h2>
          <p>By signing below, you agree to the terms outlined in this contract and the referenced Master Service Agreement.</p>
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
          <div className="actions">
            <PortalButton writes
              variant="primary"
              onClick={handleSign}
              disabled={signing || !signerName.trim() || !signerEmail.trim()}
              busy={signing}
              busyLabel="Signing..."
            >
              Sign contract
            </PortalButton>
          </div>
        </section>
      ) : null}

      {contract.accord.owner ? (
        <p>
          Questions? Contact {contract.accord.owner.name} at{' '}
          <a href={`mailto:${contract.accord.owner.email}`}>{contract.accord.owner.email}</a>
        </p>
      ) : null}
    </>
  );
}
