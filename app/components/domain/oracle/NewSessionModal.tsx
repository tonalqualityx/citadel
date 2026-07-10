'use client';

import * as React from 'react';
import { z } from 'zod';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalBody,
  ModalFooter,
} from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { useCreateOracleCommand } from '@/lib/hooks/use-oracle';
import { distinctSessionCwds } from './oracle-logic';
import type { OracleMachineDTO } from '@/lib/types/oracle';

interface NewSessionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  machines: OracleMachineDTO[];
}

// Client-side mirror of the server's spawnPayloadSchema
// (app/api/oracle/commands/route.ts) — a friendliness check only. The server
// re-validates and re-enforces the verb allowlist regardless of what passes here;
// this never IS the security boundary (see spec Phase 1.5b invariants).
const newSessionSchema = z.object({
  machine: z.string().min(1, 'Pick a machine'),
  cwd: z.string().trim().min(1, 'Working directory is required').max(1024, 'Too long (max 1024 chars)'),
  title: z.string().max(256, 'Too long (max 256 chars)').optional(),
  prompt: z.string().max(10240, 'Too long (max 10KB)').optional(),
});

const CWD_DATALIST_ID = 'oracle-new-session-cwd-options';

export function NewSessionModal({ open, onOpenChange, machines }: NewSessionModalProps) {
  const [machine, setMachine] = React.useState('');
  const [cwd, setCwd] = React.useState('');
  const [title, setTitle] = React.useState('');
  const [prompt, setPrompt] = React.useState('');
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  const createCommand = useCreateOracleCommand();
  const cwdOptions = React.useMemo(() => distinctSessionCwds(machines), [machines]);
  const machineOptions = React.useMemo(
    () => machines.map((m) => ({ value: m.name, label: m.name })),
    [machines]
  );

  // Reset the form and preselect the machine (only candidate if there's exactly
  // one) every time the modal opens; also clears any error from a prior attempt.
  React.useEffect(() => {
    if (!open) return;
    setMachine(machines.length === 1 ? machines[0].name : '');
    setCwd('');
    setTitle('');
    setPrompt('');
    setFieldErrors({});
    createCommand.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open toggle, not every machines/createCommand identity change
  }, [open]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();

    const result = newSessionSchema.safeParse({
      machine,
      cwd,
      title: title.trim() || undefined,
      prompt: prompt.trim() || undefined,
    });

    if (!result.success) {
      const errors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const key = issue.path[0];
        if (typeof key === 'string' && !errors[key]) errors[key] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});
    createCommand.mutate(
      {
        machine: result.data.machine,
        verb: 'spawn_session',
        payload: {
          cwd: result.data.cwd,
          ...(result.data.title ? { title: result.data.title } : {}),
          ...(result.data.prompt ? { prompt: result.data.prompt } : {}),
        },
      },
      { onSuccess: () => onOpenChange(false) }
    );
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent
        size="md"
        className={
          // Mobile: full-screen sheet rather than a centered dialog (spec 1.5b).
          'max-sm:inset-0 max-sm:top-0 max-sm:left-0 max-sm:h-dvh max-sm:max-h-dvh ' +
          'max-sm:w-screen max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none'
        }
        data-testid="new-session-modal"
      >
        <form onSubmit={handleSubmit} className="flex h-full flex-col">
          <ModalHeader>
            <ModalTitle>New session</ModalTitle>
            <ModalDescription>
              Queues a spawn_session command. The dispatcher on the target machine picks it up
              within about a minute and starts a new Claude Code session in tmux with remote
              control on.
            </ModalDescription>
          </ModalHeader>
          <ModalBody className="flex flex-1 flex-col gap-4 overflow-auto">
            <div>
              <Select
                label="Machine"
                value={machine}
                onChange={setMachine}
                options={machineOptions}
                placeholder={machines.length === 0 ? 'No machines reporting' : 'Select a machine…'}
                disabled={machines.length === 0}
              />
              {fieldErrors.machine && (
                <p className="mt-1 text-sm text-[color:var(--error)]">{fieldErrors.machine}</p>
              )}
            </div>

            <div>
              <Input
                label="Working directory"
                value={cwd}
                onChange={(e) => setCwd(e.target.value)}
                placeholder="/home/mike/.openclaw/workspace/citadel"
                list={CWD_DATALIST_ID}
                error={fieldErrors.cwd}
                className="ui-monospace"
              />
              <datalist id={CWD_DATALIST_ID}>
                {cwdOptions.map((path) => (
                  <option key={path} value={path} />
                ))}
              </datalist>
            </div>

            <Input
              label="Title (optional)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. quick fix — mailer bug"
              error={fieldErrors.title}
            />

            <Textarea
              label="Prompt (optional)"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Passed as a single argv element to claude — never a shell string."
              error={fieldErrors.prompt}
              rows={4}
            />

            {createCommand.isError && (
              <p role="alert" className="text-sm text-[color:var(--error)]">
                {createCommand.error instanceof Error
                  ? createCommand.error.message
                  : 'Failed to queue the spawn command.'}
              </p>
            )}
          </ModalBody>
          <ModalFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              className="min-h-11 sm:min-h-0"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createCommand.isPending || machines.length === 0}
              className="min-h-11 sm:min-h-0"
            >
              {createCommand.isPending ? (
                <>
                  <Spinner size="sm" className="mr-2" />
                  Queuing…
                </>
              ) : (
                'Queue session'
              )}
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}
