'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Folder, TriangleAlert } from 'lucide-react';
import { PageHeader } from '@/components/portal/ui/page-header';
import { Section } from '@/components/portal/ui/section';
import { RailCard } from '@/components/portal/ui/rail-card';
import { ProgressBar } from '@/components/portal/ui/progress-bar';
import { PhaseTrack, type PhaseItem } from '@/components/portal/ui/phase-track';
import { ActionLink } from '@/components/portal/ui/action-link';
import { Timeline, type TimelineItem } from '@/components/portal/ui/timeline';
import { Callout } from '@/components/portal/ui/callout';
import { EmptyState } from '@/components/portal/ui/empty-state';
import { Skeleton, SkeletonRegion } from '@/components/portal/ui/skeleton';
import { RequestWorkButton } from '@/components/portal/request-work-button';
import { projectTone } from '@/components/portal/project-tone';

// Projects (portal phase B slice 2, redesign 7.2): every project the signed-in person may see,
// active first, then finished. Backed by GET /api/portal/projects. Each card links to the project page.

interface Item {
  id: string;
  name: string;
  status_label: string;
  progress: { done: number; total: number };
  next_milestone: { name: string; target_date: string | null } | null;
  target_date: string | null;
  updated_at?: string;
  phases?: PhaseItem[];
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function nextText(p: Item): string | null {
  if (p.next_milestone) {
    const when = formatDate(p.next_milestone.target_date);
    return when ? `${p.next_milestone.name}, ${when}` : p.next_milestone.name;
  }
  return null;
}

function ProjectCard({ p }: { p: Item }) {
  const next = nextText(p);
  const target = !next && p.target_date ? formatDate(p.target_date) : '';
  return (
    <RailCard kind="project" icon={Folder} eyebrow="Project" title={p.name} chip={{ label: p.status_label, tone: projectTone(p.status_label) }}>
      {p.phases && p.phases.length > 0 ? <PhaseTrack phases={p.phases} kind="project" /> : null}
      {p.progress.total > 0 ? (
        <ProgressBar done={p.progress.done} total={p.progress.total} kind="project" next={next} />
      ) : (
        <p className="proj-next">No tasks to show yet{next ? `. Next: ${next}` : ''}</p>
      )}
      {p.progress.total > 0 && !next && target ? <p className="proj-next">Target {target}</p> : null}
      {p.progress.total === 0 && !next && target ? <p className="proj-next">Target {target}</p> : null}
      <div>
        <ActionLink href={`/portal/projects/${p.id}`}>Open the project</ActionLink>
      </div>
    </RailCard>
  );
}

export default function PortalProjectsPage() {
  const router = useRouter();
  const [data, setData] = useState<{ active: Item[]; complete: Item[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/portal/projects');
        if (res.status === 401) {
          router.replace('/portal/login');
          return;
        }
        if (!res.ok) {
          if (!cancelled) setError('Failed to load your projects');
          return;
        }
        const payload = await res.json();
        if (!cancelled) setData(payload);
      } catch {
        if (!cancelled) setError('Failed to load your projects');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (error) {
    return <Callout tone="urgent" icon={TriangleAlert} title="Unable to load your projects" note={`${error}. Refresh the page, and if it keeps happening, let us know.`} />;
  }
  if (!data) {
    return (
      <SkeletonRegion label="Projects">
        <div className="ph no-motif">
          <Skeleton lines={2} />
        </div>
        <Skeleton lines={3} block />
        <Skeleton lines={3} block />
      </SkeletonRegion>
    );
  }

  const none = data.active.length === 0 && data.complete.length === 0;
  const n = data.active.length;
  const title = n === 0 ? 'No active projects' : n === 1 ? '1 active project' : `${n} active projects`;
  const finished: TimelineItem[] = data.complete.map((p) => ({
    id: p.id,
    kind: 'project',
    type: 'milestone',
    title: p.name,
    what: 'Finished',
    at: formatDate(p.updated_at) || 'Complete',
    href: `/portal/projects/${p.id}`,
  }));

  return (
    <>
      <PageHeader
        title={title}
        size="page"
        motif="spruce"
        lede="Progress, approvals and what is next on each build."
        actions={<RequestWorkButton />}
      />

      {none ? (
        <EmptyState
          art="spruce"
          title="No projects right now"
          body="When we build something for you, its progress, approvals and history show here."
        />
      ) : (
        <>
          {data.active.length > 0 ? (
            <div className="stack-cards">
              {data.active.map((p) => (
                <ProjectCard key={p.id} p={p} />
              ))}
            </div>
          ) : null}
          {finished.length > 0 ? (
            <Section id="finished" title="Finished" icon={Folder} kind="project">
              <Timeline items={finished} />
            </Section>
          ) : null}
        </>
      )}
    </>
  );
}
