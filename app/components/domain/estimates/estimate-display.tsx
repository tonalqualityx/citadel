'use client';

import * as React from 'react';
import { Clock, Timer, TrendingUp, Target } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils/cn';
import type { ProjectEstimates } from '@/lib/calculations/energy';

interface EstimateDisplayProps {
  estimates: ProjectEstimates;
  variant?: 'compact' | 'full';
  showProgress?: boolean;
  className?: string;
}

export function EstimateDisplay({
  estimates,
  variant = 'full',
  showProgress = true,
  className,
}: EstimateDisplayProps) {
  const {
    estimatedRange,
    estimatedHoursMin,
    estimatedHoursMax,
    timeSpentMinutes,
    taskCount,
    completedTaskCount,
    progressPercent,
  } = estimates;

  const timeSpentHours = Math.round((timeSpentMinutes / 60) * 10) / 10;

  if (variant === 'compact') {
    return (
      <div className={cn('flex items-center gap-4 text-sm', className)}>
        <div className="flex items-center gap-1.5">
          <Clock className="h-4 w-4 text-text-sub" />
          <span className="text-text-sub">Est:</span>
          <span className="font-medium text-text-main">{estimatedRange}</span>
        </div>
        {timeSpentMinutes > 0 && (
          <div className="flex items-center gap-1.5">
            <Timer className="h-4 w-4 text-text-sub" />
            <span className="text-text-sub">Spent:</span>
            <span className="font-medium text-text-main">{timeSpentHours}h</span>
          </div>
        )}
        {showProgress && (
          <Badge variant={progressPercent >= 100 ? 'success' : 'default'}>
            {progressPercent}% complete
          </Badge>
        )}
      </div>
    );
  }

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          Project Estimates
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Estimate Range */}
        <div className="grid grid-cols-2 gap-4">
          <div className="p-3 rounded-lg bg-surface-2">
            <div className="flex items-center gap-1.5 mb-1">
              <Clock className="h-4 w-4 text-primary" />
              <span className="text-xs text-text-sub font-medium">Estimated</span>
            </div>
            <p className="text-lg font-semibold text-text-main">{estimatedRange}</p>
            <p className="text-xs text-text-sub mt-0.5">
              {estimatedHoursMin === estimatedHoursMax
                ? 'No uncertainty'
                : 'Including mystery factors'}
            </p>
          </div>

          <div className="p-3 rounded-lg bg-surface-2">
            <div className="flex items-center gap-1.5 mb-1">
              <Timer className="h-4 w-4 text-primary" />
              <span className="text-xs text-text-sub font-medium">Time Spent</span>
            </div>
            <p className="text-lg font-semibold text-text-main">
              {timeSpentHours > 0 ? `${timeSpentHours}h` : '--'}
            </p>
            <p className="text-xs text-text-sub mt-0.5">
              {timeSpentMinutes > 0
                ? `${formatMinutesDetailed(timeSpentMinutes)} logged`
                : 'No time logged yet'}
            </p>
          </div>
        </div>

        {/* Progress Bar */}
        {showProgress && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm text-text-sub">Energy Progress</span>
              <span className="text-sm font-medium text-text-main">{progressPercent}%</span>
            </div>
            <div className="h-2 bg-surface-2 rounded-full overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-500',
                  progressPercent >= 100
                    ? 'bg-green-500'
                    : progressPercent >= 75
                    ? 'bg-primary'
                    : progressPercent >= 50
                    ? 'bg-amber-500'
                    : 'bg-primary'
                )}
                style={{ width: `${Math.min(progressPercent, 100)}%` }}
              />
            </div>
            <p className="text-xs text-text-sub mt-1">
              {completedTaskCount} of {taskCount} tasks complete
              {progressPercent > 0 && progressPercent !== Math.round((completedTaskCount / taskCount) * 100) && (
                <span className="text-text-sub"> (weighted by effort)</span>
              )}
            </p>
          </div>
        )}

        {/* Budget Comparison - only if time is being tracked */}
        {timeSpentMinutes > 0 && (
          <BudgetStatus
            timeSpentMinutes={timeSpentMinutes}
            estimatedMinutesMin={estimatedHoursMin * 60}
            estimatedMinutesMax={estimatedHoursMax * 60}
            progressPercent={progressPercent}
          />
        )}
      </CardContent>
    </Card>
  );
}

interface BudgetStatusProps {
  timeSpentMinutes: number;
  estimatedMinutesMin: number;
  estimatedMinutesMax: number;
  progressPercent: number;
}

function BudgetStatus({
  timeSpentMinutes,
  estimatedMinutesMin,
  estimatedMinutesMax,
  progressPercent,
}: BudgetStatusProps) {
  // Calculate where we should be based on progress
  const expectedMinutesMin = (progressPercent / 100) * estimatedMinutesMin;
  const expectedMinutesMax = (progressPercent / 100) * estimatedMinutesMax;

  // Determine status
  let status: 'on-track' | 'warning' | 'over';
  let statusText: string;

  if (timeSpentMinutes <= expectedMinutesMin) {
    status = 'on-track';
    statusText = 'Ahead of schedule';
  } else if (timeSpentMinutes <= expectedMinutesMax) {
    status = 'on-track';
    statusText = 'On track';
  } else if (timeSpentMinutes <= expectedMinutesMax * 1.1) {
    status = 'warning';
    statusText = 'Slightly over estimate';
  } else {
    status = 'over';
    statusText = 'Over estimate';
  }

  return (
    <div className="flex items-center gap-2 pt-2 border-t border-border">
      <Target className="h-4 w-4 text-text-sub" />
      <span className="text-sm text-text-sub">Status:</span>
      <Badge
        variant={
          status === 'on-track' ? 'success' : status === 'warning' ? 'warning' : 'warning'
        }
      >
        {statusText}
      </Badge>
    </div>
  );
}

function formatMinutesDetailed(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  if (hours === 0) {
    return `${mins}m`;
  } else if (mins === 0) {
    return `${hours}h`;
  } else {
    return `${hours}h ${mins}m`;
  }
}
