'use client';

import * as React from 'react';
import { ChevronDown, Building2 } from 'lucide-react';
import { type ClientUnbilledData, useBatchInvoice } from '@/lib/hooks/use-billing';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';
import { MilestoneTable } from './milestone-table';
import { TaskBillingTable } from './task-billing-table';
import { RetainerSummary } from './retainer-summary';
import { minutesToDecimalHours } from '@/lib/utils/time';

interface ClientBillingSectionProps {
  clientData: ClientUnbilledData;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function ClientBillingSection({ clientData }: ClientBillingSectionProps) {
  const [isOpen, setIsOpen] = React.useState(true);
  const [selectedMilestones, setSelectedMilestones] = React.useState<Set<string>>(new Set());
  const [selectedTasks, setSelectedTasks] = React.useState<Set<string>>(new Set());

  const batchInvoiceMutation = useBatchInvoice();

  const hasMilestones = clientData.milestones.length > 0;
  const hasTasks = clientData.tasks.length > 0;
  const hasSelection = selectedMilestones.size > 0 || selectedTasks.size > 0;

  // Calculate totals for display
  const taskHours = minutesToDecimalHours(clientData.totalTaskMinutes);
  const estimatedTaskValue = clientData.hourlyRate
    ? clientData.totalTaskMinutes / 60 * clientData.hourlyRate
    : null;

  const handleSelectAllMilestones = (checked: boolean) => {
    if (checked) {
      setSelectedMilestones(new Set(clientData.milestones.map((m) => m.id)));
    } else {
      setSelectedMilestones(new Set());
    }
  };

  const handleSelectMilestone = (id: string, checked: boolean) => {
    const newSet = new Set(selectedMilestones);
    if (checked) {
      newSet.add(id);
    } else {
      newSet.delete(id);
    }
    setSelectedMilestones(newSet);
  };

  const handleSelectAllTasks = (checked: boolean) => {
    if (checked) {
      setSelectedTasks(new Set(clientData.tasks.map((t) => t.id)));
    } else {
      setSelectedTasks(new Set());
    }
  };

  const handleSelectTask = (id: string, checked: boolean) => {
    const newSet = new Set(selectedTasks);
    if (checked) {
      newSet.add(id);
    } else {
      newSet.delete(id);
    }
    setSelectedTasks(newSet);
  };

  const handleBatchInvoice = async () => {
    if (!hasSelection) return;

    await batchInvoiceMutation.mutateAsync({
      milestone_ids: selectedMilestones.size > 0 ? Array.from(selectedMilestones) : undefined,
      task_ids: selectedTasks.size > 0 ? Array.from(selectedTasks) : undefined,
    });

    // Clear selections after successful invoice
    setSelectedMilestones(new Set());
    setSelectedTasks(new Set());
  };

  const handleInvoiceAll = async () => {
    const allMilestoneIds = clientData.milestones.map((m) => m.id);
    const allTaskIds = clientData.tasks.map((t) => t.id);

    await batchInvoiceMutation.mutateAsync({
      milestone_ids: allMilestoneIds.length > 0 ? allMilestoneIds : undefined,
      task_ids: allTaskIds.length > 0 ? allTaskIds : undefined,
    });

    setSelectedMilestones(new Set());
    setSelectedTasks(new Set());
  };

  return (
    <Card>
      {/* Header */}
      <CardHeader
        className={cn(
          'cursor-pointer select-none',
          'hover:bg-background-light/50 transition-colors'
        )}
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ChevronDown
              className={cn(
                'h-5 w-5 text-text-sub transition-transform duration-200',
                isOpen && 'rotate-180'
              )}
            />
            <Building2 className="h-5 w-5 text-text-sub" />
            <div>
              <CardTitle className="text-base">
                {clientData.clientName}
                {clientData.parentAgencyName && (
                  <span className="text-text-sub font-normal ml-2">
                    via {clientData.parentAgencyName}
                  </span>
                )}
              </CardTitle>
              <div className="flex items-center gap-2 mt-1">
                {clientData.isRetainer && (
                  <Badge variant="info" size="sm">Retainer</Badge>
                )}
                {clientData.hourlyRate && (
                  <span className="text-xs text-text-sub">
                    {formatCurrency(clientData.hourlyRate)}/hr
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4" onClick={(e) => e.stopPropagation()}>
            {/* Summary badges */}
            <div className="flex items-center gap-2">
              {hasMilestones && (
                <Badge variant="default">
                  {clientData.milestones.length} milestone{clientData.milestones.length !== 1 ? 's' : ''}
                </Badge>
              )}
              {hasTasks && (
                <Badge variant="default">
                  {clientData.tasks.length} task{clientData.tasks.length !== 1 ? 's' : ''}
                </Badge>
              )}
            </div>

            {/* Actions */}
            {hasSelection ? (
              <Button
                size="sm"
                onClick={handleBatchInvoice}
                disabled={batchInvoiceMutation.isPending}
              >
                {batchInvoiceMutation.isPending ? 'Invoicing...' : `Invoice Selected (${selectedMilestones.size + selectedTasks.size})`}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                onClick={handleInvoiceAll}
                disabled={batchInvoiceMutation.isPending}
              >
                {batchInvoiceMutation.isPending ? 'Invoicing...' : 'Invoice All'}
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      {/* Content */}
      {isOpen && (
        <div className="px-6 pb-6 space-y-6">
          {/* Retainer Summary */}
          {clientData.isRetainer && clientData.retainerHours && (
            <RetainerSummary
              retainerHours={clientData.retainerHours}
              usedHours={clientData.usedRetainerHoursThisMonth}
            />
          )}

          {/* Milestones Table */}
          {hasMilestones && (
            <div>
              <h4 className="text-sm font-medium text-text-main mb-3">
                Triggered Milestones
              </h4>
              <MilestoneTable
                milestones={clientData.milestones}
                selectedIds={selectedMilestones}
                onSelectAll={handleSelectAllMilestones}
                onSelectOne={handleSelectMilestone}
              />
            </div>
          )}

          {/* Tasks Table */}
          {hasTasks && (
            <div>
              <h4 className="text-sm font-medium text-text-main mb-3">
                Completed Tasks
              </h4>
              <TaskBillingTable
                tasks={clientData.tasks}
                selectedIds={selectedTasks}
                onSelectAll={handleSelectAllTasks}
                onSelectOne={handleSelectTask}
              />
            </div>
          )}

          {/* Totals */}
          <div className="pt-4 border-t border-border flex items-center justify-between">
            <div className="text-sm text-text-sub">
              <span className="font-medium text-text-main">Totals:</span>
              {hasMilestones && (
                <span className="ml-4">
                  Milestones: {formatCurrency(clientData.totalMilestoneAmount)}
                </span>
              )}
              {hasTasks && (
                <span className="ml-4">
                  Tasks: {taskHours} hrs
                  {estimatedTaskValue && (
                    <span className="text-text-sub ml-1">
                      (~{formatCurrency(estimatedTaskValue)})
                    </span>
                  )}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
