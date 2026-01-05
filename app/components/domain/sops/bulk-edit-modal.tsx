'use client';

import * as React from 'react';
import { useBulkUpdateSops, type BulkUpdateSopsInput } from '@/lib/hooks/use-sops';
import { useFunctions } from '@/lib/hooks/use-reference-data';
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalBody } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { showToast } from '@/lib/hooks/use-toast';
import { useTerminology } from '@/lib/hooks/use-terminology';

interface BulkEditSopsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedIds: string[];
  onSuccess?: () => void;
}

const statusOptions = [
  { value: '', label: '-- No change --' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive (Draft)' },
];

const batteryImpactOptions = [
  { value: '', label: '-- No change --' },
  { value: 'average_drain', label: 'Average Drain' },
  { value: 'high_drain', label: 'High Drain' },
  { value: 'energizing', label: 'Energizing' },
];

const energyEstimateOptions = [
  { value: '', label: '-- No change --' },
  { value: 'clear', label: '-- Clear estimate --' },
  { value: '1', label: '1 - Quick task (15 min)' },
  { value: '2', label: '2 - Small task (30 min)' },
  { value: '3', label: '3 - Medium task (1 hr)' },
  { value: '4', label: '4 - Standard task (2 hrs)' },
  { value: '5', label: '5 - Large task (4 hrs)' },
  { value: '6', label: '6 - Half day (4-6 hrs)' },
  { value: '7', label: '7 - Full day (6-8 hrs)' },
  { value: '8', label: '8 - Multi-day (8+ hrs)' },
];

export function BulkEditSopsModal({
  open,
  onOpenChange,
  selectedIds,
  onSuccess,
}: BulkEditSopsModalProps) {
  const { t } = useTerminology();
  const bulkUpdate = useBulkUpdateSops();

  // Form state - undefined means "don't change"
  const [status, setStatus] = React.useState<string>('');
  const [functionId, setFunctionId] = React.useState<string>('');
  const [energyEstimate, setEnergyEstimate] = React.useState<string>('');
  const [batteryImpact, setBatteryImpact] = React.useState<string>('');

  // Fetch functions for dropdown
  const { data: functionsData } = useFunctions();

  // Build function options
  const functionOptions = React.useMemo(() => {
    const opts = (functionsData?.functions || []).map((f) => ({
      value: f.id,
      label: f.name,
    }));
    return [
      { value: '', label: '-- No change --' },
      { value: 'clear', label: '-- Clear function --' },
      ...opts,
    ];
  }, [functionsData?.functions]);

  // Reset form when modal opens
  React.useEffect(() => {
    if (open) {
      setStatus('');
      setFunctionId('');
      setEnergyEstimate('');
      setBatteryImpact('');
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Build update data - only include fields that have been changed
    const data: BulkUpdateSopsInput = {};

    if (status === 'active') {
      data.is_active = true;
    } else if (status === 'inactive') {
      data.is_active = false;
    }

    if (functionId === 'clear') {
      data.function_id = null;
    } else if (functionId) {
      data.function_id = functionId;
    }

    if (energyEstimate === 'clear') {
      data.energy_estimate = null;
    } else if (energyEstimate) {
      data.energy_estimate = parseInt(energyEstimate, 10);
    }

    if (batteryImpact) {
      data.battery_impact = batteryImpact as BulkUpdateSopsInput['battery_impact'];
    }

    // Check if any changes were made
    if (Object.keys(data).length === 0) {
      showToast.error('No changes selected');
      return;
    }

    try {
      const result = await bulkUpdate.mutateAsync({
        sop_ids: selectedIds,
        data,
      });
      showToast.success(`Updated ${result.updated} ${t('sops').toLowerCase()}`);
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      showToast.apiError(error, 'Failed to update SOPs');
    }
  };

  const hasChanges = status || functionId || energyEstimate || batteryImpact;

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent size="md">
        <ModalHeader>
          <ModalTitle>
            Bulk Edit {selectedIds.length} {t('sops')}
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
                onChange={(value) => setStatus(value)}
                placeholder="-- No change --"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-main mb-1.5">
                Function
              </label>
              <Select
                options={functionOptions}
                value={functionId}
                onChange={(value) => setFunctionId(value)}
                placeholder="-- No change --"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-main mb-1.5">
                Energy Estimate
              </label>
              <Select
                options={energyEstimateOptions}
                value={energyEstimate}
                onChange={(value) => setEnergyEstimate(value)}
                placeholder="-- No change --"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-main mb-1.5">
                Battery Impact
              </label>
              <Select
                options={batteryImpactOptions}
                value={batteryImpact}
                onChange={(value) => setBatteryImpact(value)}
                placeholder="-- No change --"
              />
            </div>

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
                Update {selectedIds.length} {t('sops')}
              </Button>
            </div>
          </form>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}
