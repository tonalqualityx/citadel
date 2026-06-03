'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, CalendarDays, ListChecks } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalBody,
} from '@/components/ui/modal';
import { useClients } from '@/lib/hooks/use-clients';
import { useSites } from '@/lib/hooks/use-sites';
import { useTroubadorRuns, useCreateRun } from '@/lib/hooks/use-troubador';
import { RunCard } from '@/components/domain/troubador/RunCard';
import type { Run, RunStage } from '@/lib/types/troubador';

const BOARD_STAGES: { id: RunStage; title: string }[] = [
  { id: 'planning', title: 'Planning' },
  { id: 'topic_selection', title: 'Topic Selection' },
  { id: 'researching', title: 'Researching' },
  { id: 'ready_for_interview', title: 'Ready for Interview' },
  { id: 'in_production', title: 'In Production' },
  { id: 'done', title: 'Done' },
];

function NewRunModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const createRun = useCreateRun();
  const [clientId, setClientId] = React.useState('');
  const [siteId, setSiteId] = React.useState('');
  const [title, setTitle] = React.useState('');
  const [brief, setBrief] = React.useState('');

  const { data: clientsData } = useClients({ limit: 200 });
  const { data: sitesData } = useSites(
    clientId ? { client_id: clientId, limit: 200 } : { limit: 200 }
  );

  const clientOptions = (clientsData?.clients ?? []).map((c) => ({
    value: c.id,
    label: c.name,
  }));
  const siteOptions = (sitesData?.sites ?? []).map((s) => ({
    value: s.id,
    label: s.name,
  }));

  const canSubmit = clientId && siteId && title.trim();

  const reset = () => {
    setClientId('');
    setSiteId('');
    setTitle('');
    setBrief('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    const run = await createRun.mutateAsync({
      client_id: clientId,
      site_id: siteId,
      title: title.trim(),
      brief: brief.trim() || undefined,
    });
    reset();
    onOpenChange(false);
    if (run?.id) router.push(`/troubador/runs/${run.id}`);
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent size="lg">
        <ModalHeader>
          <ModalTitle>New Run</ModalTitle>
        </ModalHeader>
        <ModalBody>
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
              label="Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Run title"
            />
            <Textarea
              label="Brief"
              value={brief}
              rows={4}
              onChange={(e) => setBrief(e.target.value)}
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!canSubmit || createRun.isPending}>
                {createRun.isPending ? 'Creating…' : 'Create run'}
              </Button>
            </div>
          </form>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}

export default function TroubadorBoardPage() {
  const [showNewRun, setShowNewRun] = React.useState(false);
  const { data, isLoading, isError } = useTroubadorRuns({});

  const runsByStage = React.useMemo(() => {
    const buckets: Record<RunStage, Run[]> = {
      planning: [],
      topic_selection: [],
      researching: [],
      ready_for_interview: [],
      in_production: [],
      done: [],
      cancelled: [],
    };
    for (const run of data?.runs ?? []) {
      if (buckets[run.stage]) buckets[run.stage].push(run);
    }
    return buckets;
  }, [data]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-text-main">Troubador</h1>
          <p className="text-sm text-text-sub">Content runs across all clients</p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="secondary" size="sm">
            <Link href="/troubador/schedules">
              <ListChecks className="h-4 w-4" /> Schedules
            </Link>
          </Button>
          <Button asChild variant="secondary" size="sm">
            <Link href="/troubador/calendar">
              <CalendarDays className="h-4 w-4" /> Calendar
            </Link>
          </Button>
          <Button size="sm" onClick={() => setShowNewRun(true)}>
            <Plus className="h-4 w-4" /> New Run
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner size="md" />
        </div>
      ) : isError ? (
        <div className="text-center py-12 text-text-sub text-sm">
          Failed to load runs.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          {BOARD_STAGES.map((stage) => {
            const runs = runsByStage[stage.id];
            return (
              <div
                key={stage.id}
                className="rounded-lg bg-background-light p-3 min-h-[12rem]"
              >
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-text-sub">
                    {stage.title}
                  </h2>
                  <span className="text-xs px-1.5 py-0.5 rounded-full bg-surface text-text-sub font-medium">
                    {runs.length}
                  </span>
                </div>
                <div className="space-y-2">
                  {runs.length === 0 ? (
                    <p className="text-xs text-text-sub opacity-60">No runs</p>
                  ) : (
                    runs.map((run) => <RunCard key={run.id} run={run} />)
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <NewRunModal open={showNewRun} onOpenChange={setShowNewRun} />
    </div>
  );
}
