'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/use-auth';
import { BillingDashboard } from '@/components/domain/billing/billing-dashboard';
import { Spinner } from '@/components/ui/spinner';

export default function BillingPage() {
  const router = useRouter();
  const { user, isLoading, isPmOrAdmin } = useAuth();

  // Redirect tech users - billing is PM/Admin only
  React.useEffect(() => {
    if (!isLoading && user && !isPmOrAdmin) {
      router.replace('/');
    }
  }, [isLoading, user, isPmOrAdmin, router]);

  // Show loading while checking auth
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Spinner size="lg" />
      </div>
    );
  }

  // Don't render for tech users (they'll be redirected)
  if (!isPmOrAdmin) {
    return null;
  }

  return <BillingDashboard />;
}
