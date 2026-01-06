'use client';

import * as React from 'react';
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalBody } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { SiteSelect } from '@/components/ui/inline-edit';
import { useUpdateSite } from '@/lib/hooks/use-sites';
import { showToast } from '@/lib/hooks/use-toast';

interface AddSiteModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  existingSiteIds: string[];
  onSuccess?: () => void;
}

export function AddSiteModal({
  open,
  onOpenChange,
  clientId,
  existingSiteIds,
  onSuccess,
}: AddSiteModalProps) {
  const [selectedSiteId, setSelectedSiteId] = React.useState<string | null>(null);
  const updateSite = useUpdateSite();

  // Reset selection when modal closes
  React.useEffect(() => {
    if (!open) {
      setSelectedSiteId(null);
    }
  }, [open]);

  const handleAdd = async () => {
    if (!selectedSiteId) return;

    try {
      await updateSite.mutateAsync({
        id: selectedSiteId,
        data: { client_id: clientId },
      });
      showToast.success('Site added to client');
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      showToast.apiError(error, 'Failed to add site');
    }
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent size="sm">
        <ModalHeader>
          <ModalTitle>Add Site to Client</ModalTitle>
        </ModalHeader>
        <ModalBody>
          <p className="text-sm text-text-sub mb-4">
            Select a site to assign to this client. Only sites not already assigned to this client are shown.
          </p>

          <div className="mb-6">
            <label className="block text-sm font-medium text-text-main mb-2">Site</label>
            <SiteSelect
              value={selectedSiteId}
              onChange={setSelectedSiteId}
              excludeIds={existingSiteIds}
              placeholder="Search for a site..."
              allowClear={false}
            />
          </div>

          <div className="flex justify-end gap-3">
            <Button
              variant="secondary"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleAdd}
              disabled={!selectedSiteId || updateSite.isPending}
            >
              {updateSite.isPending ? (
                <>
                  <Spinner size="sm" className="mr-2" />
                  Adding...
                </>
              ) : (
                'Add Site'
              )}
            </Button>
          </div>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}
