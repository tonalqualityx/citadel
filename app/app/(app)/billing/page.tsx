'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/use-auth';
import { BillingDashboard } from '@/components/domain/billing/billing-dashboard';
import { Spinner } from '@/components/ui/spinner';

export default function BillingPage() {
  const [mounted, setMounted] = React.useState(false);
  const router = useRouter();
  const { user, isLoading, isPmOrAdmin } = useAuth();

  React.useEffect(() => {
    setMounted(true);
  }, []);

  // Redirect tech users - billing is PM/Admin only
  React.useEffect(() => {
    if (!isLoading && user && !isPmOrAdmin) {
      router.replace('/');
    }
  }, [isLoading, user, isPmOrAdmin, router]);

  // Show loading until mounted and auth is resolved
  // This prevents hydration mismatch between server and client
  if (!mounted || isLoading) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center min-h-[400px]">
          <Spinner size="lg" />
        </div>
      </div>
    );
  }

  // Don't render for tech users (they'll be redirected)
  if (!isPmOrAdmin) {
    return null;
  }

  return <BillingDashboard />;
}
