'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal, ModalBody, ModalContent, ModalDescription, ModalFooter, ModalHeader, ModalTitle } from '@/components/ui/modal';
import { apiClient } from '@/lib/api/client';
import { showToast } from '@/lib/hooks/use-toast';
import { designKeys } from '@/lib/hooks/use-design';

export interface BudgetDialogProps {
  sessionId: string;
  currentBudget: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Client-side check; the server repeats it (400 not_a_raise) and enforces the cap (403 raise_cap). */
export function validateRaise(value: string, current: number): string | null {
  const n = Number(value);
  if (!value.trim() || !Number.isFinite(n)) return 'Enter a dollar amount.';
  if (Math.round(n * 100) <= Math.round(current * 100)) return `A raise has to be above the current $${current.toFixed(2)}.`;
  return null;
}

export function BudgetDialog({ sessionId, currentBudget, open, onOpenChange }: BudgetDialogProps) {
  const queryClient = useQueryClient();
  const [value, setValue] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setValue((Math.floor(currentBudget) + 5).toString());
      setError(null);
    }
  }, [open, currentBudget]);

  const raise = useMutation({
    mutationFn: (budget: number) => apiClient.post(`/design/sessions/${sessionId}/budget`, { budget_usd: budget }),
    onSuccess: () => {
      showToast.success('Budget raised');
      queryClient.invalidateQueries({ queryKey: designKeys.all });
      onOpenChange(false);
    },
    // 400 not_a_raise and 403 raise_cap arrive with their reason as the message.
    onError: (e) => setError(e instanceof Error && e.message ? e.message : 'Could not raise the budget.'),
  });

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    const problem = validateRaise(value, currentBudget);
    setError(problem);
    if (!problem) raise.mutate(Math.round(Number(value) * 100) / 100);
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent size="sm">
        <form onSubmit={submit}>
          <ModalHeader>
            <ModalTitle>Raise budget</ModalTitle>
            <ModalDescription>The ceiling is ${currentBudget.toFixed(2)} now. Work pauses when spending reaches it.</ModalDescription>
          </ModalHeader>
          <ModalBody>
            <Input label="New ceiling (USD)" type="number" inputMode="decimal" min={0} step="1" value={value} onChange={(e) => setValue(e.target.value)} />
            {error && <p role="alert" className="mt-2 text-sm" style={{ color: 'var(--error)' }}>{error}</p>}
          </ModalBody>
          <ModalFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={raise.isPending}>{raise.isPending ? 'Raising...' : 'Raise'}</Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}
