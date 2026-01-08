'use client';

import * as React from 'react';
import { Plus, Pencil, Trash2, X } from 'lucide-react';
import {
  useMaintenancePlans,
  useCreateMaintenancePlan,
  useUpdateMaintenancePlan,
  useDeleteMaintenancePlan,
} from '@/lib/hooks/use-reference-data';
import { SopMultiSelect } from '@/components/ui/inline-edit/sop-multi-select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonTable } from '@/components/ui/skeleton';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalBody,
  ModalFooter,
} from '@/components/ui/modal';
import type { MaintenancePlan, CreateMaintenancePlanInput, MaintenanceFrequency } from '@/types/entities';

const FREQUENCY_OPTIONS: { value: MaintenanceFrequency; label: string }[] = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'bi_monthly', label: 'Bi-Monthly (every 2 months)' },
  { value: 'quarterly', label: 'Quarterly (every 3 months)' },
  { value: 'semi_annually', label: 'Semi-Annually (every 6 months)' },
  { value: 'annually', label: 'Annually' },
];

function getFrequencyLabel(frequency: MaintenanceFrequency): string {
  return FREQUENCY_OPTIONS.find(f => f.value === frequency)?.label || frequency;
}

function formatCurrency(value: number | null): string {
  if (value === null) return '-';
  return `$${value.toFixed(2)}`;
}

