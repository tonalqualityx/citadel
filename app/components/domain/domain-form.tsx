'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useCreateDomain, useUpdateDomain } from '@/lib/hooks/use-domains';
import { useSites } from '@/lib/hooks/use-sites';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import type { DomainWithRelations, CreateDomainInput, UpdateDomainInput } from '@/types/entities';

const domainSchema = z.object({
  name: z.string().min(1, 'Domain name is required').max(255),
  site_id: z.string().uuid('Please select a site'),
  registrar: z.string().max(100).optional(),
  expires_at: z.string().optional(),
  is_primary: z.boolean(),
  notes: z.string().optional(),
});

type DomainFormData = z.infer<typeof domainSchema>;

interface DomainFormProps {
  domain?: DomainWithRelations;
  defaultSiteId?: string;
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function DomainForm({ domain, defaultSiteId, onSuccess, onCancel }: DomainFormProps) {
  const isEditing = !!domain;
  const createDomain = useCreateDomain();
  const updateDomain = useUpdateDomain();

  // Fetch sites for dropdown
  const { data: sitesData } = useSites({ limit: 100 });
  const siteOptions = React.useMemo(() => {
    return (sitesData?.sites || []).map((s) => ({
      value: s.id,
      label: `${s.name}${s.client?.name ? ` (${s.client.name})` : ''}`,
    }));
  }, [sitesData?.sites]);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<DomainFormData>({
    resolver: zodResolver(domainSchema),
    defaultValues: {
      name: domain?.name || '',
      site_id: domain?.site_id || defaultSiteId || '',
      registrar: domain?.registrar || '',
      expires_at: domain?.expires_at
        ? new Date(domain.expires_at).toISOString().split('T')[0]
        : '',
      is_primary: domain?.is_primary ?? false,
      notes: domain?.notes || '',
    },
  });

  const onSubmit = async (data: DomainFormData) => {
    try {
      const payload = {
        ...data,
        expires_at: data.expires_at ? new Date(data.expires_at).toISOString() : undefined,
      };

      if (isEditing) {
        const { site_id, ...updateData } = payload;
        await updateDomain.mutateAsync({ id: domain.id, data: updateData as UpdateDomainInput });
      } else {
        await createDomain.mutateAsync(payload as CreateDomainInput);
      }
      onSuccess?.();
    } catch (error) {
      console.error('Failed to save domain:', error);
    }
  };

  const isPending = createDomain.isPending || updateDomain.isPending;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <Input
        label="Domain Name"
        {...register('name')}
        error={errors.name?.message}
        placeholder="example.com"
      />

      {!isEditing && (
        <div>
          <label className="block text-sm font-medium text-text-main mb-1.5">Site</label>
          <Select
            options={siteOptions}
            value={watch('site_id')}
            onChange={(value) => setValue('site_id', value)}
            placeholder="Select a site..."
          />
          {errors.site_id && (
            <p className="mt-1 text-sm text-red-600">{errors.site_id.message}</p>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <Input
          label="Registrar"
          {...register('registrar')}
          error={errors.registrar?.message}
          placeholder="GoDaddy, Namecheap, etc."
        />
        <Input
          label="Expiration Date"
          type="date"
          {...register('expires_at')}
          error={errors.expires_at?.message}
        />
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="is_primary"
          {...register('is_primary')}
          className="h-4 w-4 rounded border-border-warm text-primary focus:ring-primary"
        />
        <label htmlFor="is_primary" className="text-sm text-text-main">
          Primary domain for this site
        </label>
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
          {isEditing ? 'Save Changes' : 'Create Domain'}
        </Button>
      </div>
    </form>
  );
}
