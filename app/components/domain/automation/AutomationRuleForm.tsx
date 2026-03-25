'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Combobox } from '@/components/ui/combobox';
import {
  useCreateAutomationRule,
  useUpdateAutomationRule,
} from '@/lib/hooks/use-automation-rules';
import { useUsers } from '@/lib/hooks/use-users';
import type { SalesAutomationRuleWithRelations, AccordStatus } from '@/types/entities';

const ACCORD_STATUSES: AccordStatus[] = [
  'lead',
  'meeting',
  'proposal',
  'contract',
  'signed',
  'active',
  'lost',
];

const automationRuleSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  trigger_type: z.enum(['status_change', 'time_based']),
  trigger_status: z.enum(['lead', 'meeting', 'proposal', 'contract', 'signed', 'active', 'lost']),
  trigger_from_status: z
    .enum(['lead', 'meeting', 'proposal', 'contract', 'signed', 'active', 'lost'])
    .optional()
    .nullable(),
  time_threshold_hours: z.coerce.number().optional().nullable(),
  assignee_rule: z.enum(['accord_owner', 'meeting_attendees', 'specific_user']),
  assignee_user_id: z.string().optional().nullable(),
  task_title: z.string().min(1, 'Task title is required'),
  task_description: z.string().optional(),
  task_priority: z.coerce.number().min(1).max(5).optional(),
  task_due_offset_hours: z.coerce.number().optional().nullable(),
  is_active: z.boolean().optional(),
});

type AutomationRuleFormData = z.infer<typeof automationRuleSchema>;

interface AutomationRuleFormProps {
  existing?: SalesAutomationRuleWithRelations;
  onClose: () => void;
}

