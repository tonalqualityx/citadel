'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/use-auth';
import { Spinner } from '@/components/ui/spinner';
import { ArcBoard } from '@/components/domain/oracle/ArcBoard';

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

  return <ArcBoard arcId={params.id} />;
}
