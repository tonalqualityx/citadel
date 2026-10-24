'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Check, CircleCheck, ClipboardList, ExternalLink, Eye, FileText, ListChecks, MessageSquareText, PenLine, Plus, Receipt,
  TriangleAlert, Video,
} from 'lucide-react';
import { activityLabel, type ChipTone } from '@/lib/portal/status-labels';
import { AWAITING_YOU_LABEL } from '@/lib/portal/status-labels';
import type { Engagement } from '@/lib/portal/engagement';
import { homeHeadline, homeLede } from '@/lib/portal/headline';
import { PortalButton } from '@/components/portal/ui/button';
import { ActionLink } from '@/components/portal/ui/action-link';
import { PageHeader } from '@/components/portal/ui/page-header';
import { Section } from '@/components/portal/ui/section';
import { RailCard } from '@/components/portal/ui/rail-card';
import { Callout } from '@/components/portal/ui/callout';
import { NeedsYouItem } from '@/components/portal/ui/needs-you-item';
import { StatusChip } from '@/components/portal/ui/status-chip';
import { KindTag } from '@/components/portal/ui/kind-tag';
import { SiteMark } from '@/components/portal/ui/site-mark';
import { ProgressBar } from '@/components/portal/ui/progress-bar';
import { PhaseTrack } from '@/components/portal/ui/phase-track';
import { StatTile } from '@/components/portal/ui/stat-tile';
import { Timeline, type TimelineItem } from '@/components/portal/ui/timeline';
import { Field } from '@/components/portal/ui/field';
import { EmptyState } from '@/components/portal/ui/empty-state';
import { Skeleton, SkeletonRegion } from '@/components/portal/ui/skeleton';
import { KIND_ICON } from '@/components/portal/ui/icons';
import { GoalRows, type GoalView } from '@/components/portal/goal-rows';
import Link from 'next/link';

// Client account home (Portal v2 phase 1, redesigned in portal redesign slice 3). Order: header
// (headline from the count), Needs you (approvals, plans, open questions, review links, owner
// balance), Moving now (projects, retainer, requests), Your sites this month, Open balance
// (owners), Recently finished. Backed by GET /api/portal/home, a single aggregate payload so this
// page needs one round trip (fetch-on-mount, loading/error/401-redirect, no SWR/react-query).

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
  comments: ClientComment[];
  staging_preview_url: string | null;
  staging_deployed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ClientProject {
  id: string;
  name: string;
  status_label: string;
  target_date: string | null;
  updated_at: string;
  progress: { done: number; total: number };
  current_phase: string | null;
  review_link: string | null;
  phases?: Array<{ name: string; state: 'done' | 'current' | 'upcoming' }>;
}

interface ClientQuestion {
  task_id: string;
  title: string;
  question: string | null;
  asked_at: string | null;
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
    traffic?: { sessions: number; change_pct?: number | null; top_sources?: { source: string; sessions: number }[]; series?: number[] };
    rankings?: { avg_position?: number | null; tracked_keywords?: number; top3_count?: number };
    uptime_pct?: number | null;
  };
}

interface HomeRequest {
  id: string;
  title: string;
  state: { label: string; tone: ChipTone };
  engagement: Engagement;
  site: { id: string; name: string } | null;
  updated_at: string;
}

interface HomeRetainer {
  id: string;
  heading: string;
  status: { label: string; tone: ChipTone };
  period: string;
  plan_ready: boolean;
  open: Array<{ id: string; title: string; state: { label: string; tone: ChipTone } }>;
}

