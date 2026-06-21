'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

interface ClientTask {
  id: string;
  title: string;
  description: unknown;
  status: string;
  estimated_minutes: number | null;
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
      setDone('Thank you — your approval has been recorded.');
      setPendingAction(null);
    }
  }

  async function handleRequestChanges() {
    if (!changesNote.trim()) {
      setActionError('Please describe what needs changing.');
      return;
    }
    if (await postAction('request-changes', { note: changesNote.trim() })) {
      setDone("Thanks — we've sent this back for changes and we'll be in touch.");
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
      setDone('Thanks — your request has been received and will be reviewed.');
      setPendingAction(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-text-secondary">Loading…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-surface rounded-lg border border-border p-8 text-center">
        <h2 className="text-xl font-semibold text-text-main mb-2">Unable to load this page</h2>
        <p className="text-text-secondary">{error}</p>
      </div>
    );
  }

  if (!data) return null;

  const { task, staging_preview_url, already_approved } = data;
  const summary = describe(task.description);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-surface rounded-lg border border-border p-6">
        <h2 className="text-2xl font-bold text-text-main mb-1">{task.title}</h2>
        {summary && <p className="text-text-secondary mt-2 whitespace-pre-line">{summary}</p>}
      </div>

      {/* Staging preview */}
      <div className="bg-surface rounded-lg border border-border p-6">
        <h3 className="text-lg font-semibold text-text-main mb-4">Preview</h3>
        {staging_preview_url ? (
          <div className="rounded-md border border-border overflow-hidden bg-surface-secondary">
            <iframe
              src={staging_preview_url}
              title="Staging preview"
              className="w-full"
              style={{ height: '600px', border: 'none' }}
            />
          </div>
        ) : (
          <p className="text-text-secondary">A preview will appear here once the work is staged.</p>
        )}
        {staging_preview_url && (
          <p className="text-sm text-text-tertiary mt-3">
            Trouble viewing?{' '}
            <a
              href={staging_preview_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-primary hover:underline"
            >
              Open the preview in a new tab
            </a>
            .
          </p>
        )}
      </div>

      {/* Actions */}
      {done ? (
        <div className="bg-status-success/10 rounded-lg border border-status-success/30 p-6 text-center">
          <h3 className="text-lg font-semibold text-text-main">All set</h3>
          <p className="text-text-secondary mt-1">{done}</p>
        </div>
      ) : already_approved ? (
        <div className="bg-status-success/10 rounded-lg border border-status-success/30 p-6 text-center">
          <h3 className="text-lg font-semibold text-text-main">Already approved</h3>
          <p className="text-text-secondary mt-1">Thanks — this has been approved.</p>
        </div>
      ) : (
        <div className="bg-surface rounded-lg border border-border p-6">
          <h3 className="text-lg font-semibold text-text-main mb-4">What would you like to do?</h3>
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={() => {
                setPendingAction('approve');
                setActionError(null);
              }}
              className={`px-4 py-2 rounded-md transition-colors ${
                pendingAction === 'approve'
                  ? 'bg-brand-primary text-white'
                  : 'bg-brand-primary text-white hover:bg-brand-primary/90'
              }`}
            >
              Approve
            </button>
            <button
              type="button"
              onClick={() => {
                setPendingAction('changes');
                setActionError(null);
              }}
              className="px-4 py-2 rounded-md border border-border text-text-main hover:bg-surface-secondary transition-colors"
            >
              Something&apos;s not right
            </button>
            <button
              type="button"
              onClick={() => {
                setPendingAction('new_task');
                setActionError(null);
              }}
              className="px-4 py-2 rounded-md border border-border text-text-main hover:bg-surface-secondary transition-colors"
            >
              Add a new task
            </button>
          </div>

          {/* Approve confirmation */}
          {pendingAction === 'approve' && (
            <div className="mt-5 border-t border-border pt-5">
              <p className="text-text-secondary mb-4">
                Approve this work? This confirms you&apos;re happy with it and lets us finalise.
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleApprove}
                  className="px-4 py-2 rounded-md bg-brand-primary text-white hover:bg-brand-primary/90 transition-colors disabled:opacity-60"
                >
                  {submitting ? 'Approving…' : 'Confirm approval'}
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => setPendingAction(null)}
                  className="px-4 py-2 rounded-md border border-border text-text-main hover:bg-surface-secondary transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Request changes */}
          {pendingAction === 'changes' && (
            <div className="mt-5 border-t border-border pt-5">
              <label className="block text-sm font-medium text-text-main mb-2">
                What needs changing?
              </label>
              <textarea
                value={changesNote}
                onChange={(e) => setChangesNote(e.target.value)}
                rows={4}
                placeholder="Tell us what's not right and we'll take another pass."
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-text-main placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-brand-primary/40"
              />
              <div className="flex gap-3 mt-3">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleRequestChanges}
                  className="px-4 py-2 rounded-md bg-brand-primary text-white hover:bg-brand-primary/90 transition-colors disabled:opacity-60"
                >
                  {submitting ? 'Sending…' : 'Send back for changes'}
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => setPendingAction(null)}
                  className="px-4 py-2 rounded-md border border-border text-text-main hover:bg-surface-secondary transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Add a new task */}
          {pendingAction === 'new_task' && (
            <div className="mt-5 border-t border-border pt-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-main mb-2">Title</label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="A short summary of what you need"
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 text-text-main placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-brand-primary/40"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-main mb-2">Details</label>
                <textarea
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  rows={4}
                  placeholder="Describe the request in as much detail as you can."
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 text-text-main placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-brand-primary/40"
                />
              </div>
              {data.available_sites.length > 1 && (
                <div>
                  <label className="block text-sm font-medium text-text-main mb-2">Site</label>
                  <select
                    value={newSiteId}
                    onChange={(e) => setNewSiteId(e.target.value)}
                    className="w-full rounded-md border border-border bg-surface px-3 py-2 text-text-main focus:outline-none focus:ring-2 focus:ring-brand-primary/40"
                  >
                    <option value="">Choose a site…</option>
                    {data.available_sites.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name ?? s.id}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="flex gap-3">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleNewTask}
                  className="px-4 py-2 rounded-md bg-brand-primary text-white hover:bg-brand-primary/90 transition-colors disabled:opacity-60"
                >
                  {submitting ? 'Sending…' : 'Submit request'}
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => setPendingAction(null)}
                  className="px-4 py-2 rounded-md border border-border text-text-main hover:bg-surface-secondary transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {actionError && <p className="text-sm text-status-error mt-4">{actionError}</p>}
        </div>
      )}
    </div>
  );
}
