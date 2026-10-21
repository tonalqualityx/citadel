'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ExternalLink, MessageSquareMore, TriangleAlert } from 'lucide-react';
import { PageHeader } from '@/components/portal/ui/page-header';
import { Callout } from '@/components/portal/ui/callout';
import { EmptyState } from '@/components/portal/ui/empty-state';
import { Field } from '@/components/portal/ui/field';
import { PortalButton } from '@/components/portal/ui/button';
import { Skeleton, SkeletonRegion } from '@/components/portal/ui/skeleton';
import { StatusChip } from '@/components/portal/ui/status-chip';

interface ClientTask {
  id: string;
  title: string;
  description: unknown;
  status: string;
  comments: Array<{ id: string; content: string; author_name: string | null; created_at: string }>;
  created_at: string;
  updated_at: string;
}

interface PortalSite {
  id: string;
  name: string | null;
}

interface ApprovalData {
  task: ClientTask;
  staging_preview_url: string | null;
  staging_deployed_at: string | null;
  already_approved: boolean;
  contact: { id: string; name: string | null } | null;
  /** False when the link has no contact of its own: the page offers sign-in instead of the form. */
  can_request_changes?: boolean;
  available_sites: PortalSite[];
}

/** Extract a light plain-text summary from a BlockNote-style description (best-effort). */
function describe(description: unknown): string {
  if (typeof description === 'string') return description;
  if (!Array.isArray(description)) return '';
  const parts: string[] = [];
  for (const block of description) {
    const content = (block as any)?.content;
    if (Array.isArray(content)) {
      for (const node of content) {
        if (node && typeof node.text === 'string') parts.push(node.text);
      }
    }
  }
  return parts.join(' ').trim();
}

