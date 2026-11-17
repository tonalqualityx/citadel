'use client';

import { useRouter } from 'next/navigation';
import { Spinner } from '@/components/ui/spinner';
import { SiteWorkList } from '@/components/domain/design/SiteWorkList';
import { SessionList } from '@/components/domain/design/SessionList';
import { StartWork } from '@/components/domain/design/StartWork';
import { WorkerBanner } from '@/components/domain/design/WorkerBanner';
import { useDesignDrawer, useDesignSessions, useStartDesignWork } from '@/lib/hooks/use-design';

export default function DesignPage() {
  const router = useRouter();
  const drawer = useDesignDrawer();
  const sessions = useDesignSessions();
  const start = useStartDesignWork();

  async function onStart(input: { site_id: string; title: string; detail?: string }) {
    try {
      const { session_id } = await start.mutateAsync(input);
      router.push(`/design/s/${session_id}`);
    } catch {
      // toast shown by the hook
    }
  }

  const empty = !!drawer.data && drawer.data.projects.length === 0;

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <WorkerBanner worker={drawer.data?.worker} />
      <section>
        <h1 className="mb-4 text-xl font-semibold text-text-main">Sites</h1>
        {drawer.isLoading ? (
          <Spinner />
        ) : drawer.error || !drawer.data ? (
          <p className="text-sm text-text-sub">Could not load your sites. Try again shortly.</p>
        ) : (
          <SiteWorkList drawer={drawer.data} />
        )}
      </section>
      {drawer.data && (
        <StartWork sites={drawer.data.start_sites ?? []} prominent={empty} pending={start.isPending} onStart={onStart} />
      )}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-text-main">My sessions</h2>
        {sessions.isLoading ? <Spinner /> : <SessionList sessions={sessions.data?.sessions ?? []} />}
      </section>
    </div>
  );
}
