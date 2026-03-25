'use client';

import * as React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils/cn';
import { useCharterUsage } from '@/lib/hooks/use-charters';

interface UsageTrackerProps {
  charterId: string;
  budgetHours: number | null;
}

interface UsageTask {
  id: string;
  title: string;
  time_spent: number;
}

interface UsageData {
  used_hours: number;
  tasks?: UsageTask[];
}

export function UsageTracker({ charterId, budgetHours }: UsageTrackerProps) {
  const { data, isLoading, isError } = useCharterUsage(charterId);
  const usage = data as UsageData | undefined;

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6 flex items-center justify-center">
          <Spinner size="md" />
        </CardContent>
      </Card>
    );
  }

  if (isError || !usage) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-sm text-text-sub text-center">
            Failed to load usage data.
          </p>
        </CardContent>
      </Card>
    );
  }

  const usedHours = usage.used_hours ?? 0;
  const hasBudget = budgetHours != null && budgetHours > 0;
  const percentage = hasBudget ? Math.min((usedHours / budgetHours) * 100, 100) : 0;
  const isOverBudget = hasBudget && usedHours > budgetHours;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Usage</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Hours summary */}
        <div className="flex items-baseline justify-between">
          <span className="text-2xl font-semibold text-text-main">
            {usedHours.toFixed(1)}h
          </span>
          {hasBudget && (
            <span className="text-sm text-text-sub">
              of {budgetHours}h budget
            </span>
          )}
        </div>

        {/* Progress bar */}
        {hasBudget && (
          <div className="space-y-1">
            <div className="h-2 w-full rounded-full bg-background-light overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all',
                  isOverBudget
                    ? 'bg-[var(--error)]'
                    : percentage > 80
                      ? 'bg-[var(--warning)]'
                      : 'bg-[var(--success)]'
                )}
                style={{ width: `${Math.min(percentage, 100)}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-text-sub">
              <span>{percentage.toFixed(0)}% used</span>
              {isOverBudget && (
                <span className="text-[var(--error)] font-medium">
                  {(usedHours - budgetHours).toFixed(1)}h over
                </span>
              )}
            </div>
          </div>
        )}

        {/* Task breakdown */}
        {usage.tasks && usage.tasks.length > 0 && (
          <div className="pt-2 border-t border-border-warm">
            <h4 className="text-xs font-medium text-text-sub uppercase tracking-wide mb-2">
              Tasks
            </h4>
            <div className="space-y-2">
              {usage.tasks.map((task) => (
                <div
                  key={task.id}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="text-text-main truncate mr-4">
                    {task.title}
                  </span>
                  <span className="text-text-sub whitespace-nowrap">
                    {task.time_spent.toFixed(1)}h
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
