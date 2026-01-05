'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Users, Building2 } from 'lucide-react';
import { useClients } from '@/lib/hooks/use-clients';
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
}

export default function ClientsPage() {
  const router = useRouter();
  const { t } = useTerminology();
  const [search, setSearch] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [type, setType] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [isCreateOpen, setIsCreateOpen] = React.useState(false);

  React.useEffect(() => {
    setPage(1);
  }, [search, status, type]);

  const handleCreateSuccess = () => {
    setIsCreateOpen(false);
  };

  const { data, isLoading, error } = useClients({
    page,
    search: search || undefined,
    status: status as any || undefined,
    type: type as any || undefined,
  });

  const columns: Column<Client>[] = [
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
      cell: (client) => (
        <span className="text-sm text-text-sub capitalize">
          {client.type.replace('_', ' ')}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (client) => (
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
      cell: (client) => (
        <span className="text-sm text-text-sub">
          {client.retainer_hours ? `${client.retainer_hours} hrs/mo` : '-'}
        </span>
      ),
    },
  ];

  const handleRowClick = (client: Client) => {
    router.push(`/clients/${client.id}`);
  };

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

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <SkeletonTable rows={5} columns={4} />
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
    </div>
  );
}
