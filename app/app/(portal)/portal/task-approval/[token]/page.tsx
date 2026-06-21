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

interface ApprovalData {
  task: ClientTask;
  staging_preview_url: string | null;
  staging_deployed_at: string | null;
  already_approved: boolean;
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
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  useEffect(() => {
    async function fetchTask() {
      try {
        const res = await fetch(`/api/portal/tasks/${token}`);
        if (!res.ok) {
          const body = await res.json();
          setError(body.error || 'Approval link not found');
          return;
        }
        setData(await res.json());
      } catch {
        setError('Failed to load this approval page');
      } finally {
        setLoading(false);
      }
    }
    fetchTask();
  }, [token]);

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

      {/* Actions (wiring lands in B2) */}
      {already_approved ? (
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
              onClick={() => setPendingAction('approve')}
              className="px-4 py-2 rounded-md bg-brand-primary text-white hover:bg-brand-primary/90 transition-colors"
            >
              Approve
            </button>
            <button
              type="button"
              onClick={() => setPendingAction('changes')}
              className="px-4 py-2 rounded-md border border-border text-text-main hover:bg-surface-secondary transition-colors"
            >
              Something&apos;s not right
            </button>
            <button
              type="button"
              onClick={() => setPendingAction('new_task')}
              className="px-4 py-2 rounded-md border border-border text-text-main hover:bg-surface-secondary transition-colors"
            >
              Add a new task
            </button>
          </div>
          {pendingAction && (
            <p className="text-sm text-text-tertiary mt-4">
              Thanks — we&apos;re finalising these actions and they&apos;ll be enabled here shortly.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
