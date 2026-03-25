'use client';

import * as React from 'react';
import { useCreateMeeting } from '@/lib/hooks/use-meetings';
import { useClients } from '@/lib/hooks/use-clients';
import { useTerminology } from '@/lib/hooks/use-terminology';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import { showToast } from '@/lib/hooks/use-toast';

interface MeetingFormProps {
  onSuccess?: () => void;
  onCancel?: () => void;
  defaultClientId?: string;
  defaultAccordId?: string;
  defaultProjectId?: string;
  defaultCharterId?: string;
}

export function MeetingForm({
  onSuccess,
  onCancel,
  defaultClientId,
  defaultAccordId,
  defaultProjectId,
  defaultCharterId,
}: MeetingFormProps) {
  const { t } = useTerminology();
  const createMeeting = useCreateMeeting();
  const { data: clientsData } = useClients({ limit: 100 });

  const [title, setTitle] = React.useState('');
  const [clientId, setClientId] = React.useState<string | null>(defaultClientId || null);
  const [meetingDate, setMeetingDate] = React.useState(
    new Date().toISOString().split('T')[0]
  );
  const [notes, setNotes] = React.useState('');

  const clientOptions = React.useMemo(() => {
    if (!clientsData?.clients) return [];
    return clientsData.clients.map((c) => ({
      value: c.id,
      label: c.name,
    }));
  }, [clientsData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !clientId) return;

    try {
      await createMeeting.mutateAsync({
        title: title.trim(),
        client_id: clientId,
        meeting_date: new Date(meetingDate + 'T00:00:00.000Z').toISOString(),
        notes: notes.trim() || undefined,
        accord_ids: defaultAccordId ? [defaultAccordId] : undefined,
        project_ids: defaultProjectId ? [defaultProjectId] : undefined,
        charter_ids: defaultCharterId ? [defaultCharterId] : undefined,
      });
      onSuccess?.();
    } catch {
      // Error handled by hook
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        label="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Meeting title"
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

      <Input
        label="Date"
        type="date"
        value={meetingDate}
        onChange={(e) => setMeetingDate(e.target.value)}
        required
      />

      <div>
        <label className="block text-sm font-medium text-text-main mb-1">
          Notes
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional meeting notes..."
          rows={3}
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-main placeholder:text-text-sub focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent resize-none"
        />
      </div>

      <div className="flex justify-end gap-3 pt-2">
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button
          type="submit"
          disabled={!title.trim() || !clientId || createMeeting.isPending}
        >
          {createMeeting.isPending ? 'Creating...' : 'Create Meeting'}
        </Button>
      </div>
    </form>
  );
}
