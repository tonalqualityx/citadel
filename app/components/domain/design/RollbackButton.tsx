'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Modal, ModalBody, ModalContent, ModalDescription, ModalFooter, ModalHeader, ModalTitle } from '@/components/ui/modal';
import { useRollbackPublish } from '@/lib/hooks/use-design-publish';

/** Admin or the publisher, and only when the server says this is the site's latest successful publish. */
export function showRollback(p: { canRollback: boolean; isAdmin: boolean; isPublisher: boolean }): boolean {
  return p.canRollback && (p.isAdmin || p.isPublisher);
}

export interface RollbackButtonProps {
  publishId: string;
  /** GET /publishes/:id `can_rollback`. */
  canRollback: boolean;
  isAdmin: boolean;
  isPublisher: boolean;
  /** The target in the same words the publish was confirmed with ("the LIVE production site at vcdp.org"). */
  targetWords: string;
  onRolledBack?: (rollbackPublishId: string) => void;
}

export function RollbackButton({ publishId, canRollback, isAdmin, isPublisher, targetWords, onRolledBack }: RollbackButtonProps) {
  const [open, setOpen] = React.useState(false);
  const rollback = useRollbackPublish(publishId);
  if (!showRollback({ canRollback, isAdmin, isPublisher })) return null;
  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>Roll back</Button>
      <Modal open={open} onOpenChange={setOpen}>
        <ModalContent size="md">
          <ModalHeader>
            <ModalTitle>Roll back this publish</ModalTitle>
            <ModalDescription>
              This puts {targetWords} back to how it was before this publish. It runs as a new publish; nothing is deleted.
            </ModalDescription>
          </ModalHeader>
          <ModalBody />
          <ModalFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              type="button"
              variant="destructive"
              disabled={rollback.isPending}
              onClick={() =>
                rollback.mutate(undefined, {
                  onSuccess: (r) => {
                    setOpen(false);
                    onRolledBack?.(r.publish_id);
                  },
                })
              }
            >
              {rollback.isPending ? 'Rolling back...' : `Roll back ${targetWords}`}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}
