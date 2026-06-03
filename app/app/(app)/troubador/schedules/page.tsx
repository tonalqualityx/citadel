'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, Pause, Play, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalBody,
} from '@/components/ui/modal';
import { useClients } from '@/lib/hooks/use-clients';
import {
  useTroubadorSchedules,
  useCreateSchedule,
  useUpdateSchedule,
  useDeleteSchedule,
} from '@/lib/hooks/use-troubador';
import { ScheduleForm } from '@/components/domain/troubador/ScheduleForm';
import type {
  CreateScheduleInput,
  Schedule,
  ScheduleStatus,
} from '@/lib/types/troubador';

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: '', label: 'All Statuses' },
];

function statusVariant(status: ScheduleStatus): 'success' | 'warning' | 'error' | 'default' {
  if (status === 'active') return 'success';
  if (status === 'paused') return 'warning';
  if (status === 'cancelled') return 'error';
  return 'default';
}

export default function SchedulesPage() {
  const [status, setStatus] = React.useState('active');
  const [clientId, setClientId] = React.useState('');
  const [showCreate, setShowCreate] = React.useState(false);
  const [editing, setEditing] = React.useState<Schedule | null>(null);

  const { data: clientsData } = useClients({ limit: 200 });
  const clientOptions = [
    { value: '', label: 'All Clients' },
    ...(clientsData?.clients ?? []).map((c) => ({ value: c.id, label: c.name })),
  ];

  const { data, isLoading, isError } = useTroubadorSchedules({
    status: status || undefined,
    client_id: clientId || undefined,
  });

  const createSchedule = useCreateSchedule();
  const updateSchedule = useUpdateSchedule();
  const deleteSchedule = useDeleteSchedule();

  const handleCreate = async (input: CreateScheduleInput) => {
    await createSchedule.mutateAsync(input);
    setShowCreate(false);
  };

  const handleEdit = async (input: CreateScheduleInput) => {
    if (!editing) return;
    await updateSchedule.mutateAsync({ id: editing.id, data: input });
    setEditing(null);
  };

  const toggleStatus = (schedule: Schedule) => {
    const next = schedule.status === 'active' ? 'paused' : 'active';
    updateSchedule.mutate({ id: schedule.id, data: { status: next } });
  };

  const handleDelete = (schedule: Schedule) => {
    if (confirm(`Delete schedule "${schedule.name}"?`)) {
      deleteSchedule.mutate(schedule.id);
    }
  };

  const schedules = data?.schedules ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <Link
            href="/troubador"
            className="inline-flex items-center gap-1 text-sm text-text-sub hover:text-text-main transition-colors mb-1"
          >
            <ArrowLeft className="h-4 w-4" /> Board
          </Link>
          <h1 className="text-2xl font-semibold text-text-main">Schedules</h1>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4" /> New Schedule
        </Button>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="w-48">
          <Select value={status} onChange={setStatus} options={STATUS_OPTIONS} />
        </div>
        <div className="w-56">
          <Select value={clientId} onChange={setClientId} options={clientOptions} />
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner size="md" />
        </div>
      ) : isError ? (
        <div className="text-center py-12 text-text-sub text-sm">
          Failed to load schedules.
        </div>
      ) : schedules.length === 0 ? (
        <EmptyState
          title="No schedules"
          description="Create a content schedule to plan recurring publishing cadence."
          action={
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4" /> New Schedule
            </Button>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border-warm">
          <table className="w-full text-sm">
            <thead className="bg-background-light text-text-sub">
              <tr>
                <th className="text-left font-medium px-3 py-2">Name</th>
                <th className="text-left font-medium px-3 py-2">Client</th>
                <th className="text-left font-medium px-3 py-2">Site</th>
                <th className="text-left font-medium px-3 py-2">Cadence</th>
                <th className="text-left font-medium px-3 py-2">Default editor</th>
                <th className="text-left font-medium px-3 py-2">Status</th>
                <th className="text-right font-medium px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {schedules.map((s) => (
                <tr
                  key={s.id}
                  className="border-t border-border-warm hover:bg-background-light/60"
                >
                  <td className="px-3 py-2 font-medium text-text-main">{s.name}</td>
                  <td className="px-3 py-2 text-text-sub">{s.client?.name ?? '—'}</td>
                  <td className="px-3 py-2 text-text-sub">{s.site?.name ?? '—'}</td>
                  <td className="px-3 py-2 text-text-sub">
                    {s.target_article_count ?? '?'} articles ·{' '}
                    {s.publish_per_week ?? '?'}/wk · {s.lead_time_days ?? '?'}d lead
                  </td>
                  <td className="px-3 py-2 text-text-sub">
                    {s.default_assignee?.name ?? '—'}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={statusVariant(s.status)} size="sm">
                      {s.status}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        title={s.status === 'active' ? 'Pause' : 'Resume'}
                        onClick={() => toggleStatus(s)}
                        disabled={updateSchedule.isPending}
                      >
                        {s.status === 'active' ? (
                          <Pause className="h-4 w-4" />
                        ) : (
                          <Play className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        title="Edit"
                        onClick={() => setEditing(s)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        title="Delete"
                        onClick={() => handleDelete(s)}
                        disabled={deleteSchedule.isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={showCreate} onOpenChange={setShowCreate}>
        <ModalContent size="xl">
          <ModalHeader>
            <ModalTitle>New Schedule</ModalTitle>
          </ModalHeader>
          <ModalBody>
            <ScheduleForm
              onSubmit={handleCreate}
              onCancel={() => setShowCreate(false)}
              isSubmitting={createSchedule.isPending}
            />
          </ModalBody>
        </ModalContent>
      </Modal>

      <Modal open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <ModalContent size="xl">
          <ModalHeader>
            <ModalTitle>Edit Schedule</ModalTitle>
          </ModalHeader>
          <ModalBody>
            {editing && (
              <ScheduleForm
                initial={editing}
                onSubmit={handleEdit}
                onCancel={() => setEditing(null)}
                isSubmitting={updateSchedule.isPending}
              />
            )}
          </ModalBody>
        </ModalContent>
      </Modal>
    </div>
  );
}
