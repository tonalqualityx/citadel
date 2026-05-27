'use client';

import * as React from 'react';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils/cn';
import { useCharterUsage } from '@/lib/hooks/use-charters';

interface UsageTrackerProps {
  charterId: string;
  budgetHours: number | null;
}

type TaskType = 'scheduled' | 'ad_hoc' | 'commission';

interface UsageTask {
  id: string;
  title: string;
  status: string;
  estimated_minutes: number | null;
  estimate_low_minutes: number | null;
  estimate_high_minutes: number | null;
  time_spent_minutes: number;
  task_type: TaskType;
  project_name: string | null;
}

interface CommissionAllocation {
  commission_id: string;
  commission_name: string | null;
  allocated_hours_per_period: number | null;
}

interface UsageData {
  used_hours: number;
  planned_low_hours: number;
  planned_high_hours: number;
  hourly_rate: number | null;
  spent_amount: number | null;
  anticipated_low_amount: number | null;
  anticipated_high_amount: number | null;
  budget_amount: number | null;
  commission_allocations?: CommissionAllocation[];
  total_allocated_hours?: number;
  tasks?: UsageTask[];
}

const COMPLETED_STATUSES = ['done', 'abandoned'];

const TASK_TYPE_LABELS: Record<TaskType, string> = {
  scheduled: 'Scheduled',
  ad_hoc: 'Ad Hoc',
  commission: 'Commission',
};

const TASK_TYPE_ORDER: TaskType[] = ['scheduled', 'commission', 'ad_hoc'];

function formatH(hours: number): string {
  if (hours < 1 && hours > 0) {
    return `${Math.round(hours * 60)}m`;
  }
  return `${hours.toFixed(1)}h`;
}

