'use client';

import * as React from 'react';
import { CheckCircle, Clock, Shield } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { InlineUserSelect } from '@/components/ui/user-select';
import { useAuth } from '@/lib/hooks/use-auth';
import { useUpdateTask, Task } from '@/lib/hooks/use-tasks';
import { showToast } from '@/lib/hooks/use-toast';
import { formatRelativeTime } from '@/lib/utils/time';

interface ReviewSectionProps {
  task: Task;
}

export function ReviewSection({ task }: ReviewSectionProps) {
  const { user, isPmOrAdmin } = useAuth();
  const updateTask = useUpdateTask();

  // Only show to task creator or PM/Admin
  const canViewReviewSection = user && (
    task.created_by_id === user.id || isPmOrAdmin
  );

  if (!canViewReviewSection) {
    return null;
  }

  // Can approve: reviewer, task creator, or PM/Admin
  const canApprove = user && (
    task.reviewer_id === user.id ||
    task.created_by_id === user.id ||
    isPmOrAdmin
  );

  const handleNeedsReviewChange = (checked: boolean) => {
    updateTask.mutate(
      { id: task.id, data: { needs_review: checked } },
      {
        onSuccess: () => {
          showToast.success(checked ? 'Review enabled' : 'Review disabled');
        },
        onError: (error) => {
          showToast.apiError(error, 'Failed to update review setting');
        },
      }
    );
  };

  const handleReviewerChange = (reviewerId: string | null) => {
    updateTask.mutate(
      { id: task.id, data: { reviewer_id: reviewerId } },
      {
        onSuccess: () => {
          showToast.success('Reviewer updated');
        },
        onError: (error) => {
          showToast.apiError(error, 'Failed to update reviewer');
        },
      }
    );
  };

  const handleApprovalChange = (approved: boolean) => {
    updateTask.mutate(
      { id: task.id, data: { approved } },
      {
        onSuccess: () => {
          showToast.success(approved ? 'Task approved' : 'Approval removed');
        },
        onError: (error) => {
          showToast.apiError(error, 'Failed to update approval');
        },
      }
    );
  };

  // Determine review status
  const isPendingReview = task.status === 'done' && task.needs_review && !task.approved;
  const isApproved = task.approved;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-text-sub" />
            <CardTitle className="text-sm">Review</CardTitle>
          </div>
          {isPendingReview && (
            <Badge variant="warning">Pending Review</Badge>
          )}
          {isApproved && (
            <Badge variant="success">Approved</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Needs Review Toggle */}
        <div className="flex items-center justify-between">
          <label htmlFor="needs-review" className="text-sm text-text-main">
            Requires Review
          </label>
          <Switch
            id="needs-review"
            checked={task.needs_review}
            onCheckedChange={handleNeedsReviewChange}
            disabled={updateTask.isPending}
          />
        </div>

        {task.needs_review && (
          <>
            {/* Reviewer Selection */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-text-main">Reviewer</span>
              <InlineUserSelect
                value={task.reviewer_id}
                onChange={handleReviewerChange}
                displayValue={task.reviewer?.name}
                placeholder="Select reviewer"
              />
            </div>

            {/* Approval Status */}
            {task.status === 'done' && (
              <div className="pt-2 border-t border-border">
                {isApproved ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm text-success">
                      <CheckCircle className="h-4 w-4" />
                      <span>
                        Approved by {task.approved_by?.name || 'Unknown'}
                      </span>
                    </div>
                    {task.approved_at && (
                      <div className="text-xs text-text-sub">
                        {formatRelativeTime(task.approved_at)}
                      </div>
                    )}
                    {canApprove && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleApprovalChange(false)}
                        disabled={updateTask.isPending}
                        className="mt-2"
                      >
                        Remove Approval
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm text-warning">
                      <Clock className="h-4 w-4" />
                      <span>Awaiting approval</span>
                    </div>
                    {canApprove && (
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => handleApprovalChange(true)}
                        disabled={updateTask.isPending}
                        className="mt-2"
                      >
                        <CheckCircle className="h-4 w-4 mr-1" />
                        Approve Task
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
