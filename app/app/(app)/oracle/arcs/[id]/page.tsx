'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/use-auth';
import { Spinner } from '@/components/ui/spinner';
import { ArcBoard } from '@/components/domain/oracle/ArcBoard';
import { TaskPeekProvider } from '@/lib/contexts/task-peek-context';

// The arc board — admin-only, same gate as /oracle (the Oracle is fleet telemetry +
// arc/quest management surfaced to the operator only).
export default function ArcBoardPage() {
  const params = useParams<{ id: string }>();
  const [mounted, setMounted] = React.useState(false);
  const router = useRouter();
  const { user, isLoading: authLoading, isAdmin } = useAuth();

  React.useEffect(() => setMounted(true), []);

  React.useEffect(() => {
    if (!authLoading && user && !isAdmin) {
      router.replace('/');
    }
  }, [authLoading, user, isAdmin, router]);

  if (!mounted || authLoading) {
    return (
      <div className="flex min-h-[25rem] items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!isAdmin) return null;

  // Clarity Phase 4c — Mike's ruling: task cards on the arc board open the peek drawer
  // (same TaskPeekProvider/TaskPeekDrawer the Seeing Stone already uses) instead of
  // navigating full-screen, so this page needs its own provider instance too.
  return (
    <TaskPeekProvider>
      <ArcBoard arcId={params.id} />
    </TaskPeekProvider>
  );
}
