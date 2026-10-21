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
  const [expired, setExpired] = useState(false);
  const [signing, setSigning] = useState(false);
  const [signed, setSigned] = useState(false);
  const [signerName, setSignerName] = useState('');
  const [signerEmail, setSignerEmail] = useState('');

  useEffect(() => {
    async function fetchMsa() {
      try {
        const res = await fetch(`/api/portal/msa/${token}`);
        if (!res.ok) {
          if (res.status === 404 || res.status === 410) setExpired(true);
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
      <SkeletonRegion>
        <Skeleton block />
        <Skeleton lines={4} />
      </SkeletonRegion>
    );
  }

  if (!msa) {
    if (!expired) {
      return <EmptyState art="meadow" headingLevel="h1" title="Something went wrong" body={FAILED_BODY} />;
    }
    return <EmptyState art="meadow" headingLevel="h1" title="This link has expired" body={EXPIRED_BODY} />;
  }

  const open = !msa.already_signed && !signed;

  return (
    <>
      <header className="ph no-motif">
        <p className="eyebrow">Agreement, version {msa.msa_version.version}</p>
        <h1 className="h1">Master service agreement</h1>
        <p>For {msa.client.name}</p>
        <div>
          {msa.already_signed || signed ? (
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
        <Callout icon={FileSignature} title="Sign the agreement" note="Read the terms below, then sign with your legal name and email.">
          <PortalButton href="#sign-form">Go to signing</PortalButton>
        </Callout>
      ) : null}

      <section className="card" aria-labelledby="details-h">
        <h2 id="details-h">Details</h2>
        <dl className="kv">
          <div>
            <dt>Version</dt>
            <dd>{msa.msa_version.version}</dd>
          </div>
          <div>
            <dt>Effective</dt>
            <dd>{new Date(msa.msa_version.effective_date).toLocaleDateString()}</dd>
          </div>
        </dl>
      </section>

      <section className="card" aria-labelledby="terms-h">
        <h2 id="terms-h">Agreement terms</h2>
        <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: msa.msa_version.content }} />
      </section>

      {signed ? (
        <EmptyState art="meadow" title="Agreement signed" body="Thank you for signing the agreement." />
      ) : null}

      {msa.already_signed && !signed ? (
        <EmptyState
          art="meadow"
          title="Already signed"
          body={`This agreement was signed on ${new Date(msa.signed_at!).toLocaleDateString()}.`}
        />
      ) : null}

      {open ? (
        <section className="card" id="sign-form" aria-labelledby="sign-h">
          <h2 id="sign-h">Sign the agreement</h2>
          <p>By signing below, you agree to the terms outlined in this Master Service Agreement.</p>
          <form onSubmit={handleSign}>
            <Field id="signer-name" label="Full name">
              <input
                type="text"
                required
                value={signerName}
                onChange={(e) => setSignerName(e.target.value)}
                placeholder="Your full legal name"
              />
            </Field>
            <Field id="signer-email" label="Email address">
              <input
                type="email"
                required
                value={signerEmail}
                onChange={(e) => setSignerEmail(e.target.value)}
                placeholder="your@email.com"
              />
            </Field>
            <div className="actions">
              <PortalButton writes
                type="submit"
                variant="primary"
                disabled={signing || !signerName || !signerEmail}
                busy={signing}
                busyLabel="Signing..."
              >
                Sign agreement
              </PortalButton>
            </div>
          </form>
        </section>
      ) : null}
    </>
  );
}
