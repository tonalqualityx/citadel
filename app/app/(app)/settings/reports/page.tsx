'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Users,
  Clock,
  DollarSign,
  TrendingUp,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  CheckCircle,
  ArrowUp,
} from 'lucide-react';
import { apiClient } from '@/lib/api/client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';

interface UserUtilization {
  userId: string;
  userName: string;
  totalMinutes: number;
  totalHours: number;
  billableMinutes: number;
  billableHours: number;
  nonBillableMinutes: number;
  nonBillableHours: number;
  billablePercent: number;
  targetHours: number;
  utilizationPercent: number;
  status: 'under' | 'target' | 'over';
}

interface UtilizationResponse {
  period: { start: string; end: string };
  team: UserUtilization[];
  summary: {
    totalHours: number;
    billableHours: number;
    avgUtilization: number;
    targetHours: number;
  };
}

export default function GuildReportsPage() {
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().getMonth() + 1);

  const { data, isLoading, error } = useQuery({
    queryKey: ['utilization', selectedYear, selectedMonth],
    queryFn: () =>
      apiClient.get<UtilizationResponse>('/reports/utilization', {
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
            <TrendingUp className="h-6 w-6" />
            Team Utilization
          </h1>
          <p className="text-text-sub">Monitor team workload and billable hours</p>
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
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      {data?.summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="py-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-100 text-blue-600">
                  <Clock className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-text-main">
                    {data.summary.totalHours}
                  </div>
                  <div className="text-sm text-text-sub">Total Hours</div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="py-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-green-100 text-green-600">
                  <DollarSign className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-text-main">
                    {data.summary.billableHours}
                  </div>
                  <div className="text-sm text-text-sub">Billable Hours</div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="py-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-purple-100 text-purple-600">
                  <TrendingUp className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-text-main">
                    {data.summary.avgUtilization}%
                  </div>
                  <div className="text-sm text-text-sub">Avg Utilization</div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="py-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-amber-100 text-amber-600">
                  <Users className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-text-main">
                    {data.team.length}
                  </div>
                  <div className="text-sm text-text-sub">Team Members</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Team Utilization */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      ) : error ? (
        <Card>
          <CardContent className="py-8">
            <EmptyState
              icon={<AlertTriangle className="h-12 w-12" />}
              title="Error loading data"
              description="There was a problem loading utilization data."
              action={<Button onClick={() => window.location.reload()}>Retry</Button>}
            />
          </CardContent>
        </Card>
      ) : !data?.team.length ? (
        <Card>
          <CardContent className="py-8">
            <EmptyState
              icon={<Users className="h-12 w-12" />}
              title="No team members"
              description="No active team members found."
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {data.team.map((user) => (
            <UtilizationCard key={user.userId} user={user} />
          ))}
        </div>
      )}
    </div>
  );
}

function UtilizationCard({ user }: { user: UserUtilization }) {
  const statusConfig = {
    under: {
      color: 'text-amber-600',
      bgColor: 'bg-amber-500',
      trackColor: 'bg-amber-100',
      icon: AlertTriangle,
      label: 'Under Target',
    },
    target: {
      color: 'text-green-600',
      bgColor: 'bg-green-500',
      trackColor: 'bg-green-100',
      icon: CheckCircle,
      label: 'On Target',
    },
    over: {
      color: 'text-red-600',
      bgColor: 'bg-red-500',
      trackColor: 'bg-red-100',
      icon: ArrowUp,
      label: 'Over Target',
    },
  };

  const config = statusConfig[user.status];
  const Icon = config.icon;
  const progressWidth = Math.min(user.utilizationPercent, 120);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-lg">{user.userName}</CardTitle>
          </div>
          <div className={`flex items-center gap-1 text-xs ${config.color}`}>
            <Icon className="h-3.5 w-3.5" />
            <span>{config.label}</span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Utilization Progress bar */}
        <div className="mb-4">
          <div className="flex justify-between text-sm mb-1">
            <span className="text-text-sub">Utilization</span>
            <span className={`font-medium ${config.color}`}>
              {user.utilizationPercent}%
            </span>
          </div>
          <div className="h-3 bg-background-light rounded-full overflow-hidden relative">
            {/* Target marker at 100% */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-text-sub z-10"
              style={{ left: `${Math.min(100 / 1.2 * 100 / 100, 100)}%` }}
            />
            <div
              className={`h-full rounded-full ${config.bgColor} transition-all duration-500`}
              style={{ width: `${Math.min(progressWidth / 1.2, 100)}%` }}
            />
          </div>
        </div>

        {/* Hours breakdown */}
        <div className="grid grid-cols-2 gap-4 mb-3">
          <div>
            <div className="text-lg font-semibold text-text-main">
              {user.totalHours}
            </div>
            <div className="text-xs text-text-sub">Total Hours</div>
          </div>
          <div>
            <div className="text-lg font-semibold text-text-main">
              {user.targetHours}
            </div>
            <div className="text-xs text-text-sub">Target Hours</div>
          </div>
        </div>

        {/* Billable breakdown */}
        <div className="border-t border-border-warm pt-3">
          <div className="flex justify-between text-sm mb-1">
            <span className="text-text-sub">Billable</span>
            <span className="font-medium text-green-600">
              {user.billableHours} hrs ({user.billablePercent}%)
            </span>
          </div>
          <div className="h-2 bg-background-light rounded-full overflow-hidden">
            <div
              className="h-full rounded-full bg-green-500 transition-all duration-500"
              style={{ width: `${user.billablePercent}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-text-sub mt-2">
            <span>Non-billable: {user.nonBillableHours} hrs</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
