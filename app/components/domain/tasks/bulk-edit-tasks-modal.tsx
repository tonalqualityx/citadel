'use client';

import * as React from 'react';
import { useBulkUpdateTasks, type BulkUpdateTasksInput } from '@/lib/hooks/use-tasks';
import { useUsers } from '@/lib/hooks/use-users';
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalBody } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { showToast } from '@/lib/hooks/use-toast';
import { useTerminology } from '@/lib/hooks/use-terminology';

interface BulkEditTasksModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedIds: string[];
  onSuccess?: () => void;
}

// Three-state pattern:
// undefined = don't change
// 'clear' = clear the value (will be converted to null)
// value = set to this value

export function BulkEditTasksModal({
  open,
  onOpenChange,
  selectedIds,
  onSuccess,
}: BulkEditTasksModalProps) {
  const { t } = useTerminology();
  const bulkUpdate = useBulkUpdateTasks();

  // Form state
  const [dueDateAction, setDueDateAction] = React.useState<'no_change' | 'set' | 'clear'>('no_change');
  const [dueDateValue, setDueDateValue] = React.useState<string>('');
  const [assigneeId, setAssigneeId] = React.useState<string | undefined>(undefined);

  // Fetch users for assignee select
  const { data: usersData } = useUsers();

  // Build assignee options
  const assigneeOptions = React.useMemo(() => {
    const opts = (usersData?.users || []).map((u) => ({ value: u.id, label: u.name }));
    return [
      { value: '', label: '-- No change --' },
      { value: 'clear', label: '-- Unassign --' },
      ...opts,
    ];
  }, [usersData?.users]);

  // Reset form when modal opens
  React.useEffect(() => {
    if (open) {
      setDueDateAction('no_change');
      setDueDateValue('');
      setAssigneeId(undefined);
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Build update data - only include fields that have been changed
    const data: BulkUpdateTasksInput = {};

    // Handle due date
    if (dueDateAction === 'clear') {
      data.due_date = null;
    } else if (dueDateAction === 'set' && dueDateValue) {
      // Convert local date string to ISO datetime
      data.due_date = new Date(dueDateValue).toISOString();
    }

    // Handle assignee
    if (assigneeId === 'clear') {
      data.assignee_id = null;
    } else if (assigneeId) {
      data.assignee_id = assigneeId;
    }

    // Check if any changes were made
    if (Object.keys(data).length === 0) {
      showToast.error('No changes selected');
      return;
    }

    try {
      const result = await bulkUpdate.mutateAsync({
        task_ids: selectedIds,
        data,
      });
      showToast.success(`Updated ${result.updated} ${t('tasks').toLowerCase()}`);
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      showToast.apiError(error, 'Failed to update tasks');
    }
  };

  const hasChanges = dueDateAction !== 'no_change' || assigneeId;

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent size="md">
        <ModalHeader>
          <ModalTitle>
            Bulk Edit {selectedIds.length} {t('tasks')}
          </ModalTitle>
        </ModalHeader>
        <ModalBody>
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-sm text-text-sub mb-4">
              Only fields you change will be updated. Leave a field as &quot;No change&quot; to keep existing values.
            </p>

            <div>
              <label className="block text-sm font-medium text-text-main mb-1.5">
                Due Date
              </label>
              <div className="space-y-2">
                <Select
                  options={[
                    { value: 'no_change', label: '-- No change --' },
                    { value: 'set', label: 'Set due date' },
                    { value: 'clear', label: 'Clear due date' },
                  ]}
                  value={dueDateAction}
                  onChange={(value) => {
                    setDueDateAction(value as 'no_change' | 'set' | 'clear');
                    if (value !== 'set') {
                      setDueDateValue('');
                    }
                  }}
                />
                {dueDateAction === 'set' && (
                  <Input
                    type="date"
                    value={dueDateValue}
                    onChange={(e) => setDueDateValue(e.target.value)}
                    placeholder="Select date..."
                  />
                )}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-main mb-1.5">
                Assignee
              </label>
              <Select
                options={assigneeOptions}
                value={assigneeId === 'clear' ? 'clear' : assigneeId || ''}
                onChange={(value) => {
                  if (value === 'clear') {
                    setAssigneeId('clear');
                  } else if (value === '') {
                    setAssigneeId(undefined);
                  } else {
                    setAssigneeId(value);
                  }
                }}
                placeholder="-- No change --"
              />
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-border-warm">
              <Button
                type="button"
                variant="secondary"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={bulkUpdate.isPending || !hasChanges}>
                {bulkUpdate.isPending && <Spinner size="sm" className="mr-2" />}
                Update {selectedIds.length} {t('tasks')}
              </Button>
            </div>
          </form>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}
