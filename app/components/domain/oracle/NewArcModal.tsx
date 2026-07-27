'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
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
import { Spinner } from '@/components/ui/spinner';
import { ClientSelect } from '@/components/ui/inline-edit/client-select';
import { useCreateArc } from '@/lib/hooks/use-arcs';

interface NewArcModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Clarity Phase 3 (Seeing Stone Reckoning, spec Q4) — the New-arc button: starts a
// shapeless container with ZERO required structure beyond a name. The whole point is
// that Mike doesn't need to know the shape of the work yet — tasks/emails/an accord
// link/a client all accrete from INSIDE the arc workspace after it exists. On success,
// navigates straight into that workspace so items can be added immediately.
export function NewArcModal({ open, onOpenChange }: NewArcModalProps) {
  const [name, setName] = React.useState('');
  const [clientId, setClientId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const createArc = useCreateArc();
  const router = useRouter();

  React.useEffect(() => {
    if (!open) return;
    setName('');
    setClientId(null);
    setError(null);
    createArc.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open toggle
  }, [open]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Name is required');
      return;
    }
    setError(null);
    createArc.mutate(
      { name: trimmed, client_id: clientId },
      {
        onSuccess: (arc) => {
          onOpenChange(false);
          router.push(`/oracle/arcs/${arc.id}`);
        },
      }
    );
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent size="sm" data-testid="new-arc-modal">
        <form onSubmit={handleSubmit}>
          <ModalHeader>
            <ModalTitle>New arc</ModalTitle>
            <ModalDescription>
              Start a shapeless container — just a name. Add tasks, emails, or a client link once
              you&apos;re inside.
            </ModalDescription>
          </ModalHeader>
          <ModalBody className="flex flex-col gap-4">
            <div>
              <Input
                autoFocus
                label="Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. VCDP proposal follow-up"
                error={error ?? undefined}
                data-testid="new-arc-name-input"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-text-main">
                Client (optional)
              </label>
              <ClientSelect value={clientId} onChange={setClientId} placeholder="No client yet" />
            </div>
            {createArc.isError && (
              <p role="alert" className="text-sm text-[color:var(--error)]">
                {createArc.error instanceof Error ? createArc.error.message : 'Failed to create arc.'}
              </p>
            )}
          </ModalBody>
          <ModalFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createArc.isPending || !name.trim()} data-testid="new-arc-submit">
              {createArc.isPending ? (
                <>
                  <Spinner size="sm" className="mr-2" />
                  Creating…
                </>
              ) : (
                'Create arc'
              )}
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}
