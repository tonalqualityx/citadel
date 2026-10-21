'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { activityLabel, phaseStateLabel, type ActivityType, type PhaseState } from '@/lib/portal/status-labels';

// Client project page (portal MVP A5). Backed by GET /api/portal/projects/:id, which answers 404
// for anything the signed-in person may not see. Shows status in plain words, phases, tasks,
// what we need from you, links and history for this project.

interface ProjectPayload {
  project: {
    id: string;
    name: string;
    status_label: string;
    target_date: string | null;
    completed_date: string | null;
    progress: { done: number; total: number };
    current_phase: string | null;
  };
  phases: { id: string; name: string; state: PhaseState }[];
  tasks: { id: string; title: string; status_label: string; is_done: boolean; awaiting_you: boolean; phase: string | null }[];
  needs_from_you: {
    approvals: { id: string; title: string; staging_preview_url: string | null; staging_deployed_at: string | null }[];
    requests: { task_id: string; title: string; question: string | null; asked_at: string | null }[];
    review_link: string | null;
  };
  links: { name: string; url: string; kind: 'review' | 'upload' | 'preview' }[];
  history: { type: ActivityType; id: string; title: string; at: string }[];
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function ClientProjectPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<ProjectPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/portal/projects/${encodeURIComponent(id)}`);
      if (res.status === 401) {
        router.replace('/portal/login');
        return;
      }
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || 'Failed to load this project');
        return;
      }
      setData(await res.json());
    } catch {
      setError('Failed to load this project');
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    load();
  }, [load]);

  async function approve(taskId: string) {
    setBusyId(taskId);
    setActionError(null);
    try {
      const res = await fetch(`/api/portal/tasks/mine/${taskId}/approve`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setActionError(body.error || 'Something went wrong. Please try again.');
        return;
      }
      await load();
    } catch {
      setActionError('Something went wrong. Please try again.');
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-text-secondary">Loading…</div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="bg-surface rounded-lg border border-border p-8 text-center">
        <h2 className="text-xl font-semibold text-text-main mb-2">We could not find that project</h2>
        <p className="text-text-secondary mb-4">It may not be shared with you. Your other projects are on the home page.</p>
        <Link href="/portal/home" className="text-brand-primary hover:underline">
          Back to home
        </Link>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-surface rounded-lg border border-border p-8 text-center">
        <h2 className="text-xl font-semibold text-text-main mb-2">Unable to load this project</h2>
        <p className="text-text-secondary">{error}</p>
      </div>
    );
  }

  const { project, phases, tasks, needs_from_you, links, history } = data;
  const hasNeeds = needs_from_you.approvals.length > 0 || needs_from_you.requests.length > 0 || Boolean(needs_from_you.review_link);
  const pct = project.progress.total > 0 ? Math.round((project.progress.done / project.progress.total) * 100) : 0;

  return (
    <div className="space-y-6">
      <p className="text-sm">
        <Link href="/portal/home" className="text-brand-primary hover:underline">
          Back to home
        </Link>
      </p>

      <div className="bg-surface rounded-lg border border-border p-6">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-2xl font-bold text-text-main">{project.name}</h2>
          <span className="shrink-0 rounded-full border border-border px-3 py-1 text-xs text-text-secondary">{project.status_label}</span>
        </div>
        <p className="mt-2 text-sm text-text-secondary">
          {project.progress.total > 0
            ? `${project.progress.done} of ${project.progress.total} tasks complete`
            : 'No tasks to show yet'}
          {project.current_phase ? ` · ${project.current_phase}` : ''}
          {project.target_date ? ` · Target ${formatDate(project.target_date)}` : ''}
          {project.completed_date ? ` · Finished ${formatDate(project.completed_date)}` : ''}
        </p>
        {project.progress.total > 0 && (
          <div
            className="mt-3 h-2 w-full overflow-hidden rounded-full bg-surface-secondary"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Tasks complete"
          >
            <div className="h-full bg-brand-primary" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>

      <div className="bg-surface rounded-lg border border-border p-6">
        <h3 className="text-lg font-semibold text-text-main mb-4">What we need from you</h3>
        {!hasNeeds ? (
          <p className="text-sm text-text-tertiary">Nothing is waiting on you for this project.</p>
        ) : (
          <div className="space-y-3">
            {needs_from_you.approvals.map((a) => (
              <div key={a.id} className="rounded-lg border border-border p-4">
                <span className="font-medium text-text-main">{a.title}</span>
                <p className="text-xs text-text-tertiary">Ready for your approval</p>
                {a.staging_preview_url && (
                  <a href={a.staging_preview_url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-sm text-brand-primary hover:underline">
                    View preview
                  </a>
                )}
                <div className="mt-3">
                  <button
                    type="button"
                    disabled={busyId === a.id}
                    onClick={() => approve(a.id)}
                    className="px-4 py-2 rounded-md bg-brand-primary text-white hover:bg-brand-primary/90 transition-colors disabled:opacity-60"
                  >
                    {busyId === a.id ? 'Approving…' : 'Approve'}
                  </button>
                </div>
              </div>
            ))}
            {needs_from_you.requests.map((r) => (
              <div key={r.task_id} className="rounded-lg border border-border p-4">
                <span className="font-medium text-text-main">{r.title}</span>
                {r.question && <p className="mt-1 text-sm text-text-secondary">{r.question}</p>}
                <p className="mt-2 text-xs text-text-tertiary">Reply to our email and we will pick it up.</p>
              </div>
            ))}
            {needs_from_you.review_link && (
              <a href={needs_from_you.review_link} target="_blank" rel="noopener noreferrer" className="block rounded-lg border border-border p-4 hover:border-text-tertiary">
                <span className="font-medium text-text-main">Review and answer open questions</span>
              </a>
            )}
            {actionError && <p className="text-sm text-status-error">{actionError}</p>}
          </div>
        )}
      </div>

      {phases.length > 0 && (
        <div className="bg-surface rounded-lg border border-border p-6">
          <h3 className="text-lg font-semibold text-text-main mb-4">Phases</h3>
          <ol className="space-y-2">
            {phases.map((ph) => (
              <li key={ph.id} className="flex items-center justify-between gap-4 text-sm">
                <span className={ph.state === 'upcoming' ? 'text-text-tertiary' : 'text-text-main'}>{ph.name}</span>
                <span className="shrink-0 text-xs text-text-tertiary">{phaseStateLabel(ph.state)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="bg-surface rounded-lg border border-border p-6">
        <h3 className="text-lg font-semibold text-text-main mb-4">Tasks</h3>
        {tasks.length === 0 ? (
          <p className="text-sm text-text-tertiary">No tasks to show yet.</p>
        ) : (
          <ul className="space-y-2">
            {tasks.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-4 text-sm">
                <span className={t.is_done ? 'text-text-tertiary' : 'text-text-main'}>{t.title}</span>
                <span className="shrink-0 text-xs text-text-tertiary">{t.status_label}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {links.length > 0 && (
        <div className="bg-surface rounded-lg border border-border p-6">
          <h3 className="text-lg font-semibold text-text-main mb-4">Links</h3>
          <ul className="space-y-2 text-sm">
            {links.map((l) => (
              <li key={`${l.kind}-${l.url}`}>
                <a href={l.url} target="_blank" rel="noopener noreferrer" className="text-brand-primary hover:underline">
                  {l.name}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="bg-surface rounded-lg border border-border p-6">
        <h3 className="text-lg font-semibold text-text-main mb-4">History</h3>
        {history.length === 0 ? (
          <p className="text-sm text-text-tertiary">Nothing finished yet.</p>
        ) : (
          <ul className="space-y-2">
            {history.map((item) => (
              <li key={`${item.type}-${item.id}`} className="flex items-center justify-between gap-4 text-sm">
                <span className="text-text-main">
                  {activityLabel(item.type)}: {item.title}
                </span>
                <span className="shrink-0 text-xs text-text-tertiary">{formatDate(item.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
