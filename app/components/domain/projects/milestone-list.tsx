'use client';

import * as React from 'react';
import { format } from 'date-fns';
import { Plus, Pencil, Trash2, Check, Circle, Flag, Calendar, DollarSign, Receipt } from 'lucide-react';
import {
  useMilestones,
  useDeleteMilestone,
  useToggleMilestoneComplete,
  useTriggerMilestone,
  useInvoiceMilestone,
  Milestone,
  BillingStatus,
} from '@/lib/hooks/use-milestones';
import { useAuth } from '@/lib/hooks/use-auth';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalBody,
} from '@/components/ui/modal';
import { MilestoneForm, Phase } from './milestone-form';

interface MilestoneListProps {
  projectId: string;
  phases?: Phase[];
}

/**
 * Format a number as currency (USD)
 */
function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}

/**
 * Get badge variant and label for billing status
 */
function getBillingStatusDisplay(status: BillingStatus): { variant: 'default' | 'warning' | 'success'; label: string } {
  switch (status) {
    case 'pending':
      return { variant: 'default', label: 'Pending' };
    case 'triggered':
      return { variant: 'warning', label: 'Ready to Bill' };
    case 'invoiced':
      return { variant: 'success', label: 'Invoiced' };
    default:
      return { variant: 'default', label: status };
  }
}

