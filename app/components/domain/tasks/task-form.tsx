'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useCreateTask, useUpdateTask, Task } from '@/lib/hooks/use-tasks';
import { useProjects } from '@/lib/hooks/use-projects';
import { useClients } from '@/lib/hooks/use-clients';
import { useFunctions } from '@/lib/hooks/use-reference-data';
import { useSops } from '@/lib/hooks/use-sops';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Checkbox } from '@/components/ui/checkbox';
import {
  PriorityFormSelect,
  EnergyFormSelect,
  MysteryFormSelect,
  BatteryFormSelect,
} from '@/components/ui/field-selects';

const taskSchema = z.object({
  title: z.string().min(1, 'Title is required').max(500),
  description: z.string().optional(),
  status: z.enum(['not_started', 'in_progress', 'review', 'done', 'blocked', 'abandoned']),
  priority: z.string(),
  project_id: z.string().optional(),
  client_id: z.string().optional(), // For ad-hoc tasks without a project
  phase: z.string().optional(),
  assignee_id: z.string().optional(),
  function_id: z.string().optional(),
  sop_id: z.string().optional(),
  energy_estimate: z.string().optional(),
  mystery_factor: z.enum(['none', 'average', 'significant', 'no_idea']),
  battery_impact: z.enum(['average_drain', 'high_drain', 'energizing']),
  due_date: z.string().optional(),
  notes: z.string().optional(),
  // Billing fields (PM/Admin only - API enforces role restriction)
  is_billable: z.boolean(),
  billing_target: z.string().optional(), // String for input, convert to number
  is_retainer_work: z.boolean(),
});

type TaskFormData = z.infer<typeof taskSchema>;

interface TaskFormProps {
  task?: Task;
  defaultProjectId?: string;
  onSuccess?: () => void;
  onCancel?: () => void;
}

const statusOptions = [
  { value: 'not_started', label: 'Not Started' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'review', label: 'Review' },
  { value: 'done', label: 'Done' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'abandoned', label: 'Abandoned' },
];