function formatMoney(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function groupByType(tasks: UsageTask[]): Map<TaskType, UsageTask[]> {
  const groups = new Map<TaskType, UsageTask[]>();
  for (const task of tasks) {
    const type = task.task_type || 'ad_hoc';
    const arr = groups.get(type) ?? [];
    arr.push(task);
    groups.set(type, arr);
  }
  return groups;
}

function TaskGroup({
  type,
  tasks,
  isCompleted,
}: {
  type: TaskType;
  tasks: UsageTask[];
  isCompleted: boolean;
}) {
  return (
    <div className="space-y-1">
      <h5 className="text-[10px] font-semibold text-text-sub/60 uppercase tracking-wider">
        {TASK_TYPE_LABELS[type]}
        {type === 'commission' && tasks[0]?.project_name && (
          <span className="normal-case font-normal ml-1">— {tasks[0].project_name}</span>
        )}
      </h5>
      {tasks.map((task) => {
        if (isCompleted) {
          return (
            <div key={task.id} className="flex items-center justify-between text-sm">
              <Link
                href={`/tasks/${task.id}`}
                className="text-text-main truncate mr-4 hover:text-primary transition-colors"
                title={task.title}
              >
                {task.title}
              </Link>
              <span className="text-text-sub whitespace-nowrap">
                {formatH(task.time_spent_minutes / 60)}
              </span>
            </div>
          );
        }

        const low = task.estimate_low_minutes;
        const high = task.estimate_high_minutes;
        const hasTime = task.time_spent_minutes > 0;
        const hasRange = low != null && high != null;

        let display: string;
        if (hasTime) {
          display = formatH(task.time_spent_minutes / 60);
        } else if (hasRange) {
          display = low === high
            ? formatH(low / 60)
            : `${formatH(low / 60)} – ${formatH(high / 60)}`;
        } else {
          display = '--';
        }

        return (
          <div key={task.id} className="flex items-center justify-between text-sm">
            <Link
              href={`/tasks/${task.id}`}
              className="text-text-main truncate mr-4 hover:text-primary transition-colors"
              title={task.title}
            >
              {task.title}
            </Link>
            <span className="text-text-sub whitespace-nowrap">
              {display}
              {!hasTime && hasRange && (
                <span className="text-xs ml-1 opacity-60">est</span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function TaskColumn({
  title,
  tasks,
  isCompleted,
  totalDisplay,
}: {
  title: string;
  tasks: UsageTask[];
  isCompleted: boolean;
  totalDisplay: string;
}) {
  const grouped = groupByType(tasks);
  const orderedTypes = TASK_TYPE_ORDER.filter((t) => grouped.has(t));
  const hasMultipleTypes = orderedTypes.length > 1;

  return (
    <div>
      <h4 className="text-xs font-medium text-text-sub uppercase tracking-wide mb-2">
        {title}
      </h4>
      {tasks.length > 0 ? (
        <div className="space-y-3">
          {hasMultipleTypes ? (
            orderedTypes.map((type) => (
              <TaskGroup
                key={type}
                type={type}
                tasks={grouped.get(type)!}
                isCompleted={isCompleted}
              />
            ))
          ) : (
            // Single type — no sub-headers needed
            orderedTypes.map((type) => (
              <div key={type} className="space-y-1">
                {grouped.get(type)!.map((task) => (
                  <TaskGroup
                    key={task.id}
                    type={type}
                    tasks={[task]}
                    isCompleted={isCompleted}
                  />
                ))}
              </div>
            ))
          )}
          <div className="flex items-center justify-between text-sm font-medium pt-1 border-t border-border-warm">
            <span className="text-text-sub">Total</span>
            <span className="text-text-main">{totalDisplay}</span>
          </div>
        </div>
      ) : (
        <p className="text-sm text-text-sub italic">
          No {title.toLowerCase()} tasks
        </p>
      )}
    </div>
  );
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
  const plannedLow = usage.planned_low_hours ?? 0;
  const plannedHigh = usage.planned_high_hours ?? 0;
  const hasBudget = budgetHours != null && budgetHours > 0;

  // Committed = used + planned range
  const committedLow = usedHours + plannedLow;
  const committedHigh = usedHours + plannedHigh;

  // Percentages for stacked bar
  const usedPct = hasBudget ? (usedHours / budgetHours) * 100 : 0;
  const plannedLowPct = hasBudget ? (plannedLow / budgetHours) * 100 : 0;
  const plannedHighPct = hasBudget ? (plannedHigh / budgetHours) * 100 : 0;
  const isOverBudget = hasBudget && committedHigh > budgetHours;

  // Bar color based on high-end commitment
  const totalHighPct = usedPct + plannedHighPct;
  const barColor = totalHighPct > 100
    ? 'bg-[var(--error)]'
    : totalHighPct > 80
      ? 'bg-[var(--warning)]'
      : 'bg-[var(--success)]';

  const allTasks = usage.tasks ?? [];
  const completedTasks = allTasks.filter((t) =>
    COMPLETED_STATUSES.includes(t.status)
  );
  const plannedTasks = allTasks.filter(
    (t) => !COMPLETED_STATUSES.includes(t.status)
  );

  const plannedTotalDisplay = plannedLow === plannedHigh
    ? formatH(plannedLow)
    : `${formatH(plannedLow)} – ${formatH(plannedHigh)}`;

  // Commission allocation info
  const allocations = usage.commission_allocations ?? [];
  const totalAllocated = usage.total_allocated_hours ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Usage</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary line — hours left, spend right */}
        <div className="flex items-baseline justify-between">
          <div className="flex items-baseline gap-3">
            <span className="text-2xl font-semibold text-text-main">
              {formatH(usedHours)}
            </span>
            <span className="text-sm text-text-sub">used</span>
            {(plannedLow > 0 || plannedHigh > 0) && (
              <>
                <span className="text-lg font-medium text-text-sub">
                  + {plannedLow === plannedHigh
                    ? formatH(plannedLow)
                    : `${formatH(plannedLow)} – ${formatH(plannedHigh)}`}
                </span>
                <span className="text-sm text-text-sub">planned</span>
              </>
            )}
            {hasBudget && (
              <span className="text-sm text-text-sub">
                of {budgetHours}h
              </span>
            )}
          </div>
          {usage.hourly_rate != null && (
            <div className="flex items-baseline gap-3 text-right">
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-semibold text-text-main">
                  {formatMoney(usage.spent_amount ?? 0)}
                </span>
                <span className="text-sm text-text-sub">spent</span>
              </div>
              {usage.budget_amount != null && (() => {
                const anticipated = usage.anticipated_high_amount ?? 0;
                const budget = usage.budget_amount;
                const diff = anticipated - budget;
                const pctOver = budget > 0 ? (diff / budget) * 100 : 0;

                let statusColor: string;
                let statusText: string;
                if (pctOver > 0) {
                  statusColor = 'text-[var(--error)]';
                  statusText = `${formatMoney(diff)} over`;
                } else if (pctOver < -10) {
                  statusColor = 'text-[var(--warning)]';
                  statusText = `${formatMoney(Math.abs(diff))} under`;
                } else {
                  statusColor = 'text-[var(--success)]';
                  statusText = formatMoney(anticipated);
                }

                return (
                  <span className={cn('text-sm font-medium', statusColor)}>
                    {statusText}
                  </span>
                );
              })()}
            </div>
          )}
        </div>

        {/* Budget allocation breakdown */}
        {hasBudget && totalAllocated > 0 && (
          <div className="text-xs text-text-sub flex items-center gap-3">
            <span>Budget: {budgetHours}h</span>
            <span>•</span>
            <span>Commission allocation: {totalAllocated}h</span>
            <span>•</span>
            <span>Available: {Math.max(0, budgetHours - totalAllocated)}h</span>
          </div>
        )}

        {/* Layered progress bar */}
        {hasBudget && (
          <div className="space-y-1">
            <div className="h-3 w-full rounded-full bg-background-light overflow-hidden relative">
              {/* Layer 1: High estimate range (lightest) */}
              {plannedHighPct > 0 && (
                <div
                  className={cn('absolute inset-y-0 left-0 rounded-full transition-all opacity-20', barColor)}
                  style={{ width: `${Math.min(usedPct + plannedHighPct, 100)}%` }}
                />
              )}
              {/* Layer 2: Low estimate range (medium) */}
              {plannedLowPct > 0 && (
                <div
                  className={cn('absolute inset-y-0 left-0 rounded-full transition-all opacity-40', barColor)}
                  style={{ width: `${Math.min(usedPct + plannedLowPct, 100)}%` }}
                />
              )}
              {/* Layer 3: Actual used (solid) */}
              <div
                className={cn('absolute inset-y-0 left-0 rounded-full transition-all', barColor)}
                style={{ width: `${Math.min(usedPct, 100)}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-text-sub">
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <span className={cn('inline-block w-2 h-2 rounded-full', barColor)} />
                  Used {usedPct.toFixed(0)}%
                </span>
                {(plannedLow > 0 || plannedHigh > 0) && (
                  <span className="flex items-center gap-1">
                    <span className={cn('inline-block w-2 h-2 rounded-full opacity-30', barColor)} />
                    Planned {plannedLow === plannedHigh
                      ? `${(usedPct + plannedLowPct).toFixed(0)}%`
                      : `${(usedPct + plannedLowPct).toFixed(0)}–${(usedPct + plannedHighPct).toFixed(0)}%`}
                  </span>
                )}
              </div>
              {isOverBudget && (
                <span className="text-[var(--error)] font-medium">
                  {formatH(committedHigh - budgetHours)} over
                </span>
              )}
            </div>
          </div>
        )}

        {/* Two-column task breakdown */}
        {(completedTasks.length > 0 || plannedTasks.length > 0) && (
          <div className="pt-2 border-t border-border-warm grid grid-cols-1 md:grid-cols-2 gap-6">
            <TaskColumn
              title="Planned"
              tasks={plannedTasks}
              isCompleted={false}
              totalDisplay={plannedTotalDisplay}
            />
            <TaskColumn
              title="Completed"
              tasks={completedTasks}
              isCompleted={true}
              totalDisplay={formatH(usedHours)}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
