'use client';

import {
  useDashboard,
  isTechDashboard,
  isPmDashboard,
  isAdminDashboard,
} from '@/lib/hooks/use-dashboard';
import { TechOverlook } from '@/components/domain/dashboard/tech-overlook';
import { PmOverlook } from '@/components/domain/dashboard/pm-overlook';
import { AdminOverlook } from '@/components/domain/dashboard/admin-overlook';
import { Spinner } from '@/components/ui/spinner';
import { Card, CardContent } from '@/components/ui/card';
import { AlertCircle } from 'lucide-react';

export default function OverlookPage() {
  const { data, isLoading, error } = useDashboard();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <Card className="max-w-md mx-auto mt-12">
        <CardContent className="flex flex-col items-center justify-center py-12">
          <AlertCircle className="h-12 w-12 text-red-500 mb-4" />
          <h2 className="text-lg font-semibold text-text-main mb-2">
            Failed to load dashboard
          </h2>
          <p className="text-text-sub text-center">
            {error instanceof Error ? error.message : 'An unexpected error occurred'}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return null;
  }

  if (isTechDashboard(data)) {
    return <TechOverlook data={data} />;
  }

  if (isPmDashboard(data)) {
    return <PmOverlook data={data} />;
  }

  if (isAdminDashboard(data)) {
    return <AdminOverlook data={data} />;
  }

  // Fallback for unknown role
  return (
    <div className="text-center py-12">
      <h1 className="text-2xl font-bold text-text-main">Overlook</h1>
      <p className="text-text-sub mt-2">Welcome back!</p>
    </div>
  );
}