export function TaskForm({ task, defaultProjectId, onSuccess, onCancel }: TaskFormProps) {
  const isEdit = !!task;
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const { data: projectsData, isLoading: projectsLoading } = useProjects({ limit: 100 });
  const { data: clientsData, isLoading: clientsLoading } = useClients({ limit: 100, status: 'active' });
  const { data: functionsData, isLoading: functionsLoading } = useFunctions();
  const { data: sopsData, isLoading: sopsLoading } = useSops();

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<TaskFormData>({
    resolver: zodResolver(taskSchema),
    defaultValues: {
      title: task?.title || '',
      description: task?.description || '',
      status: (task?.status as any) || 'not_started',
      priority: task?.priority?.toString() || '3',
      project_id: task?.project_id || defaultProjectId || '',
      client_id: task?.client_id || '',
      phase: task?.phase || '',
      assignee_id: task?.assignee_id || '',
      function_id: task?.function_id || '',
      sop_id: task?.sop_id || '',
      energy_estimate: task?.energy_estimate?.toString() || '',
      mystery_factor: (task?.mystery_factor as any) || 'none',
      battery_impact: (task?.battery_impact as any) || 'average_drain',
      due_date: task?.due_date?.split('T')[0] || '',
      notes: task?.notes || '',
      // Billing fields
      is_billable: task?.is_billable ?? true,
      billing_target: task?.billing_target?.toString() || '',
      is_retainer_work: task?.is_retainer_work ?? false,
    },
  });

  const projectOptions = React.useMemo(() => {
    return [
      { value: '', label: 'No project (ad-hoc)' },
      ...(projectsData?.projects.map((p) => ({
        value: p.id,
        label: `${p.name} (${p.client?.name || 'No client'})`,
      })) || []),
    ];
  }, [projectsData]);

  const clientOptions = React.useMemo(() => {
    return [
      { value: '', label: 'No client (internal)' },
      ...(clientsData?.clients.map((c) => ({
        value: c.id,
        label: c.name,
      })) || []),
    ];
  }, [clientsData]);

  const functionOptions = React.useMemo(() => {
    return [
      { value: '', label: 'No function' },
      ...(functionsData?.functions?.map((f) => ({
        value: f.id,
        label: f.name,
      })) || []),
    ];
  }, [functionsData]);

  const sopOptions = React.useMemo(() => {
    return [
      { value: '', label: 'No Rune' },
      ...(sopsData?.sops?.map((s) => ({
        value: s.id,
        label: s.title,
      })) || []),
    ];
  }, [sopsData]);

  const onSubmit = async (data: TaskFormData) => {
    try {
      const payload = {
        title: data.title,
        description: data.description || null,
        status: data.status,
        priority: parseInt(data.priority),
        project_id: data.project_id || null,
        // Only include client_id if no project is selected (ad-hoc task)
        client_id: !data.project_id && data.client_id ? data.client_id : null,
        phase: data.phase || null,
        assignee_id: data.assignee_id || null,
        function_id: data.function_id || null,
        sop_id: data.sop_id || null,
        energy_estimate: data.energy_estimate ? parseInt(data.energy_estimate) : null,
        mystery_factor: data.mystery_factor,
        battery_impact: data.battery_impact,
        due_date: data.due_date ? new Date(data.due_date).toISOString() : null,
        notes: data.notes || null,
        // Billing fields (API enforces PM/Admin-only restriction)
        is_billable: data.is_billable,
        billing_target: data.billing_target ? parseInt(data.billing_target) : null,
        is_retainer_work: data.is_retainer_work,
      };

      if (isEdit) {
        await updateTask.mutateAsync({ id: task.id, data: payload });
      } else {
        await createTask.mutateAsync(payload);
      }
      onSuccess?.();
    } catch (error) {
      console.error('Failed to save task:', error);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="md:col-span-2">
          <Input
            label="Title"
            {...register('title')}
            error={errors.title?.message}
            placeholder="Quest title"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-text-main mb-1">
            Pact
          </label>
          {projectsLoading ? (
            <div className="h-10 flex items-center">
              <Spinner size="sm" />
            </div>
          ) : (
            <Select
              options={projectOptions}
              value={watch('project_id') || ''}
              onChange={(value) => {
                const event = { target: { value, name: 'project_id' } };
                register('project_id').onChange(event as any);
              }}
              placeholder="Select pact..."
            />
          )}
        </div>

        {/* Client selector - only shown for ad-hoc tasks (no project selected) */}
        {!watch('project_id') && (
          <div>
            <label className="block text-sm font-medium text-text-main mb-1">
              Client
            </label>
            {clientsLoading ? (
              <div className="h-10 flex items-center">
                <Spinner size="sm" />
              </div>
            ) : (
              <Select
                options={clientOptions}
                value={watch('client_id') || ''}
                onChange={(value) => {
                  const event = { target: { value, name: 'client_id' } };
                  register('client_id').onChange(event as any);
                }}
                placeholder="Select client..."
              />
            )}
          </div>
        )}

        <div>
          <Input
            label="Phase"
            {...register('phase')}
            placeholder="e.g., Design, Development"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-text-main mb-1">
            Status
          </label>
          <Select
            options={statusOptions}
            value={watch('status')}
            onChange={(value) => {
              const event = { target: { value, name: 'status' } };
              register('status').onChange(event as any);
            }}
          />
        </div>

        <div>
          <PriorityFormSelect
            label="Priority"
            value={watch('priority')}
            onChange={(value) => {
              const event = { target: { value, name: 'priority' } };
              register('priority').onChange(event as any);
            }}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-text-main mb-1">
            Function
          </label>
          {functionsLoading ? (
            <div className="h-10 flex items-center">
              <Spinner size="sm" />
            </div>
          ) : (
            <Select
              options={functionOptions}
              value={watch('function_id') || ''}
              onChange={(value) => {
                const event = { target: { value, name: 'function_id' } };
                register('function_id').onChange(event as any);
              }}
              placeholder="Select function..."
            />
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-text-main mb-1">
            Rune
          </label>
          {sopsLoading ? (
            <div className="h-10 flex items-center">
              <Spinner size="sm" />
            </div>
          ) : (
            <Select
              options={sopOptions}
              value={watch('sop_id') || ''}
              onChange={(value) => {
                const event = { target: { value, name: 'sop_id' } };
                register('sop_id').onChange(event as any);
              }}
              placeholder="Select rune..."
            />
          )}
        </div>

        <div>
          <Input
            label="Due Date"
            type="date"
            {...register('due_date')}
          />
        </div>

        <div>
          <EnergyFormSelect
            label="Energy Estimate"
            value={watch('energy_estimate') || ''}
            onChange={(value) => {
              const event = { target: { value, name: 'energy_estimate' } };
              register('energy_estimate').onChange(event as any);
            }}
          />
        </div>

        <div>
          <MysteryFormSelect
            label="Mystery Factor"
            value={watch('mystery_factor')}
            onChange={(value) => {
              const event = { target: { value, name: 'mystery_factor' } };
              register('mystery_factor').onChange(event as any);
            }}
          />
        </div>

        <div>
          <BatteryFormSelect
            label="Battery Impact"
            value={watch('battery_impact')}
            onChange={(value) => {
              const event = { target: { value, name: 'battery_impact' } };
              register('battery_impact').onChange(event as any);
            }}
          />
        </div>

        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-text-main mb-1">
            Description
          </label>
          <textarea
            {...register('description')}
            className="w-full rounded-md border border-border bg-surface-1 px-3 py-2 text-sm text-text-main placeholder:text-text-sub focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            rows={3}
            placeholder="Quest description..."
          />
        </div>

        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-text-main mb-1">
            Notes
          </label>
          <textarea
            {...register('notes')}
            className="w-full rounded-md border border-border bg-surface-1 px-3 py-2 text-sm text-text-main placeholder:text-text-sub focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            rows={2}
            placeholder="Internal notes..."
          />
        </div>

        {/* Billing Section */}
        <div className="md:col-span-2 pt-4 border-t border-border">
          <h3 className="text-sm font-medium text-text-main mb-3">Billing</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="flex items-center gap-2">
              <Checkbox
                id="is_billable"
                checked={watch('is_billable')}
                onCheckedChange={(checked) => setValue('is_billable', !!checked)}
              />
              <label htmlFor="is_billable" className="text-sm text-text-main cursor-pointer">
                Billable
              </label>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="is_retainer_work"
                checked={watch('is_retainer_work')}
                onCheckedChange={(checked) => setValue('is_retainer_work', !!checked)}
              />
              <label htmlFor="is_retainer_work" className="text-sm text-text-main cursor-pointer">
                Retainer Work
              </label>
            </div>

            <div>
              <Input
                label="Billing Cap (minutes)"
                type="number"
                min={1}
                {...register('billing_target')}
                placeholder="No cap"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t border-border">
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? (
            <>
              <Spinner size="sm" className="mr-2" />
              {isEdit ? 'Saving...' : 'Creating...'}
            </>
          ) : isEdit ? (
            'Save Changes'
          ) : (
            'Create Quest'
          )}
        </Button>
      </div>
    </form>
  );
}
