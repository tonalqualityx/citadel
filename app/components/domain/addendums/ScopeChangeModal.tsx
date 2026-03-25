'use client';

import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalBody,
  ModalFooter,
} from '@/components/ui/modal';

interface ScopeChangeModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  accordId: string;
  onPrepareAddendum: () => void;
  onOverride: () => void;
}

export function ScopeChangeModal({
  isOpen,
  onClose,
  projectId: _projectId,
  accordId: _accordId,
  onPrepareAddendum,
  onOverride,
}: ScopeChangeModalProps) {
  return (
    <Modal open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <ModalContent size="sm">
        <ModalHeader>
          <ModalTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-status-warning" />
            Scope Locked
          </ModalTitle>
          <ModalDescription>
            This project is scope-locked because it is linked to an active accord. Adding tasks
            outside the original scope requires either a formal addendum or an override.
          </ModalDescription>
        </ModalHeader>
        <ModalBody>
          <p className="text-sm text-text-sub">
            An addendum will notify the client of the scope change and require their approval.
            An override will allow the task to be created without client approval, but the
            override will be logged.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              onOverride();
              onClose();
            }}
          >
            Override
          </Button>
          <Button
            onClick={() => {
              onPrepareAddendum();
              onClose();
            }}
          >
            Prepare Addendum
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
