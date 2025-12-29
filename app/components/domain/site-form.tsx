'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useCreateSite, useUpdateSite } from '@/lib/hooks/use-sites';
import { useClients } from '@/lib/hooks/use-clients';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import type { SiteWithRelations, CreateSiteInput, UpdateSiteInput } from '@/types/entities';

const siteSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  url: z.string().url('Invalid URL').optional().or(z.literal('')),
  client_id: z.string().uuid('Please select a client'),
  hosted_by: z.enum(['indelible', 'client', 'other']),
  platform: z.string().max(100).optional(),
  hosting_plan_id: z.string().uuid().optional().nullable(),
  maintenance_plan_id: z.string().uuid().optional().nullable(),
  notes: z.string().optional(),
});

type SiteFormData = z.infer<typeof siteSchema>;

interface SiteFormProps {
  site?: SiteWithRelations;
  defaultClientId?: string;
  onSuccess?: () => void;
  onCancel?: () => void;
}

const hostedByOptions = [
  { value: 'indelible', label: 'Indelible' },
  { value: 'client', label: 'Client' },
  { value: 'other', label: 'Other' },
];

export function SiteForm({ site, defaultClientId, onSuccess, onCancel }: SiteFormProps) {
  const isEditing = !!site;
  const createSite = useCreateSite();
  const updateSite = useUpdateSite();

  // Fetch clients for dropdown
  const { data: clientsData } = useClients({ limit: 100, status: 'active' });
  const clientOptions = React.useMemo(() => {
    return (clientsData?.clients || []).map((c) => ({ value: c.id, label: c.name }));
  }, [clientsData?.clients]);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<SiteFormData>({
    resolver: zodResolver(siteSchema),
    defaultValues: {
      name: site?.name || '',
      url: site?.url || '',
      client_id: site?.client_id || defaultClientId || '',
      hosted_by: site?.hosted_by || 'indelible',
      platform: site?.platform || '',
      hosting_plan_id: site?.hosting_plan_id ?? null,
      maintenance_plan_id: site?.maintenance_plan_id ?? null,
      notes: site?.notes || '',
    },
  });

  const onSubmit = async (data: SiteFormData) => {
    try {
      const payload = {
        ...data,
        url: data.url || undefined,
      };

      if (isEditing) {
        const { client_id, ...updateData } = payload;
        await updateSite.mutateAsync({ id: site.id, data: updateData as UpdateSiteInput });
      } else {
        await createSite.mutateAsync(payload as CreateSiteInput);
      }
      onSuccess?.();
    } catch (error) {
      console.error('Failed to save site:', error);
    }
  };

  const isPending = createSite.isPending || updateSite.isPending;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <Input
        label="Site Name"
        {...register('name')}
        error={errors.name?.message}
        placeholder="My Awesome Site"
      />

      <Input
        label="URL"
        {...register('url')}
        error={errors.url?.message}
        placeholder="https://example.com"
      />

      {!isEditing && (
        <div>
          <label className="block text-sm font-medium text-text-main mb-1.5">Client</label>
          <Select
            options={clientOptions}
            value={watch('client_id')}
            onChange={(value) => setValue('client_id', value)}
            placeholder="Select a client..."
          />
          {errors.client_id && (
            <p className="mt-1 text-sm text-red-600">{errors.client_id.message}</p>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-text-main mb-1.5">Hosted By</label>
          <Select
            options={hostedByOptions}
            value={watch('hosted_by')}
            onChange={(value) => setValue('hosted_by', value as SiteFormData['hosted_by'])}
          />
        </div>
        <Input
          label="Platform"
          {...register('platform')}
          error={errors.platform?.message}
          placeholder="WordPress, Shopify, etc."
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-text-main mb-1.5">Notes</label>
        <textarea
          {...register('notes')}
          rows={3}
          className="w-full px-3 py-2 rounded-lg border border-border-warm bg-surface text-text-main placeholder:text-text-sub focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-colors resize-none"
          placeholder="Additional notes..."
        />
      </div>

      <div className="flex justify-end gap-3 pt-4">
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={isPending}>
          {isPending && <Spinner size="sm" className="mr-2" />}
          {isEditing ? 'Save Changes' : 'Create Site'}
        </Button>
      </div>
    </form>
  );
}