export function MilestoneList({ projectId, phases = [] }: MilestoneListProps) {
  const [isCreateModalOpen, setIsCreateModalOpen] = React.useState(false);
  const [editingMilestone, setEditingMilestone] = React.useState<Milestone | null>(null);

  const { isPmOrAdmin } = useAuth();
  const { data, isLoading } = useMilestones(projectId);
  const deleteMilestone = useDeleteMilestone(projectId);
  const toggleComplete = useToggleMilestoneComplete(projectId);
  const triggerMilestone = useTriggerMilestone(projectId);
  const invoiceMilestone = useInvoiceMilestone(projectId);

  const milestones = data?.milestones || [];

  // Separate milestones into upcoming and completed
  const upcomingMilestones = milestones.filter((m) => !m.completed_at);
  const completedMilestones = milestones.filter((m) => m.completed_at);

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete milestone "${name}"? This action cannot be undone.`)) return;
    await deleteMilestone.mutateAsync(id);
  };

  const handleToggleComplete = async (milestone: Milestone) => {
    await toggleComplete.mutateAsync({
      id: milestone.id,
      completed: !milestone.completed_at,
    });
  };

  const handleTriggerBilling = async (milestone: Milestone) => {
    if (!confirm(`Mark milestone "${milestone.name}" as ready to bill for ${formatCurrency(milestone.billing_amount!)}?`)) return;
    await triggerMilestone.mutateAsync(milestone.id);
  };

  const handleMarkInvoiced = async (milestone: Milestone) => {
    if (!confirm(`Mark milestone "${milestone.name}" as invoiced?`)) return;
    await invoiceMilestone.mutateAsync(milestone.id);
  };

  const handleCreateSuccess = () => {
    setIsCreateModalOpen(false);
  };

  const handleEditSuccess = () => {
    setEditingMilestone(null);
  };

  const formatTargetDate = (dateString: string | null) => {
    if (!dateString) return null;
    return format(new Date(dateString), 'MMM d, yyyy');
  };

  const renderMilestoneItem = (milestone: Milestone) => {
    const isCompleted = !!milestone.completed_at;
    const formattedDate = formatTargetDate(milestone.target_date);
    const isPastDue =
      milestone.target_date && !isCompleted && new Date(milestone.target_date) < new Date();
    const hasBilling = milestone.billing_amount !== null && milestone.billing_amount > 0;
    const billingStatusDisplay = hasBilling ? getBillingStatusDisplay(milestone.billing_status) : null;

    return (
      <div
        key={milestone.id}
        className="group flex items-start gap-3 p-3 rounded-lg border border-border bg-surface hover:bg-surface-2 transition-colors"
      >
        {/* Completion toggle */}
        <button
          onClick={() => handleToggleComplete(milestone)}
          disabled={toggleComplete.isPending}
          className={`mt-0.5 flex-shrink-0 p-0.5 rounded-full transition-colors ${
            isCompleted
              ? 'text-green-600 hover:text-green-700'
              : 'text-text-sub hover:text-primary'
          }`}
          title={isCompleted ? 'Mark as incomplete' : 'Mark as complete'}
        >
          {isCompleted ? (
            <Check className="h-5 w-5" />
          ) : (
            <Circle className="h-5 w-5" />
          )}
        </button>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`font-medium ${
                isCompleted ? 'text-text-sub line-through' : 'text-text-main'
              }`}
            >
              {milestone.name}
            </span>
            {isCompleted && (
              <Badge variant="success" size="sm">
                Completed
              </Badge>
            )}
            {isPastDue && (
              <Badge variant="error" size="sm">
                Past Due
              </Badge>
            )}
          </div>

          {/* Target date */}
          {formattedDate && (
            <div className="flex items-center gap-1 mt-1 text-sm text-text-sub">
              <Calendar className="h-3.5 w-3.5" />
              <span>{formattedDate}</span>
            </div>
          )}

          {/* Notes */}
          {milestone.notes && (
            <p className="mt-1 text-sm text-text-sub line-clamp-2">
              {milestone.notes}
            </p>
          )}

          {/* Billing information */}
          {hasBilling && (
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1 text-sm font-medium text-text-main">
                <DollarSign className="h-3.5 w-3.5" />
                <span>{formatCurrency(milestone.billing_amount!)}</span>
              </div>
              {billingStatusDisplay && (
                <Badge variant={billingStatusDisplay.variant} size="sm">
                  {billingStatusDisplay.label}
                </Badge>
              )}
            </div>
          )}

          {/* Billing actions - PM/Admin only */}
          {hasBilling && isPmOrAdmin && (
            <div className="mt-2 flex items-center gap-2">
              {milestone.billing_status === 'pending' && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => handleTriggerBilling(milestone)}
                  disabled={triggerMilestone.isPending}
                >
                  <Receipt className="h-3.5 w-3.5" />
                  Trigger Billing
                </Button>
              )}
              {milestone.billing_status === 'triggered' && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => handleMarkInvoiced(milestone)}
                  disabled={invoiceMilestone.isPending}
                >
                  <Check className="h-3.5 w-3.5" />
                  Mark Invoiced
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => setEditingMilestone(milestone)}
            className="p-1.5 text-text-sub hover:text-primary rounded-md hover:bg-surface-alt"
            title="Edit milestone"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            onClick={() => handleDelete(milestone.id, milestone.name)}
            disabled={deleteMilestone.isPending}
            className="p-1.5 text-text-sub hover:text-red-500 rounded-md hover:bg-surface-alt"
            title="Delete milestone"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Flag className="h-5 w-5" />
            Milestones
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex justify-center py-8">
            <Spinner size="md" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Flag className="h-5 w-5" />
            Milestones
            {milestones.length > 0 && (
              <Badge variant="default" size="sm">
                {milestones.length}
              </Badge>
            )}
          </CardTitle>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setIsCreateModalOpen(true)}
          >
            <Plus className="h-4 w-4" />
            Add Milestone
          </Button>
        </CardHeader>
        <CardContent>
          {milestones.length === 0 ? (
            <EmptyState
              icon={<Flag className="h-12 w-12" />}
              title="No milestones yet"
              description="Add milestones to track key deliverables."
              action={
                <Button
                  size="sm"
                  onClick={() => setIsCreateModalOpen(true)}
                >
                  <Plus className="h-4 w-4" />
                  Add Milestone
                </Button>
              }
            />
          ) : (
            <div className="space-y-6">
              {/* Upcoming Milestones */}
              {upcomingMilestones.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-text-sub uppercase tracking-wide">
                    Upcoming ({upcomingMilestones.length})
                  </h4>
                  <div className="space-y-2">
                    {upcomingMilestones.map(renderMilestoneItem)}
                  </div>
                </div>
              )}

              {/* Completed Milestones */}
              {completedMilestones.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-text-sub uppercase tracking-wide">
                    Completed ({completedMilestones.length})
                  </h4>
                  <div className="space-y-2">
                    {completedMilestones.map(renderMilestoneItem)}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Milestone Modal */}
      <Modal open={isCreateModalOpen} onOpenChange={setIsCreateModalOpen}>
        <ModalContent size="md">
          <ModalHeader>
            <ModalTitle>Add Milestone</ModalTitle>
          </ModalHeader>
          <ModalBody>
            <MilestoneForm
              projectId={projectId}
              phases={phases}
              onSuccess={handleCreateSuccess}
              onCancel={() => setIsCreateModalOpen(false)}
            />
          </ModalBody>
        </ModalContent>
      </Modal>

      {/* Edit Milestone Modal */}
      <Modal
        open={!!editingMilestone}
        onOpenChange={(open) => !open && setEditingMilestone(null)}
      >
        <ModalContent size="md">
          <ModalHeader>
            <ModalTitle>Edit Milestone</ModalTitle>
          </ModalHeader>
          <ModalBody>
            {editingMilestone && (
              <MilestoneForm
                projectId={projectId}
                milestone={editingMilestone}
                phases={phases}
                onSuccess={handleEditSuccess}
                onCancel={() => setEditingMilestone(null)}
              />
            )}
          </ModalBody>
        </ModalContent>
      </Modal>
    </>
  );
}
