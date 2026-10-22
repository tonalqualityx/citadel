'use client';

import { use, useCallback, useEffect, useState } from 'react';
import { ChevronDown, TriangleAlert, PenLine } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { StatusChip } from '@/components/portal/ui/status-chip';
import { EngagementChip } from '@/components/portal/ui/engagement-chip';
import { PageHeader } from '@/components/portal/ui/page-header';
import { Callout } from '@/components/portal/ui/callout';
import { EmptyState } from '@/components/portal/ui/empty-state';
import { Field } from '@/components/portal/ui/field';
import { PortalButton } from '@/components/portal/ui/button';
import { ActionLink } from '@/components/portal/ui/action-link';
import { Skeleton, SkeletonRegion } from '@/components/portal/ui/skeleton';
import { Thread } from '@/components/portal/thread';
import { WorkChat } from '@/components/portal/chat/work-chat';
import type { Engagement } from '@/lib/portal/engagement';
import type { ChipTone } from '@/lib/portal/status-labels';

// One piece of work in client words (portal phase B slice 1): read-only, plus the review block
// when it is staged for the client, then the conversation (slice 2).

interface Work {
  id: string;
  title: string;
  state: { label: string; tone: ChipTone };
  engagement: Engagement;
  site: { id: string; name: string } | null;
  requested_by: { first_name: string } | null;
  requested_at: string;
  approved_at: string | null;
  answers: Array<{ prompt: string; value: string }>;
  staged: { preview_url: string; awaiting_approval: boolean } | null;
  can_act: boolean;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function WorkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [work, setWork] = useState<Work | null>(null);
  const [chat, setChat] = useState<{ conversation_id: string | null; available: boolean }>({ conversation_id: null, available: false });
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showChanges, setShowChanges] = useState(false);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/portal/work/${id}`);
      if (res.status === 401) {
        router.replace('/portal/login');
        return null;
      }
      if (res.status === 404) {
        setNotFound(true);
        return null;
      }
      if (!res.ok) {
        setError('Failed to load this request');
        return null;
      }
      const body = await res.json();
      setWork(body.work);
      setChat(body.chat ?? { conversation_id: null, available: false });
      return (body.chat?.conversation_id as string | null | undefined) ?? null;
    } catch {
      setError('Failed to load this request');
      return null;
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    load();
  }, [load]);

  async function act(path: 'approve' | 'request-changes') {
    if (path === 'request-changes' && !note.trim()) {
      setActionError('Please describe what needs changing.');
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/portal/tasks/mine/${id}/${path}`, {
        method: 'POST',
        ...(path === 'request-changes'
          ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: note.trim() }) }
          : {}),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setActionError(body.error || 'Something went wrong. Please try again.');
        return;
      }
      setShowChanges(false);
      setNote('');
      await load();
    } catch {
      setActionError('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <SkeletonRegion label="Loading this request">
        <PageHeader title="Request" size="page" motif="contours" />
        <div className="card">
          <Skeleton lines={3} block />
        </div>
      </SkeletonRegion>
    );
  }
  if (notFound) {
    return (
      <EmptyState
        art="meadow"
        title="We could not find that request"
        body="It may have moved, or it may not be on your account."
        action={
          <PortalButton href="/portal/home" variant="secondary">
            Back to Home
          </PortalButton>
        }
      />
    );
  }
  if (error || !work) {
    return (
      <Callout tone="urgent" icon={TriangleAlert} title="We could not load this request" id="work-error">
        <p>{error ?? 'Failed to load this request'}. Refresh the page to try again.</p>
      </Callout>
    );
  }

  const meta = [
    work.requested_by ? `Requested by ${work.requested_by.first_name} on ${formatDate(work.requested_at)}` : `Added ${formatDate(work.requested_at)}`,
    work.approved_at && formatDate(work.approved_at) ? `You approved this on ${formatDate(work.approved_at)}.` : null,
    work.site?.name,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <>
      <PageHeader
        eyebrow={[<EngagementChip key="kind" engagement={work.engagement} />, <StatusChip key="state" label={work.state.label} tone={work.state.tone} />]}
        title={work.title}
        size="page"
        lede={meta}
        motif="contours"
      />

      {work.staged?.awaiting_approval && (
        <Callout icon={PenLine} title="Ready for your review" id="review">
          <div className="review-actions">
            <ActionLink href={work.staged.preview_url} external>
              Open the preview
            </ActionLink>
            {work.can_act ? (
              <>
                <div className="actions">
                  <PortalButton writes busy={busy} busyLabel="Working…" onClick={() => act('approve')}>
                    Approve
                  </PortalButton>
                  <PortalButton writes variant="secondary" disabled={busy} onClick={() => setShowChanges((v) => !v)} aria-expanded={showChanges}>
                    Something&apos;s not right
                  </PortalButton>
                </div>
                {showChanges && (
                  <div className="changes">
                    <Field id="changes-note" label="What needs changing?">
                      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
                    </Field>
                    <div className="actions">
                      <PortalButton writes disabled={busy} onClick={() => act('request-changes')}>
                        Send back for changes
                      </PortalButton>
                    </div>
                  </div>
                )}
                {actionError && (
                  <p role="alert" className="err">
                    <TriangleAlert className="i" aria-hidden="true" focusable="false" />
                    {actionError}
                  </p>
                )}
              </>
            ) : (
              <p className="meta">Someone with approval rights on your account can approve this.</p>
            )}
          </div>
        </Callout>
      )}

      {work.answers.length > 0 && (
        <details className="card fold">
          <summary>
            Your request
            <ChevronDown className="i" aria-hidden="true" focusable="false" />
          </summary>
          <dl className="kv">
            {work.answers.map((a) => (
              <div key={a.prompt}>
                <dt>{a.prompt}</dt>
                <dd style={{ whiteSpace: 'pre-wrap' }}>{a.value}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}

      {chat.available ? (
        <WorkChat
          taskId={work.id}
          conversationId={chat.conversation_id}
          onAuthLost={() => router.replace('/portal/login')}
          reloadConversationId={load}
        />
      ) : (
        <Thread taskId={work.id} onAuthLost={() => router.replace('/portal/login')} />
      )}
    </>
  );
}
