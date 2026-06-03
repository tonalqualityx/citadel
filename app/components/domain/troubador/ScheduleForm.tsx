'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { useClients } from '@/lib/hooks/use-clients';
import { useSites } from '@/lib/hooks/use-sites';
import { useUsers } from '@/lib/hooks/use-users';
import type { CreateScheduleInput, Schedule } from '@/lib/types/troubador';

interface ScheduleFormProps {
  initial?: Schedule | null;
  onSubmit: (data: CreateScheduleInput) => void | Promise<void>;
  onCancel: () => void;
  isSubmitting?: boolean;
}

export function ScheduleForm({
  initial,
  onSubmit,
  onCancel,
  isSubmitting,
}: ScheduleFormProps) {
  const [clientId, setClientId] = React.useState(initial?.client?.id ?? '');
  const [siteId, setSiteId] = React.useState(initial?.site?.id ?? '');
  const [name, setName] = React.useState(initial?.name ?? '');
  const [targetCount, setTargetCount] = React.useState(
    initial?.target_article_count != null ? String(initial.target_article_count) : ''
  );
  const [perWeek, setPerWeek] = React.useState(
    initial?.publish_per_week != null ? String(initial.publish_per_week) : ''
  );
  const [leadTime, setLeadTime] = React.useState(
    initial?.lead_time_days != null ? String(initial.lead_time_days) : ''
  );
  const [goals, setGoals] = React.useState(initial?.overarching_goals ?? '');
  const [assigneeId, setAssigneeId] = React.useState(
    initial?.default_assignee?.id ?? ''
  );
  const [allowConcurrent, setAllowConcurrent] = React.useState(
    initial?.allow_concurrent ?? false
  );
  const [startDate, setStartDate] = React.useState(
    initial?.start_date?.split('T')[0] ?? ''
  );

  const { data: clientsData } = useClients({ limit: 200 });
  const { data: sitesData } = useSites(
    clientId ? { client_id: clientId, limit: 200 } : { limit: 200 }
  );
  const { data: usersData } = useUsers();

  const clientOptions = (clientsData?.clients ?? []).map((c) => ({
    value: c.id,
    label: c.name,
  }));
  const siteOptions = (sitesData?.sites ?? []).map((s) => ({
    value: s.id,
    label: s.name,
  }));
  const userOptions = (usersData?.users ?? []).map((u) => ({
    value: u.id,
    label: u.name,
  }));

  const canSubmit = clientId && siteId && name.trim() && startDate;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit({
      client_id: clientId,
      site_id: siteId,
      name: name.trim(),
      target_article_count: targetCount ? Number(targetCount) : undefined,
      publish_per_week: perWeek ? Number(perWeek) : undefined,
      lead_time_days: leadTime ? Number(leadTime) : undefined,
      overarching_goals: goals.trim() || undefined,
      default_assignee_id: assigneeId || undefined,
      allow_concurrent: allowConcurrent,
      start_date: startDate,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Select
        label="Client"
        value={clientId}
        onChange={(v) => {
          setClientId(v);
          setSiteId('');
        }}
        options={clientOptions}
        placeholder="Select client"
      />
      <Select
        label="Site"
        value={siteId}
        onChange={setSiteId}
        options={siteOptions}
        placeholder="Select site"
      />
      <Input
        label="Schedule name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Q3 Content Plan"
      />
      <div className="grid grid-cols-3 gap-3">
        <Input
          label="Target articles"
          type="number"
          min={0}
          value={targetCount}
          onChange={(e) => setTargetCount(e.target.value)}
        />
        <Input
          label="Per week"
          type="number"
          min={0}
          value={perWeek}
          onChange={(e) => setPerWeek(e.target.value)}
        />
        <Input
          label="Lead time (days)"
          type="number"
          min={0}
          value={leadTime}
          onChange={(e) => setLeadTime(e.target.value)}
        />
      </div>
      <Input
        label="Start date"
        type="date"
        value={startDate}
        onChange={(e) => setStartDate(e.target.value)}
      />
      <Select
        label="Default editor"
        value={assigneeId}
        onChange={setAssigneeId}
        options={userOptions}
        placeholder="Unassigned"
      />
      <Textarea
        label="Overarching goals"
        value={goals}
        rows={3}
        onChange={(e) => setGoals(e.target.value)}
      />
      <label className="flex items-center gap-2 text-sm text-text-main">
        <Checkbox checked={allowConcurrent} onCheckedChange={setAllowConcurrent} />
        Allow concurrent runs
      </label>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!canSubmit || isSubmitting}>
          {isSubmitting ? 'Saving…' : initial ? 'Save schedule' : 'Create schedule'}
        </Button>
      </div>
    </form>
  );
}
