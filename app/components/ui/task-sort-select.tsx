'use client';

import * as React from 'react';
import { ChevronDown, ArrowUpDown } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

export type TaskSortBy = 'priority' | 'due_date' | 'estimate';

export const sortByOptions: { value: TaskSortBy; label: string }[] = [
  { value: 'priority', label: 'Priority' },
  { value: 'due_date', label: 'Due Date' },
  { value: 'estimate', label: 'Estimate' },
];

interface TaskSortSelectProps {
  value: TaskSortBy;
  onChange: (value: TaskSortBy) => void;
  className?: string;
  compact?: boolean;
}

export function TaskSortSelect({
  value,
  onChange,
  className,
  compact = false,
}: TaskSortSelectProps) {
  const selectId = React.useId();

  return (
    <div className={cn('relative', className)}>
      {!compact && (
        <ArrowUpDown className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-sub pointer-events-none" />
      )}
      <select
        id={selectId}
        value={value}
        onChange={(e) => onChange(e.target.value as TaskSortBy)}
        className={cn(
          'h-9 rounded-lg border border-border-warm bg-surface',
          'text-sm text-text-main appearance-none cursor-pointer',
          'focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary',
          'transition-colors',
          compact ? 'pl-3 pr-8' : 'pl-9 pr-8'
        )}
        title="Sort tasks"
      >
        {sortByOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-text-sub pointer-events-none" />
    </div>
  );
}
