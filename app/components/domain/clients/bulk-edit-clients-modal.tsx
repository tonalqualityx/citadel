'use client';

import * as React from 'react';
import { useBulkUpdateClients, type BulkUpdateClientsInput } from '@/lib/hooks/use-clients';
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalBody } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { showToast } from '@/lib/hooks/use-toast';
import { useTerminology } from '@/lib/hooks/use-terminology';

interface BulkEditClientsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedIds: string[];
  onSuccess?: () => void;
  showHourlyRate?: boolean; // Only admins can edit hourly rate
}

const statusOptions = [
  { value: '', label: '-- No change --' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'delinquent', label: 'Delinquent' },
];

const typeOptions = [
  { value: '', label: '-- No change --' },
  { value: 'direct', label: 'Direct' },
  { value: 'agency_partner', label: 'Agency Partner' },
  { value: 'sub_client', label: 'Sub-Client' },
];

const retainerOptions = [
  { value: '', label: '-- No change --' },
  { value: 'clear', label: '-- Clear retainer --' },
  { value: 'set', label: 'Set retainer hours' },
];

const hourlyRateOptions = [
  { value: '', label: '-- No change --' },
  { value: 'clear', label: '-- Clear rate --' },
  { value: 'set', label: 'Set hourly rate' },
];

export function BulkEditClientsModal({
  open,
  onOpenChange,
  selectedIds,
  onSuccess,
  showHourlyRate = false,
}: BulkEditClientsModalProps) {
  const { t } = useTerminology();
  const bulkUpdate = useBulkUpdateClients();

  // Form state - undefined means "don't change"
  const [status, setStatus] = React.useState<string>('');
  const [type, setType] = React.useState<string>('');
  const [retainerAction, setRetainerAction] = React.useState<string>('');
  const [retainerValue, setRetainerValue] = React.useState<string>('');
  const [hourlyRateAction, setHourlyRateAction] = React.useState<string>('');
  const [hourlyRateValue, setHourlyRateValue] = React.useState<string>('');

  // Reset form when modal opens
  React.useEffect(() => {
    if (open) {
      setStatus('');
      setType('');
      setRetainerAction('');
      setRetainerValue('');
      setHourlyRateAction('');
      setHourlyRateValue('');
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Build update data - only include fields that have been changed
    const data: BulkUpdateClientsInput = {};

    if (status) {
      data.status = status as 'active' | 'inactive' | 'delinquent';
    }

    if (type) {
      data.type = type as 'direct' | 'agency_partner' | 'sub_client';
    }

    if (retainerAction === 'clear') {
      data.retainer_hours = null;
    } else if (retainerAction === 'set' && retainerValue) {
      const hours = parseFloat(retainerValue);
      if (!isNaN(hours) && hours >= 0) {
        data.retainer_hours = hours;
      }
    }

    if (hourlyRateAction === 'clear') {
      data.hourly_rate = null;
    } else if (hourlyRateAction === 'set' && hourlyRateValue) {
      const rate = parseFloat(hourlyRateValue);
      if (!isNaN(rate) && rate >= 0) {
        data.hourly_rate = rate;
      }
    }

    // Check if any changes were made
    if (Object.keys(data).length === 0) {
      showToast.error('No changes selected');
      return;
    }

    try {
      await bulkUpdate.mutateAsync({
        client_ids: selectedIds,
        data,
      });
      onOpenChange(false);
      onSuccess?.();
    } catch {
      // Error toast handled by hook
    }
  };

  const hasChanges =
    status ||
    type ||
    retainerAction === 'clear' ||
    (retainerAction === 'set' && retainerValue) ||
    hourlyRateAction === 'clear' ||
    (hourlyRateAction === 'set' && hourlyRateValue);

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent size="md">
        <ModalHeader>
          <ModalTitle>
            Bulk Edit {selectedIds.length} {t('clients')}
          </ModalTitle>
        </ModalHeader>
        <ModalBody>
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-sm text-text-sub mb-4">
              Only fields you change will be updated. Leave a field as &quot;No change&quot; to keep existing values.
            </p>

            <div>
              <label className="block text-sm font-medium text-text-main mb-1.5">
                Status
              </label>
              <Select
                options={statusOptions}
                value={status}
                onChange={setStatus}
                placeholder="-- No change --"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-main mb-1.5">
                Type
              </label>
              <Select
                options={typeOptions}
                value={type}
                onChange={setType}
                placeholder="-- No change --"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-main mb-1.5">
                Retainer Hours
              </label>
              <Select
                options={retainerOptions}
                value={retainerAction}
                onChange={setRetainerAction}
                placeholder="-- No change --"
              />
              {retainerAction === 'set' && (
                <div className="mt-2">
                  <Input
                    type="number"
                    min="0"
                    step="0.5"
                    value={retainerValue}
                    onChange={(e) => setRetainerValue(e.target.value)}
                    placeholder="Enter hours per month"
                  />
                </div>
              )}
            </div>

            {showHourlyRate && (
              <div>
                <label className="block text-sm font-medium text-text-main mb-1.5">
                  Hourly Rate
                </label>
                <Select
                  options={hourlyRateOptions}
                  value={hourlyRateAction}
                  onChange={setHourlyRateAction}
                  placeholder="-- No change --"
                />
                {hourlyRateAction === 'set' && (
                  <div className="mt-2">
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={hourlyRateValue}
                      onChange={(e) => setHourlyRateValue(e.target.value)}
                      placeholder="Enter hourly rate"
                    />
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-3 pt-4 border-t border-border-warm">
              <Button
                type="button"
                variant="secondary"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={bulkUpdate.isPending || !hasChanges}>
                {bulkUpdate.isPending && <Spinner size="sm" className="mr-2" />}
                Update {selectedIds.length} {t('clients')}
              </Button>
            </div>
          </form>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}
