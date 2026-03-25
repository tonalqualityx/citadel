'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useCreateAccord } from '@/lib/hooks/use-accords';
import { useClients } from '@/lib/hooks/use-clients';
import { useTerminology } from '@/lib/hooks/use-terminology';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';

interface AccordFormProps {
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function AccordForm({ onSuccess, onCancel }: AccordFormProps) {
  const router = useRouter();
  const { t } = useTerminology();
  const createAccord = useCreateAccord();
  const { data: clientsData } = useClients({ limit: 100 });

  const [name, setName] = React.useState('');
  const [clientId, setClientId] = React.useState<string | null>(null);
  const [leadName, setLeadName] = React.useState('');
  const [leadBusinessName, setLeadBusinessName] = React.useState('');
  const [leadEmail, setLeadEmail] = React.useState('');
  const [leadPhone, setLeadPhone] = React.useState('');

  const clientOptions = React.useMemo(() => {
    if (!clientsData?.clients) return [];
    return clientsData.clients.map((c) => ({
      value: c.id,
      label: c.name,
    }));
  }, [clientsData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const result = await createAccord.mutateAsync({
      name: name.trim(),
      client_id: clientId || undefined,
      lead_name: leadName.trim() || undefined,
      lead_business_name: leadBusinessName.trim() || undefined,
      lead_email: leadEmail.trim() || undefined,
      lead_phone: leadPhone.trim() || undefined,
    });

    if (result?.id) {
      router.push(`/deals/${result.id}`);
    }
    onSuccess?.();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        label="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Accord name"
        required
      />

      <Combobox
        label={t('client')}
        options={clientOptions}
        value={clientId}
        onChange={setClientId}
        placeholder={`Select a ${t('client').toLowerCase()}...`}
        searchPlaceholder={`Search ${t('clients').toLowerCase()}...`}
      />

      {!clientId && (
        <div className="space-y-3 p-4 rounded-lg border border-border-warm bg-background-light">
          <p className="text-sm font-medium text-text-main">
            Or enter lead information
          </p>
          <Input
            label="Lead Name"
            value={leadName}
            onChange={(e) => setLeadName(e.target.value)}
            placeholder="Contact name"
          />
          <Input
            label="Lead Business Name"
            value={leadBusinessName}
            onChange={(e) => setLeadBusinessName(e.target.value)}
            placeholder="Company name"
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Email"
              type="email"
              value={leadEmail}
              onChange={(e) => setLeadEmail(e.target.value)}
              placeholder="email@example.com"
            />
            <Input
              label="Phone"
              type="tel"
              value={leadPhone}
              onChange={(e) => setLeadPhone(e.target.value)}
              placeholder="(555) 123-4567"
            />
          </div>
        </div>
      )}

      <div className="flex justify-end gap-3 pt-2">
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={!name.trim() || createAccord.isPending}>
          {createAccord.isPending ? 'Creating...' : `Create ${t('deal')}`}
        </Button>
      </div>
    </form>
  );
}
