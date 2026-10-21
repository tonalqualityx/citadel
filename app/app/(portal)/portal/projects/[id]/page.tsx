'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Check, FileCheck, Flag, History, Link2, ListChecks, MessageSquareText, SearchCheck, TriangleAlert } from 'lucide-react';
import { PageHeader } from '@/components/portal/ui/page-header';
import { Section } from '@/components/portal/ui/section';
import { Callout } from '@/components/portal/ui/callout';
import { NeedsYouItem } from '@/components/portal/ui/needs-you-item';
import { RailCard } from '@/components/portal/ui/rail-card';
import { PhaseTrack } from '@/components/portal/ui/phase-track';
import { ProgressBar } from '@/components/portal/ui/progress-bar';
import { StatusChip } from '@/components/portal/ui/status-chip';
import { ActionLink } from '@/components/portal/ui/action-link';
import { PortalButton } from '@/components/portal/ui/button';
import { Timeline, type TimelineItem } from '@/components/portal/ui/timeline';
import { EmptyState } from '@/components/portal/ui/empty-state';
import { Skeleton, SkeletonRegion } from '@/components/portal/ui/skeleton';
import { RequestWorkButton } from '@/components/portal/request-work-button';
import { projectTone } from '@/components/portal/project-tone';
import { activityLabel, type ActivityType, type ChipTone, type PhaseState } from '@/lib/portal/status-labels';

// Client project page (portal MVP A5, redesign 7.3). Backed by GET /api/portal/projects/:id, which
// answers 404 for anything the signed-in person may not see. Shows status in plain words, phases,
// tasks, what we need from you, links and history for this project.

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

const DONE_VISIBLE = 5;

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function shortDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function taskTone(t: ProjectPayload['tasks'][number]): ChipTone {
  if (t.is_done) return 'done';
  if (t.awaiting_you) return 'attention';
  if (t.status_label === 'Starting soon' || t.status_label === 'Closed') return 'quiet';
  return 'moving';
}

