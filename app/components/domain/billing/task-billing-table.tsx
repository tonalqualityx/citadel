'use client';

import * as React from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { type UnbilledTask, useMarkTaskInvoiced, useUpdateTaskBilling } from '@/lib/hooks/use-billing';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { formatDurationMinutes } from '@/lib/utils/time';
import {
  type EstimateType,
  calculateBillingAmount,
  formatCurrency,
} from '@/lib/calculations/billing';

interface TaskBillingTableProps {
  tasks: UnbilledTask[];
  hourlyRate: number | null;
  selectedIds: Set<string>;
  onSelectAll: (checked: boolean) => void;
  onSelectOne: (id: string, checked: boolean) => void;
  estimateTypes: Record<string, EstimateType>;
  onEstimateTypeChange: (taskId: string, type: EstimateType) => void;
  isRetainer?: boolean;
}

function formatDate(dateString: string | null): string {
  if (!dateString) return '-';
  try {
    return format(new Date(dateString), 'MMM d, yyyy');
  } catch {
    return '-';
  }
}

const ESTIMATE_OPTIONS = [
  { value: 'actual', label: 'Actual' },
  { value: 'low', label: 'Low' },
  { value: 'mid', label: 'Mid' },
  { value: 'high', label: 'High' },
];

export function TaskBillingTable({
  tasks,
  hourlyRate,
  selectedIds,
  onSelectAll,
  onSelectOne,
  estimateTypes,
  onEstimateTypeChange,
  isRetainer = false,
}: TaskBillingTableProps) {
  const markInvoicedMutation = useMarkTaskInvoiced();
  const updateBillingMutation = useUpdateTaskBilling();

  const allSelected = tasks.length > 0 && selectedIds.size === tasks.length;
  const someSelected = selectedIds.size > 0 && selectedIds.size < tasks.length;

  const handleMarkInvoiced = async (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await markInvoicedMutation.mutateAsync(id);
  };

  const handleToggleBillable = async (taskId: string, currentlyBillable: boolean) => {
    await updateBillingMutation.mutateAsync({
      taskId,
      data: { is_billable: !currentlyBillable },
    });
  };

  const handleToggleRetainer = async (taskId: string, currentlyRetainer: boolean) => {
    await updateBillingMutation.mutateAsync({
      taskId,
      data: { is_retainer_work: !currentlyRetainer },
    });
  };

  const handleToggleWaiveOverage = async (taskId: string, currentlyWaived: boolean) => {
    await updateBillingMutation.mutateAsync({
      taskId,
      data: { waive_overage: !currentlyWaived },
    });
  };

  if (tasks.length === 0) {
    return (
      <div className="border border-border rounded-lg p-4 text-center text-text-sub text-sm">
        No billable tasks
      </div>
    );
  }

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="bg-surface-alt border-b border-border">
            <th className="w-10 px-3 py-2">
              <Checkbox
                checked={allSelected}
                onCheckedChange={onSelectAll}
                className={someSelected ? 'opacity-50' : ''}
              />
            </th>
            <th className="px-3 py-2 text-left text-xs font-medium text-text-sub uppercase tracking-wider">
              Task
            </th>
            <th className="px-3 py-2 text-right text-xs font-medium text-text-sub uppercase tracking-wider w-24">
              Time
            </th>
            <th className="px-3 py-2 text-right text-xs font-medium text-text-sub uppercase tracking-wider w-20">
              Cap
            </th>
            <th className="px-3 py-2 text-right text-xs font-medium text-text-sub uppercase tracking-wider w-36">
              Amount
            </th>
            <th className="px-3 py-2 text-left text-xs font-medium text-text-sub uppercase tracking-wider">
              Project
            </th>
            <th className="px-3 py-2 text-center text-xs font-medium text-text-sub uppercase tracking-wider w-20">
              Retainer
            </th>
            <th className="px-3 py-2 text-center text-xs font-medium text-text-sub uppercase tracking-wider w-20">
              Billable
            </th>
            <th className="px-3 py-2 text-center text-xs font-medium text-text-sub uppercase tracking-wider w-28">
              Overage
            </th>
            {isRetainer && (
              <th className="px-3 py-2 text-center text-xs font-medium text-text-sub uppercase tracking-wider w-20">
                Waive
              </th>
            )}
            <th className="px-3 py-2 text-right text-xs font-medium text-text-sub uppercase tracking-wider w-32">
              Action
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {tasks.map((task) => {
            const hasFixedAmount = task.billing_amount != null && task.billing_amount > 0;
            const estimateType = estimateTypes[task.id] || 'mid';
            const amount = calculateBillingAmount(task, hourlyRate, estimateType);

            return (
              <tr key={task.id} className="hover:bg-background-light/50">
                <td className="px-3 py-2">
                  <Checkbox
                    checked={selectedIds.has(task.id)}
                    onCheckedChange={(checked) => onSelectOne(task.id, checked)}
                  />
                </td>
                <td className="px-3 py-2">
                  <Link
                    href={`/tasks/${task.id}`}
                    className="font-medium text-text-main hover:text-primary"
                  >
                    {task.title}
                  </Link>
                </td>
                <td className="px-3 py-2 text-right">
                  <span className="text-sm font-medium text-text-main">
                    {formatDurationMinutes(task.time_spent_minutes)}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  {task.billing_target ? (
                    <span
                      className={`text-sm ${
                        task.time_spent_minutes > task.billing_target
                          ? 'text-amber-600 font-medium'
                          : 'text-text-sub'
                      }`}
                    >
                      {formatDurationMinutes(task.billing_target)}
                      {task.time_spent_minutes > task.billing_target && (
                        <span className="text-xs ml-1">(over)</span>
                      )}
                    </span>
                  ) : (
                    <span className="text-text-sub text-sm">-</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="flex items-center justify-end gap-2">
                    {hasFixedAmount ? (
                      <span className="text-sm font-medium text-text-main">
                        {formatCurrency(task.billing_amount)}
                      </span>
                    ) : (
                      <>
                        <Select
                          options={ESTIMATE_OPTIONS}
                          value={estimateType}
                          onChange={(value) => onEstimateTypeChange(task.id, value as EstimateType)}
                          className="w-20 text-xs"
                        />
                        <span className="text-sm font-medium text-text-main min-w-[60px] text-right">
                          {formatCurrency(amount)}
                        </span>
                      </>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2">
                  {task.project_id && task.project_name ? (
                    <Link
                      href={`/projects/${task.project_id}`}
                      className="text-sm text-primary hover:underline"
                    >
                      {task.project_name}
                    </Link>
                  ) : (
                    <span className="text-sm text-text-sub">Ad-hoc</span>
                  )}
                </td>
                <td className="px-3 py-2 text-center">
                  <Checkbox
                    checked={task.is_retainer_work}
                    onCheckedChange={() => handleToggleRetainer(task.id, task.is_retainer_work)}
                    disabled={updateBillingMutation.isPending}
                  />
                </td>
                <td className="px-3 py-2 text-center">
                  <Checkbox
                    checked={task.is_billable}
                    onCheckedChange={() => handleToggleBillable(task.id, task.is_billable)}
                    disabled={updateBillingMutation.isPending}
                  />
                </td>
                <td className="px-3 py-2 text-center">
                  {task.is_overage_task ? (
                    <Badge variant="warning" size="sm">
                      {formatDurationMinutes(task.overage_minutes)} overage
                    </Badge>
                  ) : (
                    <span className="text-xs text-text-sub">Covered</span>
                  )}
                </td>
                {isRetainer && (
                  <td className="px-3 py-2 text-center">
                    {task.is_overage_task && (
                      <Checkbox
                        checked={task.waive_overage}
                        onCheckedChange={() => handleToggleWaiveOverage(task.id, task.waive_overage)}
                        disabled={updateBillingMutation.isPending}
                      />
                    )}
                  </td>
                )}
                <td className="px-3 py-2 text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => handleMarkInvoiced(task.id, e)}
                    disabled={markInvoicedMutation.isPending}
                  >
                    Mark Invoiced
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
