'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useCreateProject, useUpdateProject, Project } from '@/lib/hooks/use-projects';
import { useClients } from '@/lib/hooks/use-clients';
import { useSites } from '@/lib/hooks/use-sites';
import { useTerminology } from '@/lib/hooks/use-terminology';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';

const projectSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  description: z.string().optional(),
  status: z.enum(['quote', 'queue', 'ready', 'in_progress', 'review', 'done', 'suspended', 'cancelled']),
  type: z.enum(['project', 'retainer', 'internal']),
  billing_type: z.enum(['fixed', 'hourly', 'retainer', 'none']).optional(),
  client_id: z.string().min(1, 'Client is required'),
  site_id: z.string().optional(),
  start_date: z.string().optional(),
  target_date: z.string().optional(),
  budget_amount: z.string().optional(),
  is_retainer: z.boolean().optional(),
  notes: z.string().optional(),
});

type ProjectFormData = z.infer<typeof projectSchema>;

interface ProjectFormProps {
  project?: Project;
  onSuccess?: () => void;
  onCancel?: () => void;
}

const statusOptions = [
  { value: 'quote', label: 'Quote' },
  { value: 'queue', label: 'Queue' },
  { value: 'ready', label: 'Ready' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'review', label: 'Review' },
  { value: 'done', label: 'Done' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'cancelled', label: 'Cancelled' },
];

const typeOptions = [
  { value: 'project', label: 'Project' },
  { value: 'retainer', label: 'Retainer' },
  { value: 'internal', label: 'Internal' },
];

const billingTypeOptions = [
  { value: 'fixed', label: 'Fixed Price' },
  { value: 'hourly', label: 'Hourly' },
  { value: 'retainer', label: 'Retainer Hours' },
  { value: 'none', label: 'Non-billable' },
];

export function ProjectForm({ project, onSuccess, onCancel }: ProjectFormProps) {
  const isEdit = !!project;
  const { t } = useTerminology();
  const createProject = useCreateProject();
  const updateProject = useUpdateProject();
  const { data: clientsData, isLoading: clientsLoading } = useClients({ limit: 100 });

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ProjectFormData>({
    resolver: zodResolver(projectSchema),
    defaultValues: {
      name: project?.name || '',
      description: project?.description || '',
      status: (project?.status as any) || 'quote',
      type: (project?.type as any) || 'project',
      billing_type: (project?.billing_type as any) || 'fixed',
      client_id: project?.client_id || '',
      site_id: project?.site_id || '',
      start_date: project?.start_date?.split('T')[0] || '',
      target_date: project?.target_date?.split('T')[0] || '',
      budget_amount: project?.budget_amount?.toString() || '',
      is_retainer: project?.is_retainer || false,
      notes: project?.notes || '',
    },
  });

  const selectedClientId = watch('client_id');
  const { data: sitesData, isLoading: sitesLoading } = useSites({
    client_id: selectedClientId || undefined,
    limit: 100,
  });

  const clientOptions = React.useMemo(() => {
    return (
      clientsData?.clients.map((c) => ({
        value: c.id,
        label: c.name,
      })) || []
    );
  }, [clientsData]);

  const siteOptions = React.useMemo(() => {
    return (
      sitesData?.sites.map((s) => ({
        value: s.id,
        label: s.name,
      })) || []
    );
  }, [sitesData]);

  const onSubmit = async (data: ProjectFormData) => {
    try {
      const payload = {
        name: data.name,
        description: data.description || undefined,
        status: data.status,
        type: data.type,
        billing_type: data.billing_type,
        client_id: data.client_id,
        site_id: data.site_id || null,
        start_date: data.start_date ? new Date(data.start_date).toISOString() : null,
        target_date: data.target_date ? new Date(data.target_date).toISOString() : null,
        budget_amount: data.budget_amount ? parseFloat(data.budget_amount) : null,
        is_retainer: data.is_retainer,
        notes: data.notes || null,
      };

      if (isEdit) {
        await updateProject.mutateAsync({ id: project.id, data: payload });
      } else {
        await createProject.mutateAsync(payload);
      }
      onSuccess?.();
    } catch (error) {
      console.error('Failed to save project:', error);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="md:col-span-2">
          <Input
            label="Name"
            {...register('name')}
            error={errors.name?.message}
            placeholder="Project name"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-text-main mb-1">
            Patron
          </label>
          {clientsLoading ? (
            <div className="h-10 flex items-center">
              <Spinner size="sm" />
            </div>
          ) : (
            <>
              <Select
                options={clientOptions}
                value={watch('client_id')}
                onChange={(value) => {
                  const event = { target: { value, name: 'client_id' } };
                  register('client_id').onChange(event as any);
                }}
                placeholder="Select patron..."
              />
              {errors.client_id?.message && (
                <p className="text-sm text-red-500 mt-1">{errors.client_id.message}</p>
              )}
            </>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-text-main mb-1">
            Site
          </label>
          {sitesLoading ? (
            <div className="h-10 flex items-center">
              <Spinner size="sm" />
            </div>
          ) : (
            <Select
              options={[{ value: '', label: 'No site' }, ...siteOptions]}
              value={watch('site_id') || ''}
              onChange={(value) => {
                const event = { target: { value, name: 'site_id' } };
                register('site_id').onChange(event as any);
              }}
              placeholder="Select site..."
              disabled={!selectedClientId}
            />
          )}
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
          <label className="block text-sm font-medium text-text-main mb-1">
            Type
          </label>
          <Select
            options={typeOptions}
            value={watch('type')}
            onChange={(value) => {
              const event = { target: { value, name: 'type' } };
              register('type').onChange(event as any);
            }}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-text-main mb-1">
            Billing
          </label>
          <Select
            options={billingTypeOptions}
            value={watch('billing_type') || 'fixed'}
            onChange={(value) => {
              const event = { target: { value, name: 'billing_type' } };
              register('billing_type').onChange(event as any);
            }}
          />
        </div>

        <div>
          <Input
            label="Start Date"
            type="date"
            {...register('start_date')}
          />
        </div>

        <div>
          <Input
            label="Target Date"
            type="date"
            {...register('target_date')}
          />
        </div>

        <div>
          <Input
            label="Budget Amount"
            type="number"
            step="0.01"
            {...register('budget_amount')}
            placeholder="0.00"
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
            placeholder="Project description..."
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

        <div className="md:col-span-2">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              {...register('is_retainer')}
              className="rounded border-border text-primary focus:ring-primary"
            />
            <span className="text-sm text-text-main">This is a retainer project</span>
          </label>
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
            `Create ${t('project')}`
          )}
        </Button>
      </div>
    </form>
  );
}
