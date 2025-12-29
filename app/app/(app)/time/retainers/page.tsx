'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  Battery,
  AlertTriangle,
  CheckCircle,
  TrendingUp,
  ChevronLeft,
  ChevronRight,
  Users,
} from 'lucide-react';
import { apiClient } from '@/lib/api/client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';

interface RetainerStatus {
  clientId: string;
  clientName: string;
  periodStart: string;
  periodEnd: string;
  allocatedHours: number;
  usedHours: number;
  remainingHours: number;
  percentUsed: number;
  status: 'healthy' | 'warning' | 'critical' | 'exceeded';
}

interface RetainersResponse {
  retainers: RetainerStatus[];
  period: { start: string; end: string };
  summary: {
    total: number;
    exceeded: number;
    critical: number;
    warning: number;
    healthy: number;
  };
}

export default function RetainersPage() {
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().getMonth() + 1);

  const { data, isLoading, error } = useQuery({
    queryKey: ['retainers', selectedYear, selectedMonth],
    queryFn: () =>
      apiClient.get<RetainersResponse>('/reports/retainers', {
        params: { year: String(selectedYear), month: String(selectedMonth) },
      }),
  });

  const navigateMonth = (direction: 'prev' | 'next') => {
    if (direction === 'prev') {
      if (selectedMonth === 1) {
        setSelectedMonth(12);
        setSelectedYear((y) => y - 1);
      } else {
        setSelectedMonth((m) => m - 1);
      }
    } else {
      if (selectedMonth === 12) {
        setSelectedMonth(1);
        setSelectedYear((y) => y + 1);
      } else {
        setSelectedMonth((m) => m + 1);
      }
    }
  };

  const goToCurrentMonth = () => {
    setSelectedYear(new Date().getFullYear());
    setSelectedMonth(new Date().getMonth() + 1);
  };

  const monthName = new Date(selectedYear, selectedMonth - 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  const isCurrentMonth =
    selectedYear === new Date().getFullYear() &&
    selectedMonth === new Date().getMonth() + 1;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text-main flex items-center gap-2">
            <Battery className="h-6 w-6" />
            Retainer Tracking
          </h1>
          <p className="text-text-sub">Monitor client retainer usage</p>
        </div>
      </div>

      {/* Month Navigation */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => navigateMonth('prev')}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              {!isCurrentMonth && (
                <Button variant="ghost" size="sm" onClick={goToCurrentMonth}>
                  Today
                </Button>
              )}
              <span className="text-lg font-medium text-text-main min-w-[180px] text-center">
                {monthName}
              </span>
              <Button variant="ghost" size="sm" onClick={() => navigateMonth('next')}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            {data?.summary && (
              <div className="flex items-center gap-4 text-sm">
                <div className="flex items-center gap-1">
                  <span className="text-text-sub">Total:</span>
                  <span className="font-medium">{data.summary.total}</span>
                </div>
                {data.summary.exceeded > 0 && (
                  <div className="flex items-center gap-1 text-red-600">
                    <AlertTriangle className="h-4 w-4" />
                    <span>{data.summary.exceeded} exceeded</span>
                  </div>
                )}
                {data.summary.critical > 0 && (
                  <div className="flex items-center gap-1 text-amber-600">
                    <AlertTriangle className="h-4 w-4" />
                    <span>{data.summary.critical} critical</span>
                  </div>
                )}
                {data.summary.warning > 0 && (
                  <div className="flex items-center gap-1 text-yellow-600">
                    <TrendingUp className="h-4 w-4" />
                    <span>{data.summary.warning} warning</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Retainer Cards */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      ) : error ? (
        <Card>
          <CardContent className="py-8">
            <EmptyState
              icon={<AlertTriangle className="h-12 w-12" />}
              title="Error loading retainers"
              description="There was a problem loading retainer data."
              action={<Button onClick={() => window.location.reload()}>Retry</Button>}
            />
          </CardContent>
        </Card>
      ) : !data?.retainers.length ? (
        <Card>
          <CardContent className="py-8">
            <EmptyState
              icon={<Users className="h-12 w-12" />}
              title="No retainer clients"
              description="No clients have retainer hours configured for this period."
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {data.retainers.map((retainer) => (
            <RetainerCard key={retainer.clientId} retainer={retainer} />
          ))}
        </div>
      )}
    </div>
  );
}

function RetainerCard({ retainer }: { retainer: RetainerStatus }) {
  const statusConfig = {
    healthy: {
      color: 'text-green-600',
      bgColor: 'bg-green-500',
      trackColor: 'bg-green-100',
      icon: CheckCircle,
      label: 'On Track',
    },
    warning: {
      color: 'text-amber-600',
      bgColor: 'bg-amber-500',
      trackColor: 'bg-amber-100',
      icon: TrendingUp,
      label: '75%+ Used',
    },
    critical: {
      color: 'text-orange-600',
      bgColor: 'bg-orange-500',
      trackColor: 'bg-orange-100',
      icon: AlertTriangle,
      label: '90%+ Used',
    },
    exceeded: {
      color: 'text-red-600',
      bgColor: 'bg-red-500',
      trackColor: 'bg-red-100',
      icon: AlertTriangle,
      label: 'Exceeded',
    },
  };

  const config = statusConfig[retainer.status];
  const Icon = config.icon;
  const progressWidth = Math.min(retainer.percentUsed, 100);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div>
            <Link
              href={`/clients/${retainer.clientId}`}
              className="font-semibold text-text-main hover:text-primary transition-colors"
            >
              {retainer.clientName}
            </Link>
          </div>
          <div className={`flex items-center gap-1 text-xs ${config.color}`}>
            <Icon className="h-3.5 w-3.5" />
            <span>{config.label}</span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Progress bar */}
        <div className={`h-3 rounded-full ${config.trackColor} overflow-hidden mb-3`}>
          <div
            className={`h-full rounded-full ${config.bgColor} transition-all duration-500`}
            style={{ width: `${progressWidth}%` }}
          />
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-lg font-semibold text-text-main">
              {retainer.usedHours}
            </div>
            <div className="text-xs text-text-sub">Used</div>
          </div>
          <div>
            <div className="text-lg font-semibold text-text-main">
              {retainer.allocatedHours}
            </div>
            <div className="text-xs text-text-sub">Allocated</div>
          </div>
          <div>
            <div
              className={`text-lg font-semibold ${
                retainer.remainingHours < 0 ? 'text-red-600' : 'text-text-main'
              }`}
            >
              {retainer.remainingHours}
            </div>
            <div className="text-xs text-text-sub">
              {retainer.remainingHours < 0 ? 'Over' : 'Left'}
            </div>
          </div>
        </div>

        {/* Percentage */}
        <div className="mt-3 text-center">
          <span className={`text-2xl font-bold ${config.color}`}>
            {retainer.percentUsed}%
          </span>
          <span className="text-text-sub text-sm ml-1">used</span>
        </div>
      </CardContent>
    </Card>
  );
}
