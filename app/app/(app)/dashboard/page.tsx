'use client';

import * as React from 'react';
import {
  useDashboard,
  isTechDashboard,
  isPmDashboard,
  isAdminDashboard,
  type TaskSortBy,
} from '@/lib/hooks/use-dashboard';
import { TechOverlook } from '@/components/domain/dashboard/tech-overlook';
import { PmOverlook } from '@/components/domain/dashboard/pm-overlook';
import { AdminOverlook } from '@/components/domain/dashboard/admin-overlook';
import { Spinner } from '@/components/ui/spinner';
import { Card, CardContent } from '@/components/ui/card';
import { AlertCircle } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { usePreferences } from '@/lib/hooks/use-preferences';

const LOCAL_STORAGE_KEY = 'dashboard-my-tasks-sort';

function getStoredSort(): TaskSortBy {
  if (typeof window === 'undefined') return 'priority';
  const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
  if (saved && ['priority', 'due_date', 'estimate'].includes(saved)) {
    return saved as TaskSortBy;
  }
  return 'priority';
}

function OverlookPage() {
  // My Tasks sort preference with localStorage persistence
  // Track hydration to avoid SSR/CSR mismatch
  const [isHydrated, setIsHydrated] = React.useState(false);
  const [myTasksSort, setMyTasksSort] = React.useState<TaskSortBy>('priority');

  // Hydrate from localStorage on client - runs once before first paint
  React.useEffect(() => {
    setMyTasksSort(getStoredSort());
    setIsHydrated(true);
  }, []);

  const handleSortChange = React.useCallback((sort: TaskSortBy) => {
    setMyTasksSort(sort);
    localStorage.setItem(LOCAL_STORAGE_KEY, sort);
  }, []);

  // Wait for hydration before fetching to get correct sort preference
  // This prevents a query with 'priority' being made before we read localStorage
  const { data, isLoading, error, loadMore, isLoadingMore } = useDashboard({
    orderBy: myTasksSort,
    enabled: isHydrated,
  });

  // Show loading during hydration or actual data loading
  if (!isHydrated || isLoading) {
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
    return <TechOverlook data={data} myTasksSort={myTasksSort} onMyTasksSortChange={handleSortChange} loadMore={loadMore} isLoadingMore={isLoadingMore} />;
  }

  if (isPmDashboard(data)) {
    return <PmOverlook data={data} myTasksSort={myTasksSort} onMyTasksSortChange={handleSortChange} loadMore={loadMore} isLoadingMore={isLoadingMore} />;
  }

  if (isAdminDashboard(data)) {
    return <AdminOverlook data={data} myTasksSort={myTasksSort} onMyTasksSortChange={handleSortChange} loadMore={loadMore} isLoadingMore={isLoadingMore} />;
  }

  // Fallback for unknown role
  return (
    <div className="text-center py-12">
      <h1 className="text-2xl font-bold text-text-main">Overlook</h1>
      <p className="text-text-sub mt-2">Welcome back!</p>
    </div>
  );
}

// Home screen Slice 1: only a user whose own preference is `home` gets HomeScreen.
// Everyone else, and any failed preferences call, gets the Overlook unchanged.
const HomeScreen = React.lazy(() =>
  import('@/components/domain/home/HomeScreen').then((m) => ({ default: m.HomeScreen })),
);

function RouteSpinner() {
  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <Spinner size="lg" />
    </div>
  );
}

// A preferences call still loading after this long sends the person to the Overlook.
const PREFERENCES_WAIT_MS = 3000;

function DashboardSwitch() {
  const { data, isLoading } = usePreferences();
  const searchParams = useSearchParams();
  // The server always renders the spinner, so the first client render must match it.
  const [mounted, setMounted] = React.useState(false);
  const [gaveUp, setGaveUp] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  React.useEffect(() => {
    if (!isLoading || gaveUp) return;
    const timer = setTimeout(() => setGaveUp(true), PREFERENCES_WAIT_MS);
    return () => clearTimeout(timer);
  }, [isLoading, gaveUp]);

  if (gaveUp) return <OverlookPage />;
  // Neutral loading state until the preference is known, so nobody sees the wrong screen flash.
  if (!mounted || isLoading) return <RouteSpinner />;

  if (data?.preferences?.home_view === 'home' && searchParams?.get('view') !== 'overlook') {
    return (
      <React.Suspense fallback={<RouteSpinner />}>
        <HomeScreen />
      </React.Suspense>
    );
  }
  return <OverlookPage />;
}

export default function DashboardRoute() {
  return (
    <React.Suspense fallback={<RouteSpinner />}>
      <DashboardSwitch />
    </React.Suspense>
  );
}