interface HomePayload {
  client: { id: string; name: string };
  retainers: HomeRetainer[];
  requests: { open_count: number; top: HomeRequest[] };
  pending_approvals: { articles: ClientArticle[]; tasks: ClientTask[] };
  needs_from_you: { questions: ClientQuestion[]; review_links: { project_id: string; project_name: string; url: string }[] };
  projects: ClientProject[];
  // null unless the contact is an owner. source 'quickbooks' = real open invoices; 'unbilled_work' =
  // the fallback for a client with no QuickBooks mapping (label says "Work not yet invoiced").
  billing: {
    source: 'quickbooks' | 'unbilled_work';
    label: string | null;
    open_amount: number;
    open_count: number;
    oldest_due_date: string | null;
    invoices: {
      id: string;
      number: string | null;
      date: string;
      due_date: string | null;
      balance: number;
      overdue: boolean;
      pay_link: string | null;
    }[];
  } | null;
  activity: ActivityItem[];
  stats: SiteStats[];
  // Present only when the portal KPI switch is on.
  site_goals?: { site: { id: string; name: string }; goals: GoalView[] }[];
  // Present only when the portal onboarding switch is on.
  onboarding?: { still_need: { label: string }[] };
  summary?: { needs_count: number; moving: { projects: number; retainers: number; requests: number } };
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatShortDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Date-only strings (YYYY-MM-DD) parse as UTC midnight; format them in UTC so US timezones do not show the day before.
function formatDay(day: string | null): string {
  if (!day) return '';
  const d = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function formatMoney(amount: number): string {
  return amount.toLocaleString(undefined, { style: 'currency', currency: 'USD' });
}

function formatCurrency(amount: number): string {
  return amount.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

function monthName(year: number, month0: number): string {
  return new Date(Date.UTC(year, month0, 1)).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
}

/** The month before the one the snapshot covers: "September" for an October snapshot. */
function previousMonthName(stats: SiteStats): string {
  const m = /^(\d{4})-(\d{2})/.exec(stats.period ?? '');
  let year: number;
  let month0: number;
  if (m) {
    year = Number(m[1]);
    month0 = Number(m[2]) - 1;
  } else {
    const d = new Date(stats.captured_at);
    const ok = !Number.isNaN(d.getTime());
    year = ok ? d.getUTCFullYear() : new Date().getUTCFullYear();
    month0 = ok ? d.getUTCMonth() : new Date().getUTCMonth();
  }
  return monthName(year, month0 - 1);
}

function trendWords(changePct: number | null | undefined): string | null {
  if (changePct === null || changePct === undefined) return null;
  const pct = Math.round(changePct * 100);
  if (pct === 0) return 'flat on the last period';
  return `${pct > 0 ? 'up' : 'down'} ${Math.abs(pct)}% on the last period`;
}

function HomeSkeleton() {
  return (
    <SkeletonRegion label="Your account home">
      <div className="skel-stack" style={{ display: 'grid', gap: 32 }}>
        <Skeleton block lines={2} />
        <Skeleton block lines={4} />
        <Skeleton block lines={3} />
        <Skeleton block lines={3} />
      </div>
    </SkeletonRegion>
  );
}

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
  // Tasks approved in this visit keep their row, with a done line, until the page is reloaded.
  const [approvedDone, setApprovedDone] = useState<Array<{ id: string; title: string }>>([]);

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

  async function handleApproveTask(taskId: string, title: string) {
    setSubmittingId(taskId);
    setActionError(null);
    try {
      const res = await fetch(`/api/portal/tasks/mine/${taskId}/approve`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setActionError(body.error || 'Something went wrong. Please try again.');
        return;
      }
      setApprovedDone((prev) => [...prev, { id: taskId, title }]);
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

  if (loading) return <HomeSkeleton />;

  if (error) {
    return (
      <Callout tone="urgent" icon={TriangleAlert} title="We could not load your account home" id="home-error">
        <p>{error}. Refresh the page, or email support@becomeindelible.com.</p>
      </Callout>
    );
  }

  if (!data) return null;

  const { client, pending_approvals, needs_from_you, projects, billing, activity, stats, requests } = data;
  const hasBalance = Boolean(billing && billing.open_count > 0);
  const stillNeed = data.onboarding?.still_need ?? [];
  const siteGoals = data.site_goals ?? [];
  const plansReady = data.retainers.filter((r) => r.plan_ready);
  const needsCount =
    pending_approvals.articles.length +
    pending_approvals.tasks.length +
    plansReady.length +
    needs_from_you.questions.length +
    needs_from_you.review_links.length +
    (stillNeed.length > 0 ? 1 : 0) +
    (hasBalance ? 1 : 0);
  const showCallout = needsCount > 0 || approvedDone.length > 0;
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const moving = data.summary?.moving ?? {
    projects: projects.length,
    retainers: data.retainers.length,
    requests: requests.open_count,
  };
  const recent = activity.slice(0, 4);
  const timeline: TimelineItem[] = recent.map((item) => ({
    id: `${item.type}-${item.id}`,
    kind: 'history',
    type: item.type === 'task_approved' ? 'approved' : item.type === 'article_published' ? 'published' : 'completed',
    title: item.title,
    what: activityLabel(item.type),
    at: formatShortDate(item.at),
  }));

  return (
    <>
      <PageHeader
        size="display"
        motif="ridgeline"
        eyebrow={[client.name, today]}
        title={homeHeadline(needsCount)}
        lede={homeLede(moving)}
        actions={
          <>
            <PortalButton href="/portal/requests/new" icon={Plus}>
              Request work
            </PortalButton>
            <PortalButton href="/portal/book" variant="secondary" icon={Video}>
              Book a meeting
            </PortalButton>
          </>
        }
      />

      {showCallout ? (
        <Callout icon={PenLine} title="Needs you" count={needsCount} note="Approving here or by email both count." id="needs-you">
          <ul className="ny">
            {approvedDone.map((a) => (
              <NeedsYouItem
                key={`done-${a.id}`}
                icon={Check}
                title={a.title}
                chip={{ label: 'Approved', tone: 'done' }}
                actions={
                  <p className="meta">
                    <CircleCheck className="i" aria-hidden="true" focusable="false" />
                    Approved. Thank you. We will tell you when it is live.
                  </p>
                }
              />
            ))}

            {pending_approvals.tasks.map((task) => (
              <NeedsYouItem
                key={task.id}
                icon={Eye}
                title={task.title}
                chip={{ label: AWAITING_YOU_LABEL, tone: 'attention' }}
                extra={<span>{`Updated ${formatDate(task.updated_at)}`}</span>}
                actions={
                  <>
                    <PortalButton
                      writes
                      icon={Check}
                      busy={submittingId === task.id}
                      busyLabel="Approving…"
                      onClick={() => handleApproveTask(task.id, task.title)}
                    >
                      Approve
                    </PortalButton>
                    {task.staging_preview_url ? (
                      <PortalButton
                        variant="secondary"
                        icon={ExternalLink}
                        href={task.staging_preview_url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open the preview
                      </PortalButton>
                    ) : null}
                    <PortalButton
                      writes
                      variant="quiet"
                      disabled={submittingId === task.id}
                      aria-expanded={openChangesFor === task.id}
                      onClick={() => {
                        setOpenChangesFor(openChangesFor === task.id ? null : task.id);
                        setActionError(null);
                      }}
                    >
                      Something is not right
                    </PortalButton>
                  </>
                }
              />
            ))}

            {pending_approvals.articles.map((article) => (
              <NeedsYouItem
                key={article.id}
                icon={FileText}
                title={article.title}
                chip={{ label: AWAITING_YOU_LABEL, tone: 'attention' }}
                extra={<span>{`Article. Updated ${formatDate(article.updated_at)}`}</span>}
                actions={
                  <PortalButton href={`/portal/articles/${article.id}`} icon={Eye}>
                    Review
                  </PortalButton>
                }
              />
            ))}

            {plansReady.map((r) => (
              <NeedsYouItem
                key={`plan-${r.id}`}
                icon={FileText}
                title={r.heading}
                detail="A plan is ready for you to approve."
                chip={{ label: 'Plan ready for you', tone: 'attention' }}
                extra={<KindTag kind="retainer" label={`Retainer: ${r.heading}`} href="/portal/retainer" />}
                actions={
                  <PortalButton href="/portal/retainer" icon={FileText}>
                    Open the plan
                  </PortalButton>
                }
              />
            ))}

            {needs_from_you.questions.map((q) => (
              <NeedsYouItem
                key={q.task_id}
                icon={MessageSquareText}
                title={q.title}
                detail={q.question}
                chip={{ label: 'Needs your answer', tone: 'attention' }}
                extra={q.asked_at ? <span>{`Asked ${formatShortDate(q.asked_at)}`}</span> : null}
                actions={
                  <PortalButton href={`/portal/work/${q.task_id}`} icon={MessageSquareText}>
                    Answer
                  </PortalButton>
                }
              />
            ))}

            {needs_from_you.review_links.map((l) => (
              <NeedsYouItem
                key={l.project_id}
                icon={ClipboardList}
                title="Review and answer open questions"
                chip={{ label: 'Needs your answer', tone: 'attention' }}
                extra={<KindTag kind="project" label={`Project: ${l.project_name}`} href={`/portal/projects/${l.project_id}`} />}
                actions={
                  <PortalButton href={l.url} icon={ExternalLink} target="_blank" rel="noopener noreferrer">
                    Open the review
                  </PortalButton>
                }
              />
            ))}

            {stillNeed.length > 0 ? (
              <NeedsYouItem
                icon={ListChecks}
                title="What we still need from you"
                chip={{ label: 'Still needed', tone: 'attention' }}
                actions={
                  <div className="still-need">
                    {stillNeed.map((n) => (
                      <p key={n.label}>{n.label}</p>
                    ))}
                  </div>
                }
              />
            ) : null}

            {billing && billing.open_count > 0 ? (
              <NeedsYouItem
                icon={Receipt}
                title={`Open balance of ${formatCurrency(billing.open_amount)}`}
                chip={{ label: billing.source === 'unbilled_work' ? 'Not yet invoiced' : 'Invoice open', tone: 'quiet' }}
                actions={
                  <PortalButton href="#open-balance" variant="secondary" icon={Receipt}>
                    View billing
                  </PortalButton>
                }
              />
            ) : null}
          </ul>

          {openChangesFor && pending_approvals.tasks.some((t) => t.id === openChangesFor) ? (
            <div className="changes">
              <Field id={`changes-${openChangesFor}`} label="What should change?">
                <textarea
                  value={changesNote}
                  onChange={(e) => setChangesNote(e.target.value)}
                  rows={3}
                  placeholder="Tell us what is not right and we will take another pass."
                />
              </Field>
              <div className="actions">
                <PortalButton
                  writes
                  busy={submittingId === openChangesFor}
                  busyLabel="Sending…"
                  onClick={() => handleRequestChanges(openChangesFor)}
                >
                  Send back for changes
                </PortalButton>
              </div>
            </div>
          ) : null}

          {actionError ? (
            <p className="note" role="alert">
              <TriangleAlert className="i" aria-hidden="true" focusable="false" /> {actionError}
            </p>
          ) : null}
        </Callout>
      ) : (
        <EmptyState
          art="all-clear"
          title="Nothing needs you right now"
          body="When something is ready for your review, it shows here and we email you."
        />
      )}

      <Section id="moving" title="Moving now" lede="What the team is working on for you.">
        {projects.length === 0 ? (
          <RailCard kind="project" icon={KIND_ICON.project} eyebrow="Project" title="Projects">
            <p className="meta">No active projects right now.</p>
          </RailCard>
        ) : (
          projects.map((project) => {
            const phases = project.phases ?? [];
            const currentIdx = phases.findIndex((p) => p.state === 'current');
            const nextPhase = currentIdx >= 0 ? phases[currentIdx + 1]?.name ?? null : null;
            return (
              <RailCard
                key={project.id}
                kind="project"
                icon={KIND_ICON.project}
                eyebrow="Project"
                title={project.name}
                chip={{ label: project.status_label, tone: 'moving' }}
              >
                {phases.length > 0 ? <PhaseTrack phases={phases} kind="project" /> : null}
                {project.progress.total > 0 ? (
                  <ProgressBar
                    done={project.progress.done}
                    total={project.progress.total}
                    label="tasks complete"
                    kind="project"
                    next={nextPhase}
                  />
                ) : (
                  <p className="meta">No tasks to show yet</p>
                )}
                {phases.length === 0 && project.current_phase ? <p className="meta">{project.current_phase}</p> : null}
                {project.target_date ? <p className="meta">{`Target ${formatDate(project.target_date)}`}</p> : null}
                <ActionLink href={`/portal/projects/${project.id}`}>Open the project</ActionLink>
              </RailCard>
            );
          })
        )}

        <div className="grid-2">
          <RailCard kind="retainer" icon={KIND_ICON.retainer} eyebrow="Retainer" title="Retainer">
            {data.retainers.length === 0 ? (
              <p className="meta">No retainer on your account.</p>
            ) : (
              <ul className="rows">
                {data.retainers.map((r) => (
                  <li key={r.id}>
                    <span className="t">
                      <Link href="/portal/retainer">{r.heading}</Link>
                    </span>
                    <StatusChip label={r.status.label} tone={r.status.tone} />
                    <span className="meta">
                      <span>{r.period}</span>
                      {r.plan_ready ? <span>A plan is ready for you to approve.</span> : null}
                      {r.open.map((i) => (
                        <span key={i.id}>
                          <Link href={`/portal/work/${i.id}`}>{i.title}</Link>
                          {` (${i.state.label})`}
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <ActionLink href="/portal/retainer">Open the retainer</ActionLink>
          </RailCard>

          <RailCard kind="request" icon={KIND_ICON.request} eyebrow="Requests" title={`${requests.open_count} open`}>
            {requests.top.length === 0 ? (
              <p className="meta">No open requests right now.</p>
            ) : (
              <ul className="rows">
                {requests.top.map((item) => (
                  <li key={item.id}>
                    <span className="t">
                      <Link href={`/portal/work/${item.id}`}>{item.title}</Link>
                    </span>
                    <StatusChip label={item.state.label} tone={item.state.tone} />
                    {item.site ? (
                      <span className="meta">
                        <SiteMark name={item.site.name} />
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            <ActionLink href="/portal/requests">
              {requests.open_count > requests.top.length ? `See all ${requests.open_count} requests` : 'See all requests'}
            </ActionLink>
          </RailCard>
        </div>
      </Section>

      <Section id="sites" title="Your sites this month" aside="Visits, last 30 days">
        {stats.length === 0 ? (
          <EmptyState
            art="field"
            title="No stats yet"
            body="We will show your leads, traffic and rankings here once reporting is live."
          />
        ) : (
          <div className="tiles">
            {stats.map((s) => {
              const t = s.payload.traffic;
              const leads = s.payload.leads;
              const kw = s.payload.rankings?.tracked_keywords;
              const uptime = s.payload.uptime_pct;
              const vs = previousMonthName(s);
              let value: number | null = null;
              let label = '';
              let change: number | null | undefined = null;
              if (t) {
                value = t.sessions;
                label = 'visits';
                change = t.change_pct;
              } else if (leads) {
                value = leads.count;
                label = 'leads';
                change = leads.change_pct;
              } else if (kw !== undefined) {
                value = kw;
                label = 'keywords tracked';
              }
              const extras: string[] = [];
              if (leads) {
                const trend = trendWords(leads.change_pct);
                extras.push(`${leads.count} ${plural(leads.count, 'lead', 'leads')} this period${trend ? `, ${trend}` : ''}`);
              }
              if (kw !== undefined && t) extras.push(`${kw} keywords tracked`);
              const series = t?.series && t.series.length > 1 ? t.series : undefined;
              return (
                <div key={s.site.id} className="tile-col">
                  {value !== null ? (
                    <StatTile
                      site={s.site.name}
                      value={value}
                      label={label}
                      delta={change !== null && change !== undefined ? { pct: change * 100, vs } : null}
                      series={series}
                      uptime={
                        uptime !== undefined && uptime !== null
                          ? { pct: uptime, note: uptime >= 100 ? null : `Site up ${uptime}% of the time` }
                          : null
                      }
                    />
                  ) : (
                    <SiteMark name={s.site.name} />
                  )}
                  {extras.length > 0 ? <p className="meta">{extras.join('. ')}</p> : null}
                </div>
              );
            })}
          </div>
        )}
        {siteGoals.map((g) => (
          <div key={g.site.id} className="rcard" data-goals-site>
            <p className="groupname">
              <SiteMark name={g.site.name} />
            </p>
            <GoalRows goals={g.goals} />
          </div>
        ))}
      </Section>

      {billing ? (
        <div id="open-balance">
          <Section id="balance" title="Open balance" icon={Receipt}>
            {billing.source === 'unbilled_work' ? (
              billing.open_count === 0 ? (
                <p className="sec-lede">Nothing outstanding right now.</p>
              ) : (
                <div className="card">
                  <p className="meta">{billing.label ?? 'Work not yet invoiced'}</p>
                  <p className="val">{formatCurrency(billing.open_amount)}</p>
                  <p className="meta">
                    {billing.open_count} {plural(billing.open_count, 'item', 'items')} awaiting invoicing
                  </p>
                </div>
              )
            ) : billing.open_count === 0 ? (
              <p className="sec-lede">No outstanding invoices.</p>
            ) : (
              <div className="card">
                <p className="val">{formatMoney(billing.open_amount)}</p>
                <p className="meta">
                  {billing.open_count} open {plural(billing.open_count, 'invoice', 'invoices')}
                  {billing.oldest_due_date ? `. Oldest due ${formatDay(billing.oldest_due_date)}` : ''}
                </p>
                <ul className="rows">
                  {billing.invoices.map((inv) => (
                    <li key={inv.id}>
                      <span className="t">Invoice {inv.number ?? ''}</span>
                      <span className="t num">{formatMoney(inv.balance)}</span>
                      <span className="meta">
                        <span>
                          Dated {formatDay(inv.date)}
                          {inv.due_date ? `. Due ${formatDay(inv.due_date)}` : ''}
                          {inv.overdue ? '. Past due' : ''}
                        </span>
                        {inv.pay_link ? (
                          <a className="go" href={inv.pay_link} target="_blank" rel="noopener noreferrer">
                            Pay
                            <ExternalLink className="i" aria-hidden="true" focusable="false" />
                          </a>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Section>
        </div>
      ) : null}

      <Section id="finished" title="Recently finished" aside={<ActionLink href="/portal/history">See all history</ActionLink>}>
        {timeline.length === 0 ? <p className="sec-lede">Nothing to show yet.</p> : <Timeline items={timeline} />}
      </Section>
    </>
  );
}
