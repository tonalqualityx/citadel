'use client';

import * as React from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Combobox } from '@/components/ui/combobox';
import { useClients } from '@/lib/hooks/use-clients';
import { useTerminology } from '@/lib/hooks/use-terminology';
import type { CreateCharterInput, CharterBillingPeriod } from '@/types/entities';

interface CharterFormProps {
  onSubmit: (data: CreateCharterInput) => void;
  onCancel: () => void;
  isSubmitting?: boolean;
  initialData?: Partial<CreateCharterInput>;
}

const billingPeriodOptions = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'annually', label: 'Annually' },
];

export function CharterForm({ onSubmit, onCancel, isSubmitting = false, initialData }: CharterFormProps) {
  const { t } = useTerminology();
  const { data: clientsData } = useClients({ limit: 100, status: 'active' });

  const [name, setName] = React.useState(initialData?.name ?? '');
  const [clientId, setClientId] = React.useState<string | null>(initialData?.client_id ?? null);
  const [billingPeriod, setBillingPeriod] = React.useState<string>(initialData?.billing_period ?? 'monthly');
  const [budgetHours, setBudgetHours] = React.useState(initialData?.budget_hours?.toString() ?? '');
  const [hourlyRate, setHourlyRate] = React.useState(initialData?.hourly_rate?.toString() ?? '');
  const [budgetAmount, setBudgetAmount] = React.useState(initialData?.budget_amount?.toString() ?? '');
  const [startDate, setStartDate] = React.useState(initialData?.start_date ?? '');
  const [endDate, setEndDate] = React.useState(initialData?.end_date ?? '');

  const clientOptions = React.useMemo(() => {
    if (!clientsData?.clients) return [];
    return clientsData.clients.map((c) => ({
      value: c.id,
      label: c.name,
    }));
  }, [clientsData]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !clientId || !startDate) return;

    const data: CreateCharterInput = {
      name: name.trim(),
      client_id: clientId,
      billing_period: billingPeriod as CharterBillingPeriod,
      start_date: startDate,
    };

    if (budgetHours) data.budget_hours = parseFloat(budgetHours);
    if (hourlyRate) data.hourly_rate = parseFloat(hourlyRate);
    if (budgetAmount) data.budget_amount = parseFloat(budgetAmount);
    if (endDate) data.end_date = endDate;

    onSubmit(data);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        label="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Charter name"
        required
      />

      <Combobox
        label={t('client')}
        options={clientOptions}
        value={clientId}
        onChange={setClientId}
        placeholder={`Select ${t('client').toLowerCase()}...`}
        searchPlaceholder={`Search ${t('clients').toLowerCase()}...`}
      />

      <Select
        label="Billing Period"
        options={billingPeriodOptions}
        value={billingPeriod}
        onChange={setBillingPeriod}
        placeholder="Select billing period..."
      />

      <div className="grid grid-cols-3 gap-3">
        <Input
          label="Budget Hours"
          type="number"
          value={budgetHours}
          onChange={(e) => setBudgetHours(e.target.value)}
          placeholder="0"
          min="0"
          step="0.5"
        />
        <Input
          label="Hourly Rate"
          type="number"
          value={hourlyRate}
          onChange={(e) => setHourlyRate(e.target.value)}
          placeholder="0.00"
          min="0"
          step="0.01"
        />
        <Input
          label="Budget Amount"
          type="number"
          value={budgetAmount}
          onChange={(e) => setBudgetAmount(e.target.value)}
          placeholder="0.00"
          min="0"
          step="0.01"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Start Date"
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          required
        />
        <Input
          label="End Date"
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
        />
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={!name.trim() || !clientId || !startDate || isSubmitting}
        >
          {isSubmitting ? 'Saving...' : initialData ? 'Update Charter' : 'Create Charter'}
        </Button>
      </div>
    </form>
  );
}
