'use client';

import * as React from 'react';
import { useTasks } from '@/lib/hooks/use-tasks';
import { useCreateTimeEntry, useUpdateTimeEntry, TimeEntry } from '@/lib/hooks/use-time-entries';
import { useTerminology } from '@/lib/hooks/use-terminology';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

interface TimeEntryFormProps {
  entry?: TimeEntry | null;
  defaultDate?: Date;
  defaultTaskId?: string;
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function TimeEntryForm({
  entry,
  defaultDate,
  defaultTaskId,
  onSuccess,
  onCancel,
}: TimeEntryFormProps) {
  const isEdit = !!entry;
  const { t } = useTerminology();

  // Form state
  const [taskId, setTaskId] = React.useState(entry?.task_id || defaultTaskId || '');
  const [date, setDate] = React.useState(() => {
    if (entry) {
      return new Date(entry.started_at).toISOString().split('T')[0];
    }
    if (defaultDate) {
      return defaultDate.toISOString().split('T')[0];
    }
    return new Date().toISOString().split('T')[0];
  });
  const [startTime, setStartTime] = React.useState(() => {
    if (entry) {
      return new Date(entry.started_at).toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
      });
    }
    return '09:00';
  });
  const [hours, setHours] = React.useState(() => {
    if (entry) {
      return Math.floor(entry.duration / 60).toString();
    }
    return '0';
  });
  const [minutes, setMinutes] = React.useState(() => {
    if (entry) {
      return (entry.duration % 60).toString();
    }
    return '30';
  });
  const [description, setDescription] = React.useState(entry?.description || '');
  const [isBillable, setIsBillable] = React.useState(entry?.is_billable ?? true);

  // Fetch tasks for selector
  const { data: tasksData } = useTasks({ limit: 100 });

  const createEntry = useCreateTimeEntry();
  const updateEntry = useUpdateTimeEntry();

  const taskOptions = React.useMemo(() => {
    if (!tasksData?.tasks) return [];
    return tasksData.tasks.map((task) => ({
      value: task.id,
      label: task.project ? `${task.title} (${task.project.name})` : task.title,
    }));
  }, [tasksData?.tasks]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const durationMinutes = parseInt(hours) * 60 + parseInt(minutes);
    if (durationMinutes <= 0) {
      alert('Duration must be greater than 0');
      return;
    }

    const startedAt = new Date(`${date}T${startTime}:00`);
    const endedAt = new Date(startedAt.getTime() + durationMinutes * 60 * 1000);

    const data = {
      task_id: taskId || null,
      started_at: startedAt.toISOString(),
      ended_at: endedAt.toISOString(),
      duration: durationMinutes,
      description: description || null,
      is_billable: isBillable,
    };

    try {
      if (isEdit && entry) {
        await updateEntry.mutateAsync({ id: entry.id, data });
      } else {
        await createEntry.mutateAsync(data);
      }
      onSuccess?.();
    } catch (error) {
      console.error('Failed to save time entry:', error);
    }
  };

  const isPending = createEntry.isPending || updateEntry.isPending;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Task selector */}
      <Select
        label={`${t('task')} (optional)`}
        options={taskOptions}
        value={taskId}
        onChange={setTaskId}
        placeholder={`Select a ${t('task').toLowerCase()}...`}
      />

      {/* Date */}
      <Input
        label="Date"
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        required
      />

      {/* Start Time */}
      <Input
        label="Start Time"
        type="time"
        value={startTime}
        onChange={(e) => setStartTime(e.target.value)}
        required
      />

      {/* Duration */}
      <div>
        <label className="block text-sm font-medium text-text-main mb-1.5">
          Duration
        </label>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <Input
              type="number"
              min="0"
              max="24"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              className="w-20"
            />
            <span className="text-sm text-text-sub">hrs</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Input
              type="number"
              min="0"
              max="59"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              className="w-20"
            />
            <span className="text-sm text-text-sub">min</span>
          </div>
        </div>
      </div>

      {/* Description */}
      <Textarea
        label="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="What did you work on?"
        rows={2}
      />

      {/* Billable toggle */}
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={isBillable}
          onChange={(e) => setIsBillable(e.target.checked)}
          className="h-4 w-4 rounded border-border-warm text-primary focus:ring-primary"
        />
        <span className="text-sm text-text-main">Billable</span>
      </label>

      {/* Actions */}
      <div className="flex justify-end gap-3 pt-2">
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Saving...' : isEdit ? 'Update Entry' : 'Add Entry'}
        </Button>
      </div>
    </form>
  );
}
