'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Globe, Pencil, Trash2, X } from 'lucide-react';
import { useSites, useUpdateSite, useBulkDeleteSites } from '@/lib/hooks/use-sites';
import { useTerminology } from '@/lib/hooks/use-terminology';
import { useAuth } from '@/lib/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable, Column } from '@/components/ui/data-table';
import { SearchInput } from '@/components/ui/search-input';
import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonTable } from '@/components/ui/skeleton';
import { InlineUserSelect } from '@/components/ui/user-select';
import { ClientSelect } from '@/components/ui/inline-edit';
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalBody } from '@/components/ui/modal';
import { SiteForm } from '@/components/domain/site-form';
import { BulkEditSitesModal } from '@/components/domain/sites/bulk-edit-modal';
import { showToast } from '@/lib/hooks/use-toast';

interface Site {
  id: string;
  name: string;
  url: string | null;
  client?: { id: string; name: string } | null;
  maintenance_assignee_id: string | null;
  maintenance_assignee?: { id: string; name: string; email: string } | null;
}

export default function SitesPage() {
  const router = useRouter();
  const { t } = useTerminology();
  const { isAdmin } = useAuth();
  const [search, setSearch] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [isCreateOpen, setIsCreateOpen] = React.useState(false);
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const [isBulkEditOpen, setIsBulkEditOpen] = React.useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = React.useState(false);

  const { data, isLoading, error } = useSites({ page, search: search || undefined });
  const updateSite = useUpdateSite();
  const bulkDelete = useBulkDeleteSites();

  // Clear selection when page or search changes
  React.useEffect(() => {
    setSelectedIds([]);
  }, [page, search]);

  const handleAssigneeChange = (siteId: string, assigneeId: string | null) => {
    updateSite.mutate({ id: siteId, data: { maintenance_assignee_id: assigneeId } });
  };

  const handleClientChange = (siteId: string, clientId: string | null) => {
    updateSite.mutate({ id: siteId, data: { client_id: clientId } });
  };

  const handleCreateSuccess = () => {
    setIsCreateOpen(false);
  };

  const handleBulkEditSuccess = () => {
    setSelectedIds([]);
  };

  const handleBulkDelete = async () => {
    try {
      const result = await bulkDelete.mutateAsync(selectedIds);
      showToast.success(`Deleted ${result.deleted} ${t('sites').toLowerCase()}`);
      setSelectedIds([]);
      setIsDeleteConfirmOpen(false);
    } catch (error) {
      showToast.apiError(error, 'Failed to delete sites');
    }
  };

  const columns: Column<Site>[] = [
    {
      key: 'name',
      header: 'Name',
      cell: (site) => (
        <div>
          <div className="font-medium text-text-main">{site.name}</div>
          {site.url && (
            <a href={site.url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline">
              {site.url}
            </a>
          )}
        </div>
      ),
    },
    {
      key: 'client',
      header: t('client'),
      cell: (site) => (
        <div onClick={(e) => e.stopPropagation()}>
          <ClientSelect
            value={site.client?.id || null}
            onChange={(value) => handleClientChange(site.id, value)}
            placeholder="No client"
          />
        </div>
      ),
    },
    {
      key: 'maintenance_assignee',
      header: 'Maintainer',
      cell: (site) => (
        <div onClick={(e) => e.stopPropagation()}>
          <InlineUserSelect
            value={site.maintenance_assignee_id}
            onChange={(value) => handleAssigneeChange(site.id, value)}
            displayValue={site.maintenance_assignee?.name}
            placeholder="Unassigned"
          />
        </div>
      ),
    },
  ];

  const handleRowClick = (site: Site) => {
    router.push(`/sites/${site.id}`);
  };

  if (error) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-8">
            <EmptyState
              icon={<Globe className="h-12 w-12" />}
              title={`Error loading ${t('sites').toLowerCase()}`}
              description="There was a problem loading the list."
              action={<Button onClick={() => window.location.reload()}>Retry</Button>}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text-main">{t('sites')}</h1>
          <p className="text-text-sub">Manage websites and web properties</p>
        </div>
        <Button onClick={() => setIsCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          New {t('site')}
        </Button>
      </div>

      <Card>
        <CardContent className="py-4">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder={`Search ${t('sites').toLowerCase()}...`}
            className="md:w-64"
          />
        </CardContent>
      </Card>

      {/* Bulk Action Toolbar */}
      {selectedIds.length > 0 && (
        <div className="flex items-center gap-3 p-3 bg-primary/10 border border-primary/20 rounded-lg">
          <span className="text-sm font-medium text-text-main">
            {selectedIds.length} {t('sites').toLowerCase()} selected
          </span>
          <div className="flex-1" />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setIsBulkEditOpen(true)}
          >
            <Pencil className="h-4 w-4 mr-1.5" />
            Edit
          </Button>
          {isAdmin && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setIsDeleteConfirmOpen(true)}
            >
              <Trash2 className="h-4 w-4 mr-1.5" />
              Delete
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedIds([])}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <SkeletonTable rows={5} columns={3} />
          ) : data?.sites?.length === 0 ? (
            <EmptyState
              icon={<Globe className="h-12 w-12" />}
              title={`No ${t('sites').toLowerCase()} found`}
              description="Get started by adding your first site"
            />
          ) : (
            <DataTable
              data={data?.sites || []}
              columns={columns}
              keyExtractor={(site) => site.id}
              onRowClick={handleRowClick}
              page={page}
              totalPages={data?.totalPages || 1}
              total={data?.total}
              onPageChange={setPage}
              selectable
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
            />
          )}
        </CardContent>
      </Card>

      {/* Create Modal */}
      <Modal open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <ModalContent size="lg">
          <ModalHeader>
            <ModalTitle>Create New {t('site')}</ModalTitle>
          </ModalHeader>
          <ModalBody>
            <SiteForm
              onSuccess={handleCreateSuccess}
              onCancel={() => setIsCreateOpen(false)}
            />
          </ModalBody>
        </ModalContent>
      </Modal>

      {/* Bulk Edit Modal */}
      <BulkEditSitesModal
        open={isBulkEditOpen}
        onOpenChange={setIsBulkEditOpen}
        selectedIds={selectedIds}
        onSuccess={handleBulkEditSuccess}
      />

      {/* Delete Confirmation Modal */}
      <Modal open={isDeleteConfirmOpen} onOpenChange={setIsDeleteConfirmOpen}>
        <ModalContent size="sm">
          <ModalHeader>
            <ModalTitle>Delete {selectedIds.length} {t('sites')}?</ModalTitle>
          </ModalHeader>
          <ModalBody>
            <p className="text-text-sub mb-4">
              This will delete the selected {t('sites').toLowerCase()} and all their associated domains.
              This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <Button
                variant="secondary"
                onClick={() => setIsDeleteConfirmOpen(false)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleBulkDelete}
                disabled={bulkDelete.isPending}
              >
                {bulkDelete.isPending ? 'Deleting...' : 'Delete'}
              </Button>
            </div>
          </ModalBody>
        </ModalContent>
      </Modal>
    </div>
  );
}
