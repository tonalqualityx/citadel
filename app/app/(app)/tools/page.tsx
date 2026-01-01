'use client';

import * as React from 'react';
import { Plus, Pencil, Trash2, ExternalLink, Copy, Check } from 'lucide-react';
import { toast } from 'sonner';
import {
  useTools,
  useCreateTool,
  useUpdateTool,
  useDeleteTool,
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
import type { Tool, CreateToolInput } from '@/types/entities';
import { isValidUrl, getHostname } from '@/lib/utils/url';

export default function ToolsPage() {
  const [includeInactive, setIncludeInactive] = React.useState(true);
  const [isModalOpen, setIsModalOpen] = React.useState(false);
  const [editingItem, setEditingItem] = React.useState<Tool | null>(null);
  const [deleteConfirm, setDeleteConfirm] = React.useState<string | null>(null);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);

  const handleCopyLicense = async (id: string, licenseKey: string) => {
    try {
      await navigator.clipboard.writeText(licenseKey);
      setCopiedId(id);
      toast.success('License key copied to clipboard');
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      toast.error('Failed to copy license key');
    }
  };

  const { data, isLoading, error } = useTools(includeInactive);
  const createMutation = useCreateTool();
  const updateMutation = useUpdateTool();
  const deleteMutation = useDeleteTool();

  const [formData, setFormData] = React.useState<CreateToolInput>({
    name: '',
    category: '',
    url: '',
    description: '',
    license_key: '',
    is_active: true,
  });

  const tools = data?.tools || [];

  const openCreateModal = () => {
    setEditingItem(null);
    setFormData({
      name: '',
      category: '',
      url: '',
      description: '',
      license_key: '',
      is_active: true,
    });
    setIsModalOpen(true);
  };

  const openEditModal = (item: Tool) => {
    setEditingItem(item);
    setFormData({
      name: item.name,
      category: item.category || '',
      url: item.url || '',
      description: item.description || '',
      license_key: item.license_key || '',
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
              icon={<span className="text-4xl">🔨</span>}
              title="Error loading tools"
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
          <h1 className="text-2xl font-semibold text-text-main">Tools</h1>
          <p className="text-text-sub">Manage tools and resources used by the team</p>
        </div>
        <Button onClick={openCreateModal}>
          <Plus className="h-4 w-4 mr-2" />
          Add Tool
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
            Show inactive tools
          </label>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <SkeletonTable rows={5} columns={5} />
          ) : tools.length === 0 ? (
            <EmptyState
              icon={<span className="text-4xl">🔨</span>}
              title="No tools found"
              description="Get started by adding your first tool"
              action={
                <Button onClick={openCreateModal}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Tool
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
                    License
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-sub uppercase tracking-wider">
                    URL
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
                {tools.map((tool) => (
                  <tr key={tool.id} className="hover:bg-background-light/50">
                    <td className="px-4 py-3">
                      <div>
                        <span className="font-medium text-text-main">{tool.name}</span>
                        {tool.description && (
                          <p className="text-xs text-text-sub mt-0.5 truncate max-w-xs">
                            {tool.description}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {tool.license_key ? (
                        <button
                          onClick={() => handleCopyLicense(tool.id, tool.license_key!)}
                          className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-mono text-text-main bg-surface hover:bg-surface-alt border border-border-warm transition-colors group"
                          title="Click to copy license key"
                        >
                          <span className="truncate max-w-[120px]">
                            {tool.license_key.slice(0, 12)}...
                          </span>
                          {copiedId === tool.id ? (
                            <Check className="h-3.5 w-3.5 text-success" />
                          ) : (
                            <Copy className="h-3.5 w-3.5 text-text-sub group-hover:text-primary" />
                          )}
                        </button>
                      ) : (
                        <span className="text-sm text-text-sub">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isValidUrl(tool.url) ? (
                        <a
                          href={tool.url!}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {getHostname(tool.url)}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : tool.url ? (
                        <span className="text-sm text-text-sub">{tool.url}</span>
                      ) : (
                        <span className="text-sm text-text-sub">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={tool.is_active ? 'success' : 'default'}>
                        {tool.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={() => openEditModal(tool)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteConfirm(tool.id)}
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
              <ModalTitle>{editingItem ? 'Edit Tool' : 'Add Tool'}</ModalTitle>
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
                  <label className="block text-sm font-medium text-text-main mb-1">Category</label>
                  <Input
                    value={formData.category || ''}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    placeholder="e.g., Design, Development"
                    list="category-suggestions"
                  />
                  <datalist id="category-suggestions">
                    {data?.categories.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-main mb-1">URL</label>
                  <Input
                    type="url"
                    value={formData.url || ''}
                    onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                    placeholder="https://example.com"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-text-main mb-1">License Key</label>
                  <Input
                    value={formData.license_key || ''}
                    onChange={(e) => setFormData({ ...formData, license_key: e.target.value })}
                    placeholder="Enter license key or serial number"
                    className="font-mono"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-text-main mb-1">
                    Description
                  </label>
                  <textarea
                    value={formData.description || ''}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="w-full h-20 px-3 py-2 rounded-lg border border-border-warm bg-surface text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                    placeholder="Brief description of what this tool is used for..."
                  />
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
      <Modal open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <ModalContent>
          <ModalHeader>
            <ModalTitle>Delete Tool</ModalTitle>
          </ModalHeader>
          <ModalBody>
            <p className="text-text-sub">
              Are you sure you want to delete this tool? This action cannot be undone.
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
