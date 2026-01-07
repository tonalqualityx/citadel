'use client';

import * as React from 'react';
import { cn } from '@/lib/utils/cn';

interface RetainerSummaryProps {
  retainerHours: number;
  usedHours: number;
}

export function RetainerSummary({ retainerHours, usedHours }: RetainerSummaryProps) {
  const percentUsed = Math.min((usedHours / retainerHours) * 100, 100);
  const remaining = Math.max(retainerHours - usedHours, 0);
  const overage = Math.max(usedHours - retainerHours, 0);
  const isOverage = usedHours > retainerHours;
  const isWarning = percentUsed >= 80 && percentUsed < 100;

  // Determine status and colors
  let status: 'ok' | 'warning' | 'over' = 'ok';
  if (isOverage) {
    status = 'over';
  } else if (isWarning) {
    status = 'warning';
  }

  return (
    <div
      className={cn(
        'p-4 rounded-lg border',
        status === 'ok' && 'bg-green-50 border-green-200',
        status === 'warning' && 'bg-amber-50 border-amber-200',
        status === 'over' && 'bg-red-50 border-red-200'
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-text-main">
          Retainer Hours (This Month)
        </span>
        <span
          className={cn(
            'text-sm font-medium',
            status === 'ok' && 'text-green-700',
            status === 'warning' && 'text-amber-700',
            status === 'over' && 'text-red-700'
          )}
        >
          {usedHours.toFixed(1)} / {retainerHours} hrs
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-2 bg-surface-alt rounded-full overflow-hidden">
        <div
          className={cn(
            'h-full rounded-full transition-all duration-300',
            status === 'ok' && 'bg-green-500',
            status === 'warning' && 'bg-amber-500',
            status === 'over' && 'bg-red-500'
          )}
          style={{ width: `${Math.min(percentUsed, 100)}%` }}
        />
      </div>

      {/* Status text */}
      <div className="mt-2 text-xs">
        {status === 'ok' && (
          <span className="text-green-700">
            {remaining.toFixed(1)} hours remaining
          </span>
        )}
        {status === 'warning' && (
          <span className="text-amber-700">
            Only {remaining.toFixed(1)} hours remaining ({percentUsed.toFixed(0)}% used)
          </span>
        )}
        {status === 'over' && (
          <span className="text-red-700">
            {overage.toFixed(1)} hours over limit - bill for overage
          </span>
        )}
      </div>
    </div>
  );
}