export default function MaintenancePlansAdminPage() {
  const [includeInactive, setIncludeInactive] = React.useState(true);
  const [isModalOpen, setIsModalOpen] = React.useState(false);
  const [editingItem, setEditingItem] = React.useState<MaintenancePlan | null>(null);
  const [deleteConfirm, setDeleteConfirm] = React.useState<string | null>(null);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);

  const { data, isLoading, error } = useMaintenancePlans(includeInactive);
  const createMutation = useCreateMaintenancePlan();
  const updateMutation = useUpdateMaintenancePlan();
  const deleteMutation = useDeleteMaintenancePlan();

  const [formData, setFormData] = React.useState<CreateMaintenancePlanInput & { sop_ids: string[] }>({
    name: '',
    rate: 0,
    agency_rate: null,
    hours: null,
    details: '',
    frequency: 'monthly',
    is_active: true,
    sop_ids: [],
  });

  const openCreateModal = () => {
    setEditingItem(null);
    setFormData({
      name: '',
      rate: 0,
      agency_rate: null,
      hours: null,
      details: '',
      frequency: 'monthly',
      is_active: true,
      sop_ids: [],
    });
    setIsModalOpen(true);
  };

  const openEditModal = (item: MaintenancePlan) => {
    setEditingItem(item);
    setFormData({
      name: item.name,
      rate: item.rate,
      agency_rate: item.agency_rate,
      hours: item.hours,
      details: item.details || '',
      frequency: item.frequency,
      is_active: item.is_active,
      sop_ids: item.sop_ids || [],
    });
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingItem) {
        await updateMutation.mutateAsync({ id: editingItem.id, data: formData });
      } else {
        await createMutation.mutateAsync(formData);
      }
      setIsModalOpen(false);
    } catch (err) {
      console.error('Failed to save:', err);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      setDeleteError(null);
      await deleteMutation.mutateAsync(id);
      setDeleteConfirm(null);
    } catch (err: any) {
      setDeleteError(err.message || 'Failed to delete');
    }
  };

  const handleInlineSopUpdate = async (planId: string, sopIds: string[]) => {
    try {
      await updateMutation.mutateAsync({ id: planId, data: { sop_ids: sopIds } });
    } catch (err) {
      console.error('Failed to update SOPs:', err);
    }
  };

  if (error) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-8">
            <EmptyState
              icon={<span className="text-4xl">🔧</span>}
              title="Error loading maintenance plans"
              description="There was a problem loading the data. Please try again."
              action={<Button onClick={() => window.location.reload()}>Retry</Button>}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text-main">Maintenance Plans</h1>
          <p className="text-text-sub">Manage maintenance plan tiers and pricing</p>
        </div>
        <Button onClick={openCreateModal}>
          <Plus className="h-4 w-4 mr-2" />
          Add Plan
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="py-4">
          <label className="flex items-center gap-2 text-sm text-text-main cursor-pointer">
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(e) => setIncludeInactive(e.target.checked)}
              className="h-4 w-4 rounded border-border-warm text-primary focus:ring-primary"
            />
            Show inactive plans
          </label>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <SkeletonTable rows={5} columns={8} />
          ) : data?.maintenance_plans.length === 0 ? (
            <EmptyState
              icon={<span className="text-4xl">🔧</span>}
              title="No maintenance plans found"
              description="Get started by adding your first maintenance plan"
              action={
                <Button onClick={openCreateModal}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Plan
                </Button>
              }
            />
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-border-warm bg-background-light">
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-sub uppercase tracking-wider">
                    Name
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-sub uppercase tracking-wider">
                    Frequency
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-text-sub uppercase tracking-wider">
                    Rate
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-text-sub uppercase tracking-wider">
                    Hours
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-text-sub uppercase tracking-wider w-20">
                    Sites
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-text-sub uppercase tracking-wider w-20">
                    SOPs
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-sub uppercase tracking-wider w-24">
                    Status
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-text-sub uppercase tracking-wider w-32">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-warm">
                {data?.maintenance_plans.map((plan) => (
                  <tr key={plan.id} className="hover:bg-background-light/50">
                    <td className="px-4 py-3">
                      <span className="font-medium text-text-main">{plan.name}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-text-sub">{getFrequencyLabel(plan.frequency)}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-sm text-text-main">{formatCurrency(plan.rate)}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-sm text-text-sub">
                        {plan.hours ? `${plan.hours}h` : '-'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-sm text-text-sub">{plan.sites_count || 0}</span>
                    </td>
                    <td className="px-4 py-3">
                      <SopMultiSelect
                        value={plan.sop_ids || []}
                        onChange={(sopIds) => handleInlineSopUpdate(plan.id, sopIds)}
                        placeholder="Select SOPs..."
                      />
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={plan.is_active ? 'success' : 'default'}>
                        {plan.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={() => openEditModal(plan)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteConfirm(plan.id)}
                          className="text-red-500 hover:text-red-700"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Modal */}
      <Modal open={isModalOpen} onOpenChange={setIsModalOpen}>
        <ModalContent size="lg">
          <form onSubmit={handleSubmit}>
            <ModalHeader>
              <ModalTitle>
                {editingItem ? 'Edit Maintenance Plan' : 'Add Maintenance Plan'}
              </ModalTitle>
            </ModalHeader>
            <ModalBody className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-text-main mb-1">Name *</label>
                  <Input
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-main mb-1">
                    Client Rate *
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    value={formData.rate}
                    onChange={(e) =>
                      setFormData({ ...formData, rate: parseFloat(e.target.value) || 0 })
                    }
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-main mb-1">
                    Agency Rate
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    value={formData.agency_rate ?? ''}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        agency_rate: e.target.value ? parseFloat(e.target.value) : null,
                      })
                    }
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-main mb-1">
                    Included Hours
                  </label>
                  <Input
                    type="number"
                    step="0.5"
                    value={formData.hours ?? ''}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        hours: e.target.value ? parseFloat(e.target.value) : null,
                      })
                    }
                    placeholder="e.g., 2.5"
                  />
                </div>
                <div className="col-span-2">
                  <Select
                    label="Frequency *"
                    options={FREQUENCY_OPTIONS}
                    value={formData.frequency || 'monthly'}
                    onChange={(value) =>
                      setFormData({ ...formData, frequency: value as MaintenanceFrequency })
                    }
                  />
                  <p className="mt-1 text-xs text-text-sub">
                    How often maintenance tasks should be generated for sites using this plan
                  </p>
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-text-main mb-1">Details</label>
                  <textarea
                    value={formData.details || ''}
                    onChange={(e) => setFormData({ ...formData, details: e.target.value })}
                    className="w-full h-20 px-3 py-2 rounded-lg border border-border-warm bg-surface text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                    placeholder="Additional details about this plan..."
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-text-main mb-1">SOPs</label>
                  <SopMultiSelect
                    value={formData.sop_ids}
                    onChange={(sopIds) => setFormData({ ...formData, sop_ids: sopIds })}
                    placeholder="Select SOPs for this plan..."
                    className="w-full"
                    variant="input"
                  />
                  <p className="mt-1 text-xs text-text-sub">
                    Each selected SOP will become a task when maintenance is generated
                  </p>
                </div>
                <div className="col-span-2">
                  <label className="flex items-center gap-2 text-sm text-text-main cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.is_active}
                      onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                      className="h-4 w-4 rounded border-border-warm text-primary focus:ring-primary"
                    />
                    Active
                  </label>
                </div>
              </div>
            </ModalBody>
            <ModalFooter>
              <Button type="button" variant="ghost" onClick={() => setIsModalOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createMutation.isPending || updateMutation.isPending}
              >
                {createMutation.isPending || updateMutation.isPending ? 'Saving...' : 'Save'}
              </Button>
            </ModalFooter>
          </form>
        </ModalContent>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal open={!!deleteConfirm} onOpenChange={() => { setDeleteConfirm(null); setDeleteError(null); }}>
        <ModalContent>
          <ModalHeader>
            <ModalTitle>Delete Maintenance Plan</ModalTitle>
          </ModalHeader>
          <ModalBody>
            <p className="text-text-sub">
              Are you sure you want to delete this maintenance plan? This action cannot be undone.
            </p>
            {deleteError && (
              <p className="mt-2 text-sm text-red-500">{deleteError}</p>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" onClick={() => { setDeleteConfirm(null); setDeleteError(null); }}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirm && handleDelete(deleteConfirm)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
