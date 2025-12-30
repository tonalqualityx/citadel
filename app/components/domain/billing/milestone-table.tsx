'use client';

import * as React from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { type UnbilledMilestone, useMarkMilestoneInvoiced } from '@/lib/hooks/use-billing';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';

interface MilestoneTableProps {
  milestones: UnbilledMilestone[];
  selectedIds: Set<string>;
  onSelectAll: (checked: boolean) => void;
  onSelectOne: (id: string, checked: boolean) => void;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatDate(dateString: string): string {
  try {
    return format(new Date(dateString), 'MMM d, yyyy');
  } catch {
    return '-';
  }
}

export function MilestoneTable({
  milestones,
  selectedIds,
  onSelectAll,
  onSelectOne,
}: MilestoneTableProps) {
  const markInvoicedMutation = useMarkMilestoneInvoiced();

  const allSelected = milestones.length > 0 && selectedIds.size === milestones.length;
  const someSelected = selectedIds.size > 0 && selectedIds.size < milestones.length;

  const handleMarkInvoiced = async (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await markInvoicedMutation.mutateAsync(id);
  };

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
              Name
            </th>
            <th className="px-3 py-2 text-right text-xs font-medium text-text-sub uppercase tracking-wider w-28">
              Amount
            </th>
            <th className="px-3 py-2 text-left text-xs font-medium text-text-sub uppercase tracking-wider">
              Project
            </th>
            <th className="px-3 py-2 text-left text-xs font-medium text-text-sub uppercase tracking-wider w-28">
              Triggered
            </th>
            <th className="px-3 py-2 text-right text-xs font-medium text-text-sub uppercase tracking-wider w-32">
              Action
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {milestones.map((milestone) => (
            <tr key={milestone.id} className="hover:bg-background-light/50">
              <td className="px-3 py-2">
                <Checkbox
                  checked={selectedIds.has(milestone.id)}
                  onCheckedChange={(checked) => onSelectOne(milestone.id, checked)}
                />
              </td>
              <td className="px-3 py-2">
                <span className="font-medium text-text-main">{milestone.name}</span>
              </td>
              <td className="px-3 py-2 text-right">
                <span className="font-medium text-text-main">
                  {formatCurrency(milestone.billing_amount)}
                </span>
              </td>
              <td className="px-3 py-2">
                <Link
                  href={`/projects/${milestone.project_id}`}
                  className="text-sm text-primary hover:underline"
                >
                  {milestone.project_name}
                </Link>
              </td>
              <td className="px-3 py-2">
                <span className="text-sm text-text-sub">
                  {formatDate(milestone.triggered_at)}
                </span>
              </td>
              <td className="px-3 py-2 text-right">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => handleMarkInvoiced(milestone.id, e)}
                  disabled={markInvoicedMutation.isPending}
                >
                  Mark Invoiced
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
