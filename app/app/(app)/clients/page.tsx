'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Users, Building2, Trash2, X } from 'lucide-react';
import {
  useClients,
  useUpdateClient,
  useDeleteClient,
  useBulkDeleteClients,
} from '@/lib/hooks/use-clients';
import { useAuth } from '@/lib/hooks/use-auth';
import { useTerminology } from '@/lib/hooks/use-terminology';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable, Column } from '@/components/ui/data-table';
import { SearchInput } from '@/components/ui/search-input';
import { Select } from '@/components/ui/select';
import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonTable } from '@/components/ui/skeleton';
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalBody } from '@/components/ui/modal';
import { ClientForm } from '@/components/domain/client-form';
import {
  ClientStatusInlineSelect,
  ClientTypeInlineSelect,
} from '@/components/domain/clients/client-inline-selects';
import { BulkEditClientsModal } from '@/components/domain/clients/bulk-edit-clients-modal';
import { InlineText } from '@/components/ui/inline-edit';

const statusOptions = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'delinquent', label: 'Delinquent' },
];

const typeOptions = [
  { value: 'direct', label: 'Direct' },
  { value: 'agency_partner', label: 'Agency Partner' },
  { value: 'sub_client', label: 'Sub-Client' },
];

interface Client {
  id: string;
  name: string;
  type: string;
  status: string;
  primary_contact: string | null;
  retainer_hours: number | null;
  hourly_rate: number | null;
}

