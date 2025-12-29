'use client';

import * as React from 'react';
import { Plus, Pencil, Trash2, GripVertical } from 'lucide-react';
import {
  useFunctions,
  useCreateFunction,
  useUpdateFunction,
  useDeleteFunction,
} from '@/lib/hooks/use-reference-data';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
import type { TeamFunction, CreateFunctionInput } from '@/types/entities';

export default function FunctionsAdminPage() {
  const [includeInactive, setIncludeInactive] = React.useState(true);
  const [isModalOpen, setIsModalOpen] = React.useState(false);
  const [editingItem, setEditingItem] = React.useState<TeamFunction | null>(null);
  const [deleteConfirm, setDeleteConfirm] = React.useState<string | null>(null);

  const { data, isLoading, error } = useFunctions(includeInactive);
  const createMutation = useCreateFunction();
  const updateMutation = useUpdateFunction();
  const deleteMutation = useDeleteFunction();

  const [formData, setFormData] = React.useState<CreateFunctionInput>({
    name: '',
    primary_focus: '',
    sort_order: 0,
    is_active: true,
  });

  const openCreateModal = () => {
    setEditingItem(null);
    setFormData({ name: '', primary_focus: '', sort_order: 0, is_active: true });
    setIsModalOpen(true);
  };

  const openEditModal = (item: TeamFunction) => {
    setEditingItem(item);
    setFormData({
      name: item.name,
      primary_focus: item.primary_focus || '',
      sort_order: item.sort_order,
      is_active: item.is_active,
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
      await deleteMutation.mutateAsync(id);
      setDeleteConfirm(null);
    } catch (err) {
      console.error('Failed to delete:', err);
    }
  };

  if (error) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-8">
            <EmptyState
              icon={<span className="text-4xl">💼</span>}
              title="Error loading functions"
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
          <h1 className="text-2xl font-semibold text-text-main">Team Functions</h1>
          <p className="text-text-sub">Manage team roles and their primary responsibilities</p>
        </div>
        <Button onClick={openCreateModal}>
          <Plus className="h-4 w-4 mr-2" />
          Add Function
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
            Show inactive functions
          </label>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <SkeletonTable rows={5} columns={4} />
          ) : data?.functions.length === 0 ? (
            <EmptyState
              icon={<span className="text-4xl">💼</span>}
              title="No functions found"
              description="Get started by adding your first team function"
              action={
                <Button onClick={openCreateModal}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Function
                </Button>
              }
            />
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-border-warm bg-background-light">
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-sub uppercase tracking-wider w-12">
                    Order
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-sub uppercase tracking-wider">
                    Name
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-sub uppercase tracking-wider">
                    Primary Focus
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-sub uppercase tracking-wider w-24">
                    Status
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-text-sub uppercase tracking-wider w-24">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-warm">
                {data?.functions.map((fn) => (
                  <tr key={fn.id} className="hover:bg-background-light/50">
                    <td className="px-4 py-3">
                      <span className="text-sm text-text-sub">{fn.sort_order}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-medium text-text-main">{fn.name}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-text-sub">{fn.primary_focus || '-'}</span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={fn.is_active ? 'success' : 'default'}>
                        {fn.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={() => openEditModal(fn)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteConfirm(fn.id)}
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
        <ModalContent>
          <form onSubmit={handleSubmit}>
            <ModalHeader>
              <ModalTitle>{editingItem ? 'Edit Function' : 'Add Function'}</ModalTitle>
            </ModalHeader>
            <ModalBody className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-main mb-1">Name *</label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-main mb-1">
                  Primary Focus
                </label>
                <Input
                  value={formData.primary_focus || ''}
                  onChange={(e) => setFormData({ ...formData, primary_focus: e.target.value })}
                  placeholder="What does this role focus on?"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-main mb-1">Sort Order</label>
                <Input
                  type="number"
                  value={formData.sort_order}
                  onChange={(e) =>
                    setFormData({ ...formData, sort_order: parseInt(e.target.value) || 0 })
                  }
                  min={0}
                />
              </div>
              <div>
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
      <Modal open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <ModalContent>
          <ModalHeader>
            <ModalTitle>Delete Function</ModalTitle>
          </ModalHeader>
          <ModalBody>
            <p className="text-text-sub">
              Are you sure you want to delete this function? This action cannot be undone.
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" onClick={() => setDeleteConfirm(null)}>
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
