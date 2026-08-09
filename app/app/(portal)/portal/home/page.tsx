'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

// Client account home (Portal v2 phase 1). One page: greeting, pending approvals (articles +
// tasks), open/active projects, an open-amount billing summary, a stats headline + tiles per
// site, and a recent-activity feed. Backed by GET /api/portal/home — a single aggregate payload
// so this page needs one round trip (matches the existing session-scoped page pattern:
// fetch-on-mount, loading/error/401-redirect, no SWR/react-query).

interface ClientComment {
  id: string;
  content: string;
  author_name: string | null;
  created_at: string;
}

interface ClientArticle {
  id: string;
  title: string;
  status: string;
  body: string | null;
  comments: ClientComment[];
  created_at: string;
  updated_at: string;
}

interface ClientTask {
  id: string;
  title: string;
  description: unknown;
  status: string;
  estimated_minutes: number | null;
  comments: ClientComment[];
  staging_preview_url: string | null;
  staging_deployed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ClientProject {
  id: string;
  name: string;
  status: string;
  target_date: string | null;
  updated_at: string;
}

interface ActivityItem {
  type: 'task_completed' | 'task_approved' | 'article_published';
  id: string;
  title: string;
  url?: string | null;
  at: string;
}

interface SiteStats {
  site: { id: string; name: string };
  captured_at: string;
  period: string;
  payload: {
    leads?: { count: number; change_pct?: number | null };
    traffic?: { sessions: number; change_pct?: number | null; top_sources?: { source: string; sessions: number }[] };
    rankings?: { avg_position?: number | null; tracked_keywords?: number; top3_count?: number };
    uptime_pct?: number | null;
  };
}

interface HomePayload {
  client: { id: string; name: string };
  pending_approvals: { articles: ClientArticle[]; tasks: ClientTask[] };
  projects: ClientProject[];
  billing: { open_amount: number; open_count: number };
  activity: ActivityItem[];
  stats: SiteStats[];
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatCurrency(amount: number): string {
  return amount.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function formatTrend(changePct: number | null | undefined): string | null {
  if (changePct === null || changePct === undefined) return null;
  const pct = Math.round(changePct * 100);
  if (pct === 0) return 'flat vs. last period';
  return `${pct > 0 ? '+' : ''}${pct}% vs. last period`;
}

const PROJECT_STATUS_LABEL: Record<string, string> = {
  ready: 'Ready to start',
  in_progress: 'In progress',
  review: 'In review',
};

export default function ClientHomePage() {
  const router = useRouter();
  const [data, setData] = useState<HomePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Per-task inline approve/request-changes state.
  const [openChangesFor, setOpenChangesFor] = useState<string | null>(null);
  const [changesNote, setChangesNote] = useState('');
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const fetchHome = useCallback(async () => {
    try {
      const res = await fetch('/api/portal/home');
      if (res.status === 401) {
        router.replace('/portal/login');
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || 'Failed to load your account home');
        return;
      }
      const payload: HomePayload = await res.json();
      setData(payload);
    } catch {
      setError('Failed to load your account home');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    fetchHome();
  }, [fetchHome]);

  async function handleApproveTask(taskId: string) {
    setSubmittingId(taskId);
    setActionError(null);
    try {
      const res = await fetch(`/api/portal/tasks/mine/${taskId}/approve`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setActionError(body.error || 'Something went wrong. Please try again.');
        return;
      }
      await fetchHome();
    } catch {
      setActionError('Something went wrong. Please try again.');
    } finally {
      setSubmittingId(null);
    }
  }

  async function handleRequestChanges(taskId: string) {
    if (!changesNote.trim()) {
      setActionError('Please describe what needs changing.');
      return;
    }
    setSubmittingId(taskId);
    setActionError(null);
    try {
      const res = await fetch(`/api/portal/tasks/mine/${taskId}/request-changes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: changesNote.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setActionError(body.error || 'Something went wrong. Please try again.');
        return;
      }
      setOpenChangesFor(null);
      setChangesNote('');
      await fetchHome();
    } catch {
      setActionError('Something went wrong. Please try again.');
    } finally {
      setSubmittingId(null);
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
        <h2 className="text-xl font-semibold text-text-main mb-2">Unable to load your account home</h2>
        <p className="text-text-secondary">{error}</p>
      </div>
    );
  }

  if (!data) return null;

  const { client, pending_approvals, projects, billing, activity, stats } = data;
  const hasPending = pending_approvals.articles.length > 0 || pending_approvals.tasks.length > 0;
  const headlineStats = stats.find((s) => s.payload.leads) ?? null;

  return (
    <div className="space-y-6">
      {/* Greeting + headline */}
      <div className="bg-surface rounded-lg border border-border p-6">
        <h2 className="text-2xl font-bold text-text-main mb-1">Welcome back, {client.name}</h2>
        {headlineStats?.payload.leads ? (
          <p className="mt-2 text-text-secondary">
            <span className="text-text-main font-semibold">{headlineStats.payload.leads.count} leads</span> this
            period{' '}
            {formatTrend(headlineStats.payload.leads.change_pct) && (
              <span className="text-text-tertiary">({formatTrend(headlineStats.payload.leads.change_pct)})</span>
            )}
          </p>
        ) : (
          <p className="mt-2 text-sm text-text-tertiary">
            Here&apos;s everything on your account right now.
          </p>
        )}
      </div>

      {/* Pending approvals */}
      <div className="bg-surface rounded-lg border border-border p-6">
        <h3 className="text-lg font-semibold text-text-main mb-1">Waiting on your review</h3>
        <p className="text-sm text-text-tertiary mb-4">
          Content and work we&apos;ve prepared for your approval.
        </p>

        {!hasPending ? (
          <div className="rounded-lg border border-border bg-surface-secondary p-6 text-center">
            <p className="text-sm text-text-tertiary">
              Nothing is waiting on your review right now. We&apos;ll email you when something&apos;s ready.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {pending_approvals.articles.map((article) => (
              <Link
                key={article.id}
                href={`/portal/articles/${article.id}`}
                className="block rounded-lg border border-border p-4 transition-colors hover:border-text-tertiary"
              >
                <div className="flex items-center justify-between gap-4">
                  <span className="font-medium text-text-main">{article.title}</span>
                  <span className="shrink-0 text-xs text-text-tertiary">Article &middot; Updated {formatDate(article.updated_at)}</span>
                </div>
              </Link>
            ))}

            {pending_approvals.tasks.map((task) => (
              <div key={task.id} className="rounded-lg border border-border p-4">
                <div className="flex items-center justify-between gap-4">
                  <span className="font-medium text-text-main">{task.title}</span>
                  <span className="shrink-0 text-xs text-text-tertiary">Task &middot; Updated {formatDate(task.updated_at)}</span>
                </div>
                {task.staging_preview_url && (
                  <a
                    href={task.staging_preview_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-block text-sm text-brand-primary hover:underline"
                  >
                    View preview
                  </a>
                )}
                <div className="flex flex-col sm:flex-row gap-3 mt-3">
                  <button
                    type="button"
                    disabled={submittingId === task.id}
                    onClick={() => handleApproveTask(task.id)}
                    className="px-4 py-2 rounded-md bg-brand-primary text-white hover:bg-brand-primary/90 transition-colors disabled:opacity-60"
                  >
                    {submittingId === task.id ? 'Approving…' : 'Approve'}
                  </button>
                  <button
                    type="button"
                    disabled={submittingId === task.id}
                    onClick={() => {
                      setOpenChangesFor(openChangesFor === task.id ? null : task.id);
                      setActionError(null);
                    }}
                    className="px-4 py-2 rounded-md border border-border text-text-main hover:bg-surface-secondary transition-colors"
                  >
                    Something&apos;s not right
                  </button>
                </div>
                {openChangesFor === task.id && (
                  <div className="mt-3 border-t border-border pt-3">
                    <textarea
                      value={changesNote}
                      onChange={(e) => setChangesNote(e.target.value)}
                      rows={3}
                      placeholder="Tell us what's not right and we'll take another pass."
                      className="w-full rounded-md border border-border bg-surface px-3 py-2 text-text-main placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-brand-primary/40"
                    />
                    <button
                      type="button"
                      disabled={submittingId === task.id}
                      onClick={() => handleRequestChanges(task.id)}
                      className="mt-2 px-4 py-2 rounded-md bg-brand-primary text-white hover:bg-brand-primary/90 transition-colors disabled:opacity-60"
                    >
                      {submittingId === task.id ? 'Sending…' : 'Send back for changes'}
                    </button>
                  </div>
                )}
              </div>
            ))}
            {actionError && <p className="text-sm text-status-error">{actionError}</p>}
          </div>
        )}
      </div>

      {/* Projects + billing side by side on larger screens */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div className="bg-surface rounded-lg border border-border p-6">
          <h3 className="text-lg font-semibold text-text-main mb-4">Active projects</h3>
          {projects.length === 0 ? (
            <p className="text-sm text-text-tertiary">No active projects right now.</p>
          ) : (
            <ul className="space-y-3">
              {projects.map((project) => (
                <li key={project.id} className="flex items-center justify-between gap-4">
                  <span className="text-text-main">{project.name}</span>
                  <span className="shrink-0 text-xs text-text-tertiary">
                    {PROJECT_STATUS_LABEL[project.status] ?? project.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-surface rounded-lg border border-border p-6">
          <h3 className="text-lg font-semibold text-text-main mb-4">Open balance</h3>
          {billing.open_count === 0 ? (
            <p className="text-sm text-text-tertiary">Nothing outstanding right now.</p>
          ) : (
            <>
              <p className="text-2xl font-bold text-text-main">{formatCurrency(billing.open_amount)}</p>
              <p className="text-sm text-text-tertiary mt-1">
                {billing.open_count} item{billing.open_count === 1 ? '' : 's'} awaiting invoicing
              </p>
            </>
          )}
        </div>
      </div>

      {/* Stats tiles per site */}
      <div className="bg-surface rounded-lg border border-border p-6">
        <h3 className="text-lg font-semibold text-text-main mb-4">Site stats</h3>
        {stats.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface-secondary p-6 text-center">
            <p className="text-sm text-text-tertiary">
              No stats yet — we&apos;ll show your leads, traffic, and rankings here once reporting is live.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {stats.map((s) => (
              <div key={s.site.id} className="rounded-lg border border-border p-4">
                <div className="flex items-center justify-between gap-4 mb-3">
                  <span className="font-medium text-text-main">{s.site.name}</span>
                  <span className="text-xs text-text-tertiary">As of {formatDate(s.captured_at)}</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  {s.payload.leads && (
                    <div>
                      <p className="text-text-tertiary">Leads</p>
                      <p className="text-text-main font-semibold">{s.payload.leads.count}</p>
                    </div>
                  )}
                  {s.payload.traffic && (
                    <div>
                      <p className="text-text-tertiary">Sessions</p>
                      <p className="text-text-main font-semibold">{s.payload.traffic.sessions}</p>
                    </div>
                  )}
                  {s.payload.rankings?.tracked_keywords !== undefined && (
                    <div>
                      <p className="text-text-tertiary">Keywords tracked</p>
                      <p className="text-text-main font-semibold">{s.payload.rankings.tracked_keywords}</p>
                    </div>
                  )}
                  {s.payload.uptime_pct !== undefined && s.payload.uptime_pct !== null && (
                    <div>
                      <p className="text-text-tertiary">Uptime</p>
                      <p className="text-text-main font-semibold">{s.payload.uptime_pct}%</p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent activity */}
      <div className="bg-surface rounded-lg border border-border p-6">
        <h3 className="text-lg font-semibold text-text-main mb-4">Recent activity</h3>
        {activity.length === 0 ? (
          <p className="text-sm text-text-tertiary">Nothing to show yet.</p>
        ) : (
          <ul className="space-y-2">
            {activity.map((item) => (
              <li key={`${item.type}-${item.id}`} className="flex items-center justify-between gap-4 text-sm">
                <span className="text-text-main">
                  {item.type === 'article_published' && 'Published: '}
                  {item.type === 'task_completed' && 'Completed: '}
                  {item.type === 'task_approved' && 'You approved: '}
                  {item.title}
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
