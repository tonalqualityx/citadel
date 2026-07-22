'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/use-auth';
import { Spinner } from '@/components/ui/spinner';
import { Soothsayer } from '@/components/domain/oracle/soothsayer/Soothsayer';

// Clarity Phase 5 — The Soothsayer: the week-plan visualization. Admin-only, same gate as
// every other Oracle screen (/oracle, /oracle/fleet, /oracle/arcs/[id]).
export default function SoothsayerPage() {
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

  return <Soothsayer />;
}