export default function ClientsPage() {
  const router = useRouter();
  const { t } = useTerminology();
  const { user } = useAuth();

  // Role-based permissions
  const isAdmin = user?.role === 'admin';
  const canEdit = user?.role === 'admin' || user?.role === 'pm';

  // Search and filter state
  const [search, setSearch] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [type, setType] = React.useState('');
  const [page, setPage] = React.useState(1);

  // Modal state
  const [isCreateOpen, setIsCreateOpen] = React.useState(false);
  const [isBulkEditOpen, setIsBulkEditOpen] = React.useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = React.useState(false);
  const [clientToDelete, setClientToDelete] = React.useState<Client | null>(null);

  // Selection state
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);

  // Hooks
  const { data, isLoading, error } = useClients({
    page,
    search: search || undefined,
    status: status as 'active' | 'inactive' | 'delinquent' | undefined,
    type: type as 'direct' | 'agency_partner' | 'sub_client' | undefined,
  });
  const updateClient = useUpdateClient();
  const deleteClient = useDeleteClient();
  const bulkDeleteClients = useBulkDeleteClients();

  // Reset page when filters change
  React.useEffect(() => {
    setPage(1);
  }, [search, status, type]);

  // Clear selection when filters change
  React.useEffect(() => {
    setSelectedIds([]);
  }, [search, status, type]);

  const handleCreateSuccess = () => {
    setIsCreateOpen(false);
  };

  const handleDelete = async () => {
    if (selectedIds.length > 0) {
      // Bulk delete
      await bulkDeleteClients.mutateAsync(selectedIds);
      setSelectedIds([]);
    } else if (clientToDelete) {
      // Single delete
      await deleteClient.mutateAsync(clientToDelete.id);
    }
    setIsDeleteConfirmOpen(false);
    setClientToDelete(null);
  };

  const handleBulkEditSuccess = () => {
    setSelectedIds([]);
  };

  const handleRowClick = (client: Client) => {
    router.push(`/clients/${client.id}`);
  };

  // Build columns based on role
  const columns: Column<Client>[] = React.useMemo(() => {
    const cols: Column<Client>[] = [
      {
        key: 'name',
        header: 'Name',
        cell: (client) => (
          <div>
            <div className="font-medium text-text-main">{client.name}</div>
            {client.primary_contact && (
              <div className="text-sm text-text-sub">{client.primary_contact}</div>
            )}
          </div>
        ),
      },
      {
        key: 'type',
        header: 'Type',
        cell: (client) =>
          canEdit ? (
            <div onClick={(e) => e.stopPropagation()}>
              <ClientTypeInlineSelect
                value={client.type}
                onChange={(newType) =>
                  updateClient.mutate({
                    id: client.id,
                    data: { type: newType as 'direct' | 'agency_partner' | 'sub_client' },
                  })
                }
              />
            </div>
          ) : (
            <span className="text-sm text-text-sub capitalize">
              {client.type.replace('_', ' ')}
            </span>
          ),
      },
      {
        key: 'status',
        header: 'Status',
        cell: (client) =>
          canEdit ? (
            <div onClick={(e) => e.stopPropagation()}>
              <ClientStatusInlineSelect
                value={client.status}
                onChange={(newStatus) =>
                  updateClient.mutate({
                    id: client.id,
                    data: { status: newStatus as 'active' | 'inactive' | 'delinquent' },
                  })
                }
              />
            </div>
          ) : (
            <Badge
              variant={
                client.status === 'active'
                  ? 'success'
                  : client.status === 'delinquent'
                  ? 'warning'
                  : 'default'
              }
            >
              {client.status}
            </Badge>
          ),
      },
      {
        key: 'retainer',
        header: 'Retainer',
        cell: (client) =>
          canEdit ? (
            <div onClick={(e) => e.stopPropagation()} className="flex items-center gap-1">
              <InlineText
                value={client.retainer_hours?.toString() || null}
                onChange={(val) =>
                  updateClient.mutate({
                    id: client.id,
                    data: { retainer_hours: val ? Number(val) : undefined },
                  })
                }
                placeholder="-"
                type="number"
              />
              {client.retainer_hours != null && (
                <span className="text-sm text-text-sub">hrs/mo</span>
              )}
            </div>
          ) : (
            <span className="text-sm text-text-sub">
              {client.retainer_hours ? `${client.retainer_hours} hrs/mo` : '-'}
            </span>
          ),
      },
    ];

    // Add hourly rate column for admin only
    if (isAdmin) {
      cols.push({
        key: 'hourly_rate',
        header: 'Rate',
        cell: (client) => (
          <div onClick={(e) => e.stopPropagation()} className="flex items-center gap-1">
            <span className="text-sm text-text-sub">$</span>
            <InlineText
              value={client.hourly_rate?.toString() || null}
              onChange={(val) =>
                updateClient.mutate({
                  id: client.id,
                  data: { hourly_rate: val ? Number(val) : undefined },
                })
              }
              placeholder="-"
              type="number"
            />
            {client.hourly_rate != null && (
              <span className="text-sm text-text-sub">/hr</span>
            )}
          </div>
        ),
      });
    }

    // Add actions column for admin/PM
    if (canEdit) {
      cols.push({
        key: 'actions',
        header: '',
        cell: (client) => (
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              setClientToDelete(client);
              setIsDeleteConfirmOpen(true);
            }}
            className="opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <Trash2 className="h-4 w-4 text-text-sub hover:text-red-500" />
          </Button>
        ),
      });
    }

    return cols;
  }, [canEdit, isAdmin, updateClient]);

  if (error) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-8">
            <EmptyState
              icon={<Users className="h-12 w-12" />}
              title={`Error loading ${t('clients').toLowerCase()}`}
              description="There was a problem loading the list. Please try again."
              action={
                <Button onClick={() => window.location.reload()}>Retry</Button>
              }
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
          <h1 className="text-2xl font-semibold text-text-main">{t('clients')}</h1>
          <p className="text-text-sub">Manage your client relationships</p>
        </div>
        <Button onClick={() => setIsCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          New {t('client')}
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Users className="h-5 w-5 text-primary" />
              </div>
              <div>
                <div className="text-2xl font-semibold text-text-main">
                  {data?.total || 0}
                </div>
                <div className="text-sm text-text-sub">Total {t('clients')}</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/10">
                <Building2 className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <div className="text-2xl font-semibold text-text-main">
                  {data?.clients?.filter((c) => c.status === 'active').length || 0}
                </div>
                <div className="text-sm text-text-sub">Active</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10">
                <Users className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <div className="text-2xl font-semibold text-text-main">
                  {data?.clients?.filter((c) => c.retainer_hours).length || 0}
                </div>
                <div className="text-sm text-text-sub">On Retainer</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-col md:flex-row gap-4">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder={`Search ${t('clients').toLowerCase()}...`}
              className="md:w-64"
            />
            <Select
              options={statusOptions}
              value={status}
              onChange={setStatus}
              placeholder="All statuses"
              className="md:w-40"
            />
            <Select
              options={typeOptions}
              value={type}
              onChange={setType}
              placeholder="All types"
              className="md:w-40"
            />
          </div>
        </CardContent>
      </Card>

      {/* Bulk Action Toolbar */}
      {canEdit && selectedIds.length > 0 && (
        <div className="flex items-center gap-3 p-3 bg-primary/10 border border-primary/20 rounded-lg">
          <span className="text-sm font-medium text-text-main">
            {selectedIds.length} {t('clients').toLowerCase()} selected
          </span>
          <div className="flex-1" />
          <Button size="sm" onClick={() => setIsBulkEditOpen(true)}>
            Edit Selected
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => {
              setClientToDelete(null);
              setIsDeleteConfirmOpen(true);
            }}
          >
            Delete Selected
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSelectedIds([])}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <SkeletonTable rows={5} columns={isAdmin ? 6 : canEdit ? 5 : 4} />
          ) : data?.clients?.length === 0 ? (
            <EmptyState
              icon={<Users className="h-12 w-12" />}
              title={`No ${t('clients').toLowerCase()} found`}
              description={
                search || status || type
                  ? 'Try adjusting your filters'
                  : `Get started by adding your first ${t('client').toLowerCase()}`
              }
            />
          ) : (
            <DataTable
              data={data?.clients || []}
              columns={columns}
              keyExtractor={(client) => client.id}
              onRowClick={handleRowClick}
              selectable={canEdit}
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
              page={page}
              totalPages={data?.totalPages || 1}
              total={data?.total}
              onPageChange={setPage}
            />
          )}
        </CardContent>
      </Card>

      {/* Create Modal */}
      <Modal open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <ModalContent size="lg">
          <ModalHeader>
            <ModalTitle>Create New {t('client')}</ModalTitle>
          </ModalHeader>
          <ModalBody>
            <ClientForm
              onSuccess={handleCreateSuccess}
              onCancel={() => setIsCreateOpen(false)}
            />
          </ModalBody>
        </ModalContent>
      </Modal>

      {/* Bulk Edit Modal */}
      <BulkEditClientsModal
        open={isBulkEditOpen}
        onOpenChange={setIsBulkEditOpen}
        selectedIds={selectedIds}
        onSuccess={handleBulkEditSuccess}
        showHourlyRate={isAdmin}
      />

      {/* Delete Confirmation Modal */}
      <Modal open={isDeleteConfirmOpen} onOpenChange={setIsDeleteConfirmOpen}>
        <ModalContent size="sm">
          <ModalHeader>
            <ModalTitle>
              Delete {clientToDelete ? t('client') : `${selectedIds.length} ${t('clients')}`}
            </ModalTitle>
          </ModalHeader>
          <ModalBody>
            <p className="text-text-sub">
              {clientToDelete ? (
                <>
                  Are you sure you want to delete <strong>{clientToDelete.name}</strong>?
                  This action cannot be undone.
                </>
              ) : (
                <>
                  Are you sure you want to delete {selectedIds.length} {t('clients').toLowerCase()}?
                  This action cannot be undone.
                </>
              )}
            </p>
            <div className="flex justify-end gap-3 mt-4">
              <Button variant="ghost" onClick={() => setIsDeleteConfirmOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={deleteClient.isPending || bulkDeleteClients.isPending}
              >
                {deleteClient.isPending || bulkDeleteClients.isPending
                  ? 'Deleting...'
                  : 'Delete'}
              </Button>
            </div>
          </ModalBody>
        </ModalContent>
      </Modal>
    </div>
  );
}
