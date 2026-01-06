'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useCreateClient, useUpdateClient, useClients } from '@/lib/hooks/use-clients';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import type { ClientWithRelations, CreateClientInput, UpdateClientInput } from '@/types/entities';

const clientSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  type: z.enum(['direct', 'agency_partner', 'sub_client']),
  status: z.enum(['active', 'inactive', 'delinquent']),
  primary_contact: z.string().max(255).optional(),
  email: z.string().email('Invalid email').optional().or(z.literal('')),
  phone: z.string().max(50).optional(),
  retainer_hours: z.number().min(0).optional().nullable(),
  hourly_rate: z.number().min(0).optional().nullable(),
  parent_agency_id: z.string().uuid().optional().nullable(),
  notes: z.string().optional(),
});

type ClientFormData = z.infer<typeof clientSchema>;

interface ClientFormProps {
  client?: ClientWithRelations;
  onSuccess?: () => void;
  onCancel?: () => void;
}

const typeOptions = [
  { value: 'direct', label: 'Direct Client' },
  { value: 'agency_partner', label: 'Agency Partner' },
  { value: 'sub_client', label: 'Sub-Client' },
];

const statusOptions = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'delinquent', label: 'Delinquent' },
];

export function ClientForm({ client, onSuccess, onCancel }: ClientFormProps) {
  const isEditing = !!client;
  const createClient = useCreateClient();
  const updateClient = useUpdateClient();

  // Fetch agency partners for parent selection
  const { data: agencyPartnersData } = useClients({ type: 'agency_partner', limit: 100 });
  const agencyOptions = React.useMemo(() => {
    return (agencyPartnersData?.clients || [])
      .filter((c) => c.id !== client?.id) // Exclude self
      .map((c) => ({ value: c.id, label: c.name }));
  }, [agencyPartnersData?.clients, client?.id]);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<ClientFormData>({
    resolver: zodResolver(clientSchema),
    defaultValues: {
      name: client?.name || '',
      type: client?.type || 'direct',
      status: client?.status || 'active',
      primary_contact: client?.primary_contact || '',
      email: client?.email || '',
      phone: client?.phone || '',
      retainer_hours: client?.retainer_hours ?? null,
      hourly_rate: client?.hourly_rate ?? null,
      parent_agency_id: client?.parent_agency_id ?? null,
      notes: client?.notes || '',
    },
  });

  const selectedType = watch('type');
  const showParentAgency = selectedType === 'sub_client';

  const onSubmit = async (data: ClientFormData) => {
    try {
      // Build payload, converting null/NaN to undefined (API doesn't accept null)
      const payload: Record<string, unknown> = {
        name: data.name,
        type: data.type,
        status: data.status,
      };

      // Only include optional fields if they have values
      if (data.primary_contact) payload.primary_contact = data.primary_contact;
      if (data.email) payload.email = data.email;
      if (data.phone) payload.phone = data.phone;
      if (data.notes) payload.notes = data.notes;

      // Handle number fields - exclude if NaN, null, or undefined
      if (typeof data.retainer_hours === 'number' && !Number.isNaN(data.retainer_hours)) {
        payload.retainer_hours = data.retainer_hours;
      }
      if (typeof data.hourly_rate === 'number' && !Number.isNaN(data.hourly_rate)) {
        payload.hourly_rate = data.hourly_rate;
      }

      // Only include parent_agency_id for sub_clients with a selected value
      if (showParentAgency && data.parent_agency_id) {
        payload.parent_agency_id = data.parent_agency_id;
      }

      if (isEditing) {
        await updateClient.mutateAsync({ id: client.id, data: payload as UpdateClientInput });
      } else {
        await createClient.mutateAsync(payload as CreateClientInput);
      }
      onSuccess?.();
    } catch (error) {
      console.error('Failed to save client:', error);
    }
  };

  const isPending = createClient.isPending || updateClient.isPending;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <Input
        label="Name"
        {...register('name')}
        error={errors.name?.message}
        placeholder="Client name"
      />

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-text-main mb-1.5">Type</label>
          <Select
            options={typeOptions}
            value={watch('type')}
            onChange={(value) => setValue('type', value as ClientFormData['type'])}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-text-main mb-1.5">Status</label>
          <Select
            options={statusOptions}
            value={watch('status')}
            onChange={(value) => setValue('status', value as ClientFormData['status'])}
          />
        </div>
      </div>

      {showParentAgency && (
        <div>
          <label className="block text-sm font-medium text-text-main mb-1.5">Parent Agency</label>
          <Select
            options={agencyOptions}
            value={watch('parent_agency_id') || ''}
            onChange={(value) => setValue('parent_agency_id', value || null)}
            placeholder="Select parent agency..."
          />
        </div>
      )}

      <Input
        label="Primary Contact"
        {...register('primary_contact')}
        error={errors.primary_contact?.message}
        placeholder="Contact person name"
      />

      <div className="grid grid-cols-2 gap-4">
        <Input
          label="Email"
          type="email"
          {...register('email')}
          error={errors.email?.message}
          placeholder="email@example.com"
        />
        <Input
          label="Phone"
          {...register('phone')}
          error={errors.phone?.message}
          placeholder="(555) 123-4567"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Input
          label="Retainer Hours (per month)"
          type="number"
          step="0.5"
          {...register('retainer_hours', { valueAsNumber: true })}
          error={errors.retainer_hours?.message}
          placeholder="0"
        />
        <Input
          label="Hourly Rate ($)"
          type="number"
          step="0.01"
          {...register('hourly_rate', { valueAsNumber: true })}
          error={errors.hourly_rate?.message}
          placeholder="0.00"
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
          {isEditing ? 'Save Changes' : 'Create Patron'}
        </Button>
      </div>
    </form>
  );
}
