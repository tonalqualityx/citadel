'use client';

import * as React from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Milestone,
  useCreateMilestone,
  useUpdateMilestone,
} from '@/lib/hooks/use-milestones';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';

const milestoneSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  target_date: z.string().optional(),
  notes: z.string().optional(),
  billing_amount: z.number().positive('Billing amount must be positive').optional().nullable(),
  phase_id: z.string().uuid().optional().nullable(),
});

type MilestoneFormData = z.infer<typeof milestoneSchema>;

export interface Phase {
  id: string;
  name: string;
}

interface MilestoneFormProps {
  projectId: string;
  milestone?: Milestone | null;
  phases?: Phase[];
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function MilestoneForm({
  projectId,
  milestone,
  phases = [],
  onSuccess,
  onCancel,
}: MilestoneFormProps) {
  const isEdit = !!milestone;
  const createMilestone = useCreateMilestone(projectId);
  const updateMilestone = useUpdateMilestone(projectId);

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<MilestoneFormData>({
    resolver: zodResolver(milestoneSchema),
    defaultValues: {
      name: milestone?.name || '',
      target_date: milestone?.target_date?.split('T')[0] || '',
      notes: milestone?.notes || '',
      billing_amount: milestone?.billing_amount ?? undefined,
      phase_id: milestone?.phase_id ?? undefined,
    },
  });

  const isLoading = isSubmitting || createMilestone.isPending || updateMilestone.isPending;

  const onSubmit = async (data: MilestoneFormData) => {
    try {
      const payload = {
        name: data.name,
        target_date: data.target_date ? new Date(data.target_date).toISOString() : null,
        notes: data.notes || null,
        billing_amount: data.billing_amount ?? null,
        phase_id: data.phase_id || null,
      };

      if (isEdit && milestone) {
        await updateMilestone.mutateAsync({ id: milestone.id, data: payload });
      } else {
        await createMilestone.mutateAsync(payload);
      }
      onSuccess?.();
    } catch (error) {
      // Error handling is done in the hooks via showToast
      console.error('Failed to save milestone:', error);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <Input
          label="Name *"
          {...register('name')}
          error={errors.name?.message}
          placeholder="Milestone name"
        />
      </div>

      <div>
        <Input
          label="Target Date"
          type="date"
          {...register('target_date')}
          error={errors.target_date?.message}
        />
      </div>

      <div>
        <Textarea
          label="Notes"
          {...register('notes')}
          error={errors.notes?.message}
          placeholder="Optional notes about this milestone..."
          rows={3}
        />
      </div>

      <div>
        <Controller
          name="billing_amount"
          control={control}
          render={({ field }) => (
            <Input
              label="Billing Amount"
              type="number"
              step="0.01"
              min="0"
              placeholder="e.g., 1500.00"
              value={field.value ?? ''}
              onChange={(e) => {
                const value = e.target.value;
                field.onChange(value ? parseFloat(value) : null);
              }}
              error={errors.billing_amount?.message}
            />
          )}
        />
        <p className="text-xs text-text-sub mt-1">
          Optional: Set a billing amount to enable billing workflow for this milestone.
        </p>
      </div>

      {phases.length > 0 && (
        <div>
          <Controller
            name="phase_id"
            control={control}
            render={({ field }) => (
              <Select
                label="Phase"
                placeholder="Select a phase (optional)"
                options={phases.map((phase) => ({
                  value: phase.id,
                  label: phase.name,
                }))}
                value={field.value ?? ''}
                onChange={(value) => field.onChange(value || null)}
              />
            )}
          />
        </div>
      )}

      <div className="flex justify-end gap-2 pt-4 border-t border-border">
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={isLoading}>
          {isLoading ? (
            <>
              <Spinner size="sm" className="mr-2" />
              {isEdit ? 'Saving...' : 'Creating...'}
            </>
          ) : isEdit ? (
            'Save Changes'
          ) : (
            'Create Milestone'
          )}
        </Button>
      </div>
    </form>
  );
}
