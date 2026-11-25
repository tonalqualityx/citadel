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
import { Checkbox } from '@/components/ui/checkbox';
import { upcomingQuarters } from '@/lib/milestones/rock';

const milestoneSchema = z
  .object({
  name: z.string().min(1, 'Name is required').max(255),
  target_date: z.string().optional(),
  notes: z.string().optional(),
  billing_amount: z.number().positive('Billing amount must be positive').optional().nullable(),
  phase_id: z.string().uuid().optional().nullable(),
  is_rock: z.boolean().optional(),
  rock_quarter: z.string().optional().nullable(),
  rock_done_when: z.string().max(300, 'Keep it under 300 characters').optional().nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.is_rock && !value.rock_done_when?.trim()) {
      ctx.addIssue({
        code: 'custom',
        path: ['rock_done_when'],
        message: 'Add a yes-or-no line that says when this priority is done',
      });
    }
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
    watch,
    formState: { errors, isSubmitting },
  } = useForm<MilestoneFormData>({
    resolver: zodResolver(milestoneSchema),
    defaultValues: {
      name: milestone?.name || '',
      target_date: milestone?.target_date?.split('T')[0] || '',
      notes: milestone?.notes || '',
      billing_amount: milestone?.billing_amount ?? undefined,
      phase_id: milestone?.phase_id ?? undefined,
      is_rock: !!milestone?.rock_quarter,
      rock_quarter: milestone?.rock_quarter ?? undefined,
      rock_done_when: milestone?.rock_done_when ?? '',
    },
  });

  const isRock = watch('is_rock');
  const quarterOptions = React.useMemo(() => {
    const quarters = upcomingQuarters(3);
    // Keep an existing quarter selectable even when it is no longer upcoming
    if (milestone?.rock_quarter && !quarters.includes(milestone.rock_quarter)) {
      quarters.unshift(milestone.rock_quarter);
    }
    return quarters.map((q) => ({ value: q, label: q }));
  }, [milestone?.rock_quarter]);

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
        const rockQuarter = data.is_rock ? data.rock_quarter || quarterOptions[0]?.value : null;
        // A rock with no date leaves target_date out, so the API sets the quarter's last day
        const { target_date, ...rest } = payload;
        await updateMilestone.mutateAsync({
          id: milestone.id,
          data: {
            ...rest,
            ...(rockQuarter && !target_date ? {} : { target_date }),
            // Unmarking sends null; the API clears the done-when line with it
            rock_quarter: rockQuarter,
            ...(rockQuarter ? { rock_done_when: data.rock_done_when?.trim() || null } : {}),
          },
        });
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

      {isEdit && (
        <div className="space-y-3">
          <Controller
            name="is_rock"
            control={control}
            render={({ field }) => (
              <label className="flex items-center gap-2 text-sm text-text-main cursor-pointer">
                <Checkbox
                  checked={!!field.value}
                  onCheckedChange={field.onChange}
                  aria-label="Quarter priority"
                />
                Quarter priority
              </label>
            )}
          />
          {isRock && (
            <>
              <Controller
                name="rock_quarter"
                control={control}
                render={({ field }) => (
                  <Select
                    label="Quarter"
                    options={quarterOptions}
                    value={field.value ?? quarterOptions[0]?.value ?? ''}
                    onChange={(value) => field.onChange(value || null)}
                  />
                )}
              />
              <Input
                label="Done when"
                {...register('rock_done_when')}
                error={errors.rock_done_when?.message}
                maxLength={300}
                placeholder="A yes-or-no line that says this is done"
              />
              <p className="text-xs text-text-sub">
                A quarter can hold up to 7 priorities. With no target date, this uses the last day of the quarter.
              </p>
            </>
          )}
        </div>
      )}

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
