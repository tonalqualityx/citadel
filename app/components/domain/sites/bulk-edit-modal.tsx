'use client';

import * as React from 'react';
import { useBulkUpdateSites, type BulkUpdateSitesInput } from '@/lib/hooks/use-sites';
import { useClients } from '@/lib/hooks/use-clients';
import { useUsers } from '@/lib/hooks/use-users';
import { useHostingPlans, useMaintenancePlans } from '@/lib/hooks/use-reference-data';
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalBody } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { showToast } from '@/lib/hooks/use-toast';
import { useTerminology } from '@/lib/hooks/use-terminology';

interface BulkEditSitesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedIds: string[];
  onSuccess?: () => void;
}

const hostedByOptions = [
  { value: 'indelible', label: 'Indelible' },
  { value: 'client', label: 'Client' },
  { value: 'other', label: 'Other' },
];

export function BulkEditSitesModal({
  open,
  onOpenChange,
  selectedIds,
  onSuccess,
}: BulkEditSitesModalProps) {
  const { t } = useTerminology();
  const bulkUpdate = useBulkUpdateSites();

  // Form state - undefined means "don't change", null means "clear value"
  const [clientId, setClientId] = React.useState<string | undefined>(undefined);
  const [hostedBy, setHostedBy] = React.useState<string | undefined>(undefined);
  const [hostingPlanId, setHostingPlanId] = React.useState<string | null | undefined>(undefined);
  const [maintenancePlanId, setMaintenancePlanId] = React.useState<string | null | undefined>(undefined);
  const [maintainerId, setMaintainerId] = React.useState<string | null | undefined>(undefined);

  // Fetch reference data
  const { data: clientsData } = useClients({ limit: 100, status: 'active' });
  const { data: usersData } = useUsers();
  const { data: hostingPlansData } = useHostingPlans();
  const { data: maintenancePlansData } = useMaintenancePlans();

  // Build options
  const clientOptions = React.useMemo(() => {
    const opts = (clientsData?.clients || []).map((c) => ({ value: c.id, label: c.name }));
    return [{ value: '', label: '-- No change --' }, ...opts];
  }, [clientsData?.clients]);

  const userOptions = React.useMemo(() => {
    const opts = (usersData?.users || []).map((u) => ({ value: u.id, label: u.name }));
    return [
      { value: '', label: '-- No change --' },
      { value: 'clear', label: '-- Clear maintainer --' },
      ...opts,
    ];
  }, [usersData?.users]);

  const hostingPlanOptions = React.useMemo(() => {
    const opts = (hostingPlansData?.hosting_plans || []).map((p) => ({
      value: p.id,
      label: `${p.name} ($${p.rate}/mo)`
    }));
    return [
      { value: '', label: '-- No change --' },
      { value: 'clear', label: '-- Clear hosting plan --' },
      ...opts,
    ];
  }, [hostingPlansData?.hosting_plans]);

  const maintenancePlanOptions = React.useMemo(() => {
    const opts = (maintenancePlansData?.maintenance_plans || []).map((p) => ({
      value: p.id,
      label: `${p.name} ($${p.rate}/mo)`
    }));
    return [
      { value: '', label: '-- No change --' },
      { value: 'clear', label: '-- Clear maintenance plan --' },
      ...opts,
    ];
  }, [maintenancePlansData?.maintenance_plans]);

  const hostedByOptionsWithNoChange = [
    { value: '', label: '-- No change --' },
    ...hostedByOptions,
  ];

  // Reset form when modal opens
  React.useEffect(() => {
    if (open) {
      setClientId(undefined);
      setHostedBy(undefined);
      setHostingPlanId(undefined);
      setMaintenancePlanId(undefined);
      setMaintainerId(undefined);
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Build update data - only include fields that have been changed
    const data: BulkUpdateSitesInput = {};

    if (clientId) {
      data.client_id = clientId;
    }

    if (hostedBy) {
      data.hosted_by = hostedBy as 'indelible' | 'client' | 'other';
    }

    if (hostingPlanId === 'clear') {
      data.hosting_plan_id = null;
    } else if (hostingPlanId) {
      data.hosting_plan_id = hostingPlanId;
    }

    if (maintenancePlanId === 'clear') {
      data.maintenance_plan_id = null;
    } else if (maintenancePlanId) {
      data.maintenance_plan_id = maintenancePlanId;
    }

    if (maintainerId === 'clear') {
      data.maintenance_assignee_id = null;
    } else if (maintainerId) {
      data.maintenance_assignee_id = maintainerId;
    }

    // Check if any changes were made
    if (Object.keys(data).length === 0) {
      showToast.error('No changes selected');
      return;
    }

    try {
      const result = await bulkUpdate.mutateAsync({
        site_ids: selectedIds,
        data,
      });
      showToast.success(`Updated ${result.updated} ${t('sites').toLowerCase()}`);
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      showToast.apiError(error, 'Failed to update sites');
    }
  };

  const hasChanges = clientId || hostedBy || hostingPlanId || maintenancePlanId || maintainerId;

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent size="md">
        <ModalHeader>
          <ModalTitle>
            Bulk Edit {selectedIds.length} {t('sites')}
          </ModalTitle>
        </ModalHeader>
        <ModalBody>
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-sm text-text-sub mb-4">
              Only fields you change will be updated. Leave a field as &quot;No change&quot; to keep existing values.
            </p>

            <div>
              <label className="block text-sm font-medium text-text-main mb-1.5">
                {t('client')}
              </label>
              <Select
                options={clientOptions}
                value={clientId || ''}
                onChange={(value) => setClientId(value || undefined)}
                placeholder="-- No change --"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-main mb-1.5">
                Maintainer
              </label>
              <Select
                options={userOptions}
                value={maintainerId === null ? 'clear' : maintainerId || ''}
                onChange={(value) => {
                  if (value === 'clear') {
                    setMaintainerId('clear');
                  } else if (value === '') {
                    setMaintainerId(undefined);
                  } else {
                    setMaintainerId(value);
                  }
                }}
                placeholder="-- No change --"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-main mb-1.5">
                Hosted By
              </label>
              <Select
                options={hostedByOptionsWithNoChange}
                value={hostedBy || ''}
                onChange={(value) => setHostedBy(value || undefined)}
                placeholder="-- No change --"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-main mb-1.5">
                Hosting Plan
              </label>
              <Select
                options={hostingPlanOptions}
                value={hostingPlanId === 'clear' ? 'clear' : hostingPlanId || ''}
                onChange={(value) => {
                  if (value === 'clear') {
                    setHostingPlanId('clear');
                  } else if (value === '') {
                    setHostingPlanId(undefined);
                  } else {
                    setHostingPlanId(value);
                  }
                }}
                placeholder="-- No change --"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-main mb-1.5">
                Maintenance Plan
              </label>
              <Select
                options={maintenancePlanOptions}
                value={maintenancePlanId === 'clear' ? 'clear' : maintenancePlanId || ''}
                onChange={(value) => {
                  if (value === 'clear') {
                    setMaintenancePlanId('clear');
                  } else if (value === '') {
                    setMaintenancePlanId(undefined);
                  } else {
                    setMaintenancePlanId(value);
                  }
                }}
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
                Update {selectedIds.length} {t('sites')}
              </Button>
            </div>
          </form>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}