function TaskRows({ tasks }: { tasks: ProjectPayload['tasks'] }) {
  return (
    <ul className="rows">
      {tasks.map((t) => (
        <li key={t.id}>
          <span className="t">{t.title}</span>
          <StatusChip label={t.status_label} tone={taskTone(t)} />
        </li>
      ))}
    </ul>
  );
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
      <SkeletonRegion label="Project">
        <div className="ph no-motif">
          <Skeleton lines={3} />
        </div>
        <Skeleton lines={3} block />
        <Skeleton lines={4} block />
      </SkeletonRegion>
    );
  }

  if (notFound) {
    return (
      <EmptyState
        art="meadow"
        title="We could not find that project"
        body="It may not be shared with you. Your other projects are on the home page."
        action={
          <PortalButton variant="primary" href="/portal/home">
            Back to Home
          </PortalButton>
        }
      />
    );
  }

  if (error || !data) {
    return (
      <Callout tone="urgent" icon={TriangleAlert} title="Unable to load this project" note={`${error ?? 'Something went wrong'}. Refresh the page, and if it keeps happening, let us know.`} />
    );
  }

  const { project, phases, tasks, needs_from_you, links, history } = data;
  const needCount = needs_from_you.approvals.length + needs_from_you.requests.length + (needs_from_you.review_link ? 1 : 0);
  const moving = tasks.filter((t) => !t.is_done);
  const doneTasks = tasks.filter((t) => t.is_done);
  const doneShown = doneTasks.slice(0, DONE_VISIBLE);
  const doneFolded = doneTasks.slice(DONE_VISIBLE);

  const lede = project.completed_date
    ? `Finished ${formatDate(project.completed_date)}`
    : project.target_date
      ? `Target ${formatDate(project.target_date)}`
      : undefined;

  const timeline: TimelineItem[] = history.map((h) => ({
    id: `${h.type}-${h.id}`,
    kind: 'project',
    type: h.type === 'task_approved' ? 'approved' : h.type === 'article_published' ? 'published' : 'completed',
    title: h.title,
    what: activityLabel(h.type),
    at: shortDate(h.at),
  }));

  return (
    <>
      <PageHeader
        eyebrow={['Project', <StatusChip key="c" label={project.status_label} tone={projectTone(project.status_label)} />]}
        title={project.name}
        lede={lede}
        motif="spruce"
        actions={<RequestWorkButton variant="secondary" prefill={{ project_id: project.id }} />}
      />

      {needCount > 0 ? (
        <Callout id="needs" icon={MessageSquareText} title="What we need from you" count={needCount}>
          <ul className="ny">
            {needs_from_you.approvals.map((a) => (
              <NeedsYouItem
                key={a.id}
                icon={FileCheck}
                title={a.title}
                chip={{ label: 'Ready for your review', tone: 'attention' }}
                actions={
                  <>
                    {a.staging_preview_url ? (
                      <ActionLink href={a.staging_preview_url} external>
                        View preview
                      </ActionLink>
                    ) : null}
                    <PortalButton writes variant="primary" icon={Check} busy={busyId === a.id} busyLabel="Approving…" onClick={() => approve(a.id)}>
                      Approve
                    </PortalButton>
                  </>
                }
              />
            ))}
            {needs_from_you.requests.map((r) => (
              <NeedsYouItem
                key={r.task_id}
                icon={MessageSquareText}
                title={r.title}
                detail={r.question}
                chip={{ label: 'Needs your answer', tone: 'attention' }}
                actions={
                  <PortalButton variant="primary" href={`/portal/work/${r.task_id}`}>
                    Answer
                  </PortalButton>
                }
              />
            ))}
            {needs_from_you.review_link ? (
              <NeedsYouItem
                icon={SearchCheck}
                title="Review and answer open questions"
                chip={{ label: 'Needs your answer', tone: 'attention' }}
                actions={
                  <ActionLink href={needs_from_you.review_link} external>
                    Open the review
                  </ActionLink>
                }
              />
            ) : null}
          </ul>
          {actionError ? (
            <p role="alert" className="note">
              {actionError}
            </p>
          ) : null}
        </Callout>
      ) : null}

      {phases.length > 0 || project.progress.total > 0 ? (
        <RailCard kind="project" icon={Flag} title={phases.length > 0 ? 'Phases' : 'Progress'} as="section">
          {phases.length > 0 ? <PhaseTrack phases={phases.map((p) => ({ name: p.name, state: p.state }))} kind="project" /> : null}
          <ProgressBar done={project.progress.done} total={project.progress.total} kind="project" />
        </RailCard>
      ) : null}

      <Section id="tasks" title="Tasks" icon={ListChecks} kind="project">
        <div className="rcard" data-kind="project">
          {tasks.length === 0 ? (
            <p className="empty-line">No tasks to show yet.</p>
          ) : (
            <>
              {moving.length > 0 ? (
                <>
                  <p className="groupname">Moving ({moving.length})</p>
                  <TaskRows tasks={moving} />
                </>
              ) : null}
              {doneTasks.length > 0 ? (
                <>
                  <p className="groupname">Done ({doneTasks.length})</p>
                  <TaskRows tasks={doneShown} />
                  {doneFolded.length > 0 ? (
                    <details className="fold">
                      <summary>
                        <span className="close-t">Show {doneFolded.length} more</span>
                        <span className="open-t">Hide the rest</span>
                      </summary>
                      <TaskRows tasks={doneFolded} />
                    </details>
                  ) : null}
                </>
              ) : null}
            </>
          )}
        </div>
      </Section>

      {links.length > 0 ? (
        <Section id="links" title="Links" icon={Link2} kind="project">
          <div className="rcard" data-kind="project">
            <ul className="links-list">
              {links.map((l) => (
                <li key={`${l.kind}-${l.url}`}>
                  <ActionLink href={l.url} external>
                    {l.name}
                  </ActionLink>
                </li>
              ))}
            </ul>
          </div>
        </Section>
      ) : null}

      <Section id="history" title="History" icon={History} kind="project">
        {timeline.length === 0 ? (
          <div className="rcard" data-kind="project">
            <p className="empty-line">Nothing finished yet.</p>
          </div>
        ) : (
          <Timeline items={timeline} dated />
        )}
      </Section>
    </>
  );
}
