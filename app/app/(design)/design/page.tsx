'use client';

import { useRouter } from 'next/navigation';
import { Spinner } from '@/components/ui/spinner';
import { TaskDrawer } from '@/components/domain/design/TaskDrawer';
import { SessionList } from '@/components/domain/design/SessionList';
import { StartWork } from '@/components/domain/design/StartWork';
import { WorkerBanner } from '@/components/domain/design/WorkerBanner';
import { useDesignDrawer, useDesignSessions, useOpenDesignSession, useStartDesignWork } from '@/lib/hooks/use-design';
import { getTerminology } from '@/lib/hooks/use-terminology';

// Static terms, not the terminology hook: it reads /users/me/preferences, which is 403 for a designer. Default naming.
const terms = getTerminology('awesome');

export default function DesignPage() {
  const router = useRouter();
  const drawer = useDesignDrawer();
  const sessions = useDesignSessions();
  const open = useOpenDesignSession();
  const start = useStartDesignWork();

  async function onOpenTask(taskId: string) {
    try {
      const { session } = await open.mutateAsync(taskId);
      router.push(`/design/s/${session.id}`);
    } catch {
      // toast shown by the hook
    }
  }

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
      {drawer.data && (
        <StartWork sites={drawer.data.start_sites ?? []} prominent={empty} pending={start.isPending} onStart={onStart} />
      )}
      <section>
        <h1 className="mb-4 text-xl font-semibold text-text-main">{terms.t('tasks')}</h1>
        {drawer.isLoading ? (
          <Spinner />
        ) : drawer.error || !drawer.data ? (
          <p className="text-sm text-text-sub">Could not load your {terms.t('tasks').toLowerCase()}. Try again shortly.</p>
        ) : (
          <TaskDrawer
            drawer={drawer.data}
            taskTerm={terms.t('tasks')}
            onOpenTask={onOpenTask}
            pendingTaskId={open.isPending ? open.variables : null}
          />
        )}
      </section>
      <section>
        <h2 className="mb-3 text-lg font-semibold text-text-main">My sessions</h2>
        {sessions.isLoading ? <Spinner /> : <SessionList sessions={sessions.data?.sessions ?? []} />}
      </section>
    </div>
  );
}
