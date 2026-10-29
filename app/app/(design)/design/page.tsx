'use client';

import { useRouter } from 'next/navigation';
import { Spinner } from '@/components/ui/spinner';
import { TaskDrawer } from '@/components/domain/design/TaskDrawer';
import { SessionList } from '@/components/domain/design/SessionList';
import { WorkerBanner } from '@/components/domain/design/WorkerBanner';
import { useDesignDrawer, useDesignSessions, useOpenDesignSession } from '@/lib/hooks/use-design';
import { getTerminology } from '@/lib/hooks/use-terminology';

// Static terms, not the terminology hook: it reads /users/me/preferences, which is 403 for a designer. Default naming.
const terms = getTerminology('awesome');

export default function DesignPage() {
  const router = useRouter();
  const drawer = useDesignDrawer();
  const sessions = useDesignSessions();
  const open = useOpenDesignSession();

  async function onOpenTask(taskId: string) {
    try {
      const { session } = await open.mutateAsync(taskId);
      router.push(`/design/s/${session.id}`);
    } catch {
      // toast shown by the hook
    }
  }

  return (
    <div className="space-y-8">
      <WorkerBanner worker={drawer.data?.worker} />
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