export function AutomationRuleForm({ existing, onClose }: AutomationRuleFormProps) {
  const createRule = useCreateAutomationRule();
  const updateRule = useUpdateAutomationRule();
  const { data: usersData } = useUsers();
  const isEdit = !!existing;

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<AutomationRuleFormData>({
    resolver: zodResolver(automationRuleSchema) as any,
    defaultValues: {
      name: existing?.name || '',
      trigger_type: existing?.trigger_type || 'status_change',
      trigger_status: existing?.trigger_status || 'meeting',
      trigger_from_status: existing?.trigger_from_status || null,
      time_threshold_hours: existing?.time_threshold_hours || null,
      assignee_rule: existing?.assignee_rule || 'accord_owner',
      assignee_user_id: existing?.assignee_user_id || null,
      task_title: existing?.task_template?.title || '',
      task_description: existing?.task_template?.description || '',
      task_priority: existing?.task_template?.priority || 3,
      task_due_offset_hours: existing?.task_template?.due_offset_hours || null,
      is_active: existing?.is_active ?? true,
    },
  });

  const triggerType = watch('trigger_type');
  const assigneeRule = watch('assignee_rule');
  const assigneeUserId = watch('assignee_user_id');

  const userOptions = React.useMemo(() => {
    if (!usersData?.users) return [];
    return usersData.users
      .filter((u) => u.is_active)
      .map((u) => ({ value: u.id, label: u.name, description: u.email }));
  }, [usersData]);

  const onSubmit = async (data: AutomationRuleFormData) => {
    const payload = {
      name: data.name,
      trigger_type: data.trigger_type,
      trigger_status: data.trigger_status,
      trigger_from_status:
        data.trigger_type === 'status_change' ? data.trigger_from_status || undefined : undefined,
      time_threshold_hours:
        data.trigger_type === 'time_based' ? data.time_threshold_hours || undefined : undefined,
      assignee_rule: data.assignee_rule,
      assignee_user_id:
        data.assignee_rule === 'specific_user' ? data.assignee_user_id || undefined : undefined,
      task_template: {
        title: data.task_title,
        description: data.task_description || undefined,
        priority: data.task_priority || undefined,
        due_offset_hours: data.task_due_offset_hours || undefined,
      },
      is_active: data.is_active,
    };

    if (isEdit && existing) {
      await updateRule.mutateAsync({ id: existing.id, data: payload });
    } else {
      await createRule.mutateAsync(payload);
    }
    onClose();
  };

  const isPending = createRule.isPending || updateRule.isPending;

  return (
    <form onSubmit={handleSubmit(onSubmit as any)} className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-text-main">
          {isEdit ? 'Edit' : 'New'} Automation Rule
        </h3>
      </div>

      <Input
        label="Rule Name"
        {...register('name')}
        error={errors.name?.message}
        placeholder="e.g. Create follow-up task on meeting"
      />

      {/* Trigger Type */}
      <div>
        <label className="block text-sm font-medium text-text-main mb-1">Trigger Type</label>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              value="status_change"
              {...register('trigger_type')}
              className="rounded"
            />
            <span className="text-sm text-text-main">Status Change</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              value="time_based"
              {...register('trigger_type')}
              className="rounded"
            />
            <span className="text-sm text-text-main">Time-Based</span>
          </label>
        </div>
      </div>

      {/* Trigger Status */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-text-main mb-1">Trigger Status</label>
          <select
            {...register('trigger_status')}
            className="w-full rounded-md border border-border-warm bg-surface px-3 py-2 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary"
          >
            {ACCORD_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status.charAt(0).toUpperCase() + status.slice(1)}
              </option>
            ))}
          </select>
          {errors.trigger_status && (
            <p className="text-xs text-status-error mt-1">{errors.trigger_status.message}</p>
          )}
        </div>

        {triggerType === 'status_change' && (
          <div>
            <label className="block text-sm font-medium text-text-main mb-1">
              From Status <span className="text-text-sub">(optional)</span>
            </label>
            <select
              {...register('trigger_from_status')}
              className="w-full rounded-md border border-border-warm bg-surface px-3 py-2 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">Any status</option>
              {ACCORD_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status.charAt(0).toUpperCase() + status.slice(1)}
                </option>
              ))}
            </select>
          </div>
        )}

        {triggerType === 'time_based' && (
          <Input
            label="Time Threshold (hours)"
            type="number"
            {...register('time_threshold_hours')}
            error={errors.time_threshold_hours?.message}
            placeholder="e.g. 48"
          />
        )}
      </div>

      {/* Assignee Rule */}
      <div>
        <label className="block text-sm font-medium text-text-main mb-1">Assignee Rule</label>
        <select
          {...register('assignee_rule')}
          className="w-full rounded-md border border-border-warm bg-surface px-3 py-2 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="accord_owner">Accord Owner</option>
          <option value="meeting_attendees">Meeting Attendees</option>
          <option value="specific_user">Specific User</option>
        </select>
      </div>

      {assigneeRule === 'specific_user' && (
        <Combobox
          label="Assigned User"
          options={userOptions}
          value={assigneeUserId || null}
          onChange={(val) => setValue('assignee_user_id', val)}
          placeholder="Select a user..."
        />
      )}

      {/* Task Template */}
      <div className="border-t border-border-warm pt-4">
        <h4 className="text-sm font-semibold text-text-main mb-3">Task Template</h4>

        <div className="space-y-3">
          <Input
            label="Task Title"
            {...register('task_title')}
            error={errors.task_title?.message}
            placeholder="e.g. Follow up after meeting"
          />

          <Textarea
            label="Task Description"
            {...register('task_description')}
            placeholder="Optional description for the generated task..."
            rows={2}
          />

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text-main mb-1">Priority</label>
              <select
                {...register('task_priority')}
                className="w-full rounded-md border border-border-warm bg-surface px-3 py-2 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value={1}>1 - Lowest</option>
                <option value={2}>2 - Low</option>
                <option value={3}>3 - Medium</option>
                <option value={4}>4 - High</option>
                <option value={5}>5 - Highest</option>
              </select>
            </div>
            <Input
              label="Due Offset (hours)"
              type="number"
              {...register('task_due_offset_hours')}
              placeholder="e.g. 24"
            />
          </div>
        </div>
      </div>

      {/* Active Toggle */}
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" {...register('is_active')} className="rounded" />
        <span className="text-sm text-text-main">Rule is active</span>
      </label>

      <div className="flex justify-end gap-2 pt-2 border-t border-border-warm">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Saving...' : isEdit ? 'Update' : 'Create'}
        </Button>
      </div>
    </form>
  );
}
