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
  Calendar,
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
  reservedHours: number;
  status: 'under' | 'target' | 'over';
}

interface UtilizationResponse {
  period: { start: string; end: string; type: 'week' | 'month' };
  team: UserUtilization[];
  summary: {
    totalHours: number;
    billableHours: number;
    avgUtilization: number;
    targetHours: number;
    reservedHours: number;
  };
}

// Get ISO week number for a date
function getISOWeek(date: Date): number {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

// Get the Monday of a given ISO week
function getWeekStart(year: number, week: number): Date {
  const jan4 = new Date(year, 0, 4);
  const jan4Day = jan4.getDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setDate(jan4.getDate() - jan4Day + 1);
  const targetMonday = new Date(week1Monday);
  targetMonday.setDate(week1Monday.getDate() + (week - 1) * 7);
  return targetMonday;
}

export default function GuildReportsPage() {
  const [periodType, setPeriodType] = useState<'week' | 'month'>('week');
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().getMonth() + 1);
  const [selectedWeek, setSelectedWeek] = useState(() => getISOWeek(new Date()));

  const { data, isLoading, error } = useQuery({
    queryKey: ['utilization', periodType, selectedYear, selectedMonth, selectedWeek],
    queryFn: () => {
      const params: Record<string, string> = {
        period: periodType,
        year: String(selectedYear),
      };
      if (periodType === 'month') {
        params.month = String(selectedMonth);
      } else {
        params.week = String(selectedWeek);
      }
      return apiClient.get<UtilizationResponse>('/reports/utilization', { params });
    },
  });

  const navigatePeriod = (direction: 'prev' | 'next') => {
    if (periodType === 'month') {
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
    } else {
      // Week navigation
      if (direction === 'prev') {
        if (selectedWeek === 1) {
          setSelectedYear((y) => y - 1);
          setSelectedWeek(52);
        } else {
          setSelectedWeek((w) => w - 1);
        }
      } else {
        if (selectedWeek === 52) {
          setSelectedYear((y) => y + 1);
          setSelectedWeek(1);
        } else {
          setSelectedWeek((w) => w + 1);
        }
      }
    }
  };

  const goToCurrentPeriod = () => {
    const now = new Date();
    setSelectedYear(now.getFullYear());
    if (periodType === 'month') {
      setSelectedMonth(now.getMonth() + 1);
    } else {
      setSelectedWeek(getISOWeek(now));
    }
  };

  const isCurrentPeriod = () => {
    const now = new Date();
    if (periodType === 'month') {
      return selectedYear === now.getFullYear() && selectedMonth === now.getMonth() + 1;
    } else {
      return selectedYear === now.getFullYear() && selectedWeek === getISOWeek(now);
    }
  };

  const getPeriodLabel = () => {
    if (periodType === 'month') {
      return new Date(selectedYear, selectedMonth - 1).toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric',
      });
    } else {
      const weekStart = getWeekStart(selectedYear, selectedWeek);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      return `Week ${selectedWeek}: ${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    }
  };

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

      {/* Period Type Toggle & Navigation */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            {/* Period Type Toggle */}
            <div className="flex items-center gap-1 bg-background-light rounded-lg p-1">
              <button
                onClick={() => setPeriodType('week')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  periodType === 'week'
                    ? 'bg-surface text-text-main shadow-sm'
                    : 'text-text-sub hover:text-text-main'
                }`}
              >
                Weekly
              </button>
              <button
                onClick={() => setPeriodType('month')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  periodType === 'month'
                    ? 'bg-surface text-text-main shadow-sm'
                    : 'text-text-sub hover:text-text-main'
                }`}
              >
                Monthly
              </button>
            </div>

            {/* Period Navigation */}
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => navigatePeriod('prev')}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              {!isCurrentPeriod() && (
                <Button variant="ghost" size="sm" onClick={goToCurrentPeriod}>
                  Today
                </Button>
              )}
              <span className="text-lg font-medium text-text-main min-w-[280px] text-center">
                {getPeriodLabel()}
              </span>
              <Button variant="ghost" size="sm" onClick={() => navigatePeriod('next')}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            {/* Spacer for balance */}
            <div className="w-[140px]" />
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      {data?.summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
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
                  <div className="text-sm text-text-sub">Hours Logged</div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="py-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-slate-100 text-slate-600">
                  <Calendar className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-text-main">
                    {data.summary.reservedHours}
                  </div>
                  <div className="text-sm text-text-sub">Reserved</div>
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
                  <div className="text-sm text-text-sub">Billable</div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="py-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-amber-100 text-amber-600">
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
                <div className="p-2 rounded-lg bg-slate-100 text-slate-600">
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

        {/* Hours breakdown - Logged vs Reserved vs Target */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div>
            <div className="text-lg font-semibold text-text-main">
              {user.totalHours}
            </div>
            <div className="text-xs text-text-sub">Logged</div>
          </div>
          <div>
            <div className="text-lg font-semibold text-text-main">
              {user.reservedHours}
            </div>
            <div className="text-xs text-text-sub">Reserved</div>
          </div>
          <div>
            <div className="text-lg font-semibold text-text-main">
              {user.targetHours}
            </div>
            <div className="text-xs text-text-sub">Target</div>
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