export default function TaskApprovalPortalPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<ApprovalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Which action panel is open: null | 'approve' | 'changes' | 'new_task'
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // Form state
  const [changesNote, setChangesNote] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newSiteId, setNewSiteId] = useState('');

  useEffect(() => {
    async function fetchTask() {
      try {
        const res = await fetch(`/api/portal/tasks/${token}`);
        if (!res.ok) {
          const body = await res.json();
          setError(body.error || 'Approval link not found');
          return;
        }
        const payload: ApprovalData = await res.json();
        setData(payload);
        // Default the new-task site to the only option when there's just one.
        if (payload.available_sites.length === 1) {
          setNewSiteId(payload.available_sites[0].id);
        }
      } catch {
        setError('Failed to load this approval page');
      } finally {
        setLoading(false);
      }
    }
    fetchTask();
  }, [token]);

  async function postAction(path: string, payload?: Record<string, unknown>) {
    setSubmitting(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/portal/tasks/${token}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload ?? {}),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(body.error || 'Something went wrong. Please try again.');
        return false;
      }
      return true;
    } catch {
      setActionError('Something went wrong. Please try again.');
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  async function handleApprove() {
    if (await postAction('approve')) {
      setDone('Thank you, your approval has been recorded.');
      setPendingAction(null);
    }
  }

  async function handleRequestChanges() {
    if (!changesNote.trim()) {
      setActionError('Please describe what needs changing.');
      return;
    }
    if (await postAction('request-changes', { note: changesNote.trim() })) {
      setDone("Thanks, we have sent this back for changes and will be in touch.");
      setPendingAction(null);
    }
  }

  async function handleNewTask() {
    if (!newTitle.trim()) {
      setActionError('Please add a short title.');
      return;
    }
    if (!newSiteId) {
      setActionError('Please choose a site.');
      return;
    }
    if (
      await postAction('new-task', {
        title: newTitle.trim(),
        description: newDescription.trim() || null,
        site_id: newSiteId,
      })
    ) {
      setDone('Thanks, your request has been received and will be reviewed.');
      setPendingAction(null);
    }
  }

  if (loading) {
    return (
      <SkeletonRegion label="Loading this review">
        <div className="card">
          <Skeleton lines={2} block />
        </div>
      </SkeletonRegion>
    );
  }

  if (error) {
    return (
      <Callout tone="urgent" icon={TriangleAlert} title="We could not load this page">
        <p>{error}</p>
        <p>Check that you opened the full link from your email, or reply to that email and we will help.</p>
      </Callout>
    );
  }

  if (!data) return null;

  const { task, staging_preview_url, already_approved } = data;
  const summary = describe(task.description);

  if (done || already_approved) {
    return (
      <>
        <EmptyState
          art="meadow"
          title={done ? 'All set' : 'Already approved'}
          body={done ?? 'Thanks, this has been approved.'}
          action={<StatusChip label="Done" tone="done" />}
        />
      </>
    );
  }

  const cancel = (
    <PortalButton variant="quiet" disabled={submitting} onClick={() => setPendingAction(null)}>
      Cancel
    </PortalButton>
  );

  return (
    <>
      <PageHeader eyebrow={['Ready for your review']} title={task.title} motif="meadow" />

      <section className="card" aria-labelledby="ta-preview">
        <h2 id="ta-preview">Preview</h2>
        {staging_preview_url ? (
          <a
            className="frame cardlink"
            href={staging_preview_url}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink className="i" aria-hidden="true" focusable="false" />
            <b>Open the preview</b>
            <small>Opens in a new tab</small>
          </a>
        ) : (
          <p>A preview will appear here once the work is staged.</p>
        )}
      </section>

      {(summary || data.contact?.name) && (
        <section className="card" aria-labelledby="ta-details">
          <h2 id="ta-details">Details</h2>
          <dl className="kv">
            {summary && (
              <div>
                <dt>Summary</dt>
                <dd style={{ whiteSpace: 'pre-line' }}>{summary}</dd>
              </div>
            )}
            {data.contact?.name && (
              <div>
                <dt>Sent to</dt>
                <dd>{data.contact.name}</dd>
              </div>
            )}
          </dl>
        </section>
      )}

      <Callout id="ta-actions" tone="attention" icon={MessageSquareMore} title="What would you like to do?">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <PortalButton writes
            onClick={() => {
              setPendingAction('approve');
              setActionError(null);
            }}
          >
            Approve
          </PortalButton>
          {data.can_request_changes === false ? (
            <p data-testid="no-changes-form">
              To ask for changes, sign in to the portal or reply to the email.
            </p>
          ) : (
            <PortalButton writes
              variant="secondary"
              onClick={() => {
                setPendingAction('changes');
                setActionError(null);
              }}
            >
              Something is not right
            </PortalButton>
          )}
          <PortalButton writes
            variant="secondary"
            onClick={() => {
              setPendingAction('new_task');
              setActionError(null);
            }}
          >
            Add a new task
          </PortalButton>
        </div>

        {pendingAction === 'approve' && (
          <div className="card">
            <p>Approve this work? This confirms you are happy with it and lets us finalise.</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <PortalButton writes onClick={handleApprove} busy={submitting} busyLabel="Approving">
                Confirm approval
              </PortalButton>
              {cancel}
            </div>
          </div>
        )}

        {pendingAction === 'changes' && (
          <div className="card">
            <Field id="ta-changes" label="What needs changing?">
              <textarea
                value={changesNote}
                onChange={(e) => setChangesNote(e.target.value)}
                rows={4}
                placeholder="Tell us what is not right and we will take another pass."
              />
            </Field>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <PortalButton writes onClick={handleRequestChanges} busy={submitting} busyLabel="Sending">
                Send back for changes
              </PortalButton>
              {cancel}
            </div>
          </div>
        )}

        {pendingAction === 'new_task' && (
          <div className="card">
            <Field id="ta-new-title" label="Title">
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="A short summary of what you need"
              />
            </Field>
            <Field id="ta-new-details" label="Details">
              <textarea
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                rows={4}
                placeholder="Describe the request in as much detail as you can."
              />
            </Field>
            {data.available_sites.length > 1 && (
              <Field id="ta-new-site" label="Site">
                <select value={newSiteId} onChange={(e) => setNewSiteId(e.target.value)}>
                  <option value="">Choose a site</option>
                  {data.available_sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name ?? s.id}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <PortalButton writes onClick={handleNewTask} busy={submitting} busyLabel="Sending">
                Submit request
              </PortalButton>
              {cancel}
            </div>
          </div>
        )}

        {actionError && (
          <p role="alert" className="err">
            <TriangleAlert className="i" aria-hidden="true" focusable="false" />
            {actionError}
          </p>
        )}
      </Callout>
    </>
  );
}
