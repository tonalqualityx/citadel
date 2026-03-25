'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Package, Pencil } from 'lucide-react';
import { useWares } from '@/lib/hooks/use-wares';
import { useTerminology } from '@/lib/hooks/use-terminology';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable, Column } from '@/components/ui/data-table';
import { SearchInput } from '@/components/ui/search-input';
import { Select } from '@/components/ui/select';
import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonTable } from '@/components/ui/skeleton';
import { WareForm } from '@/components/domain/wares/WareForm';
import type { WareWithRelations } from '@/types/entities';

const typeOptions = [
  { value: 'commission', label: 'Commission' },
  { value: 'charter', label: 'Charter' },
];

const activeOptions = [
  { value: 'true', label: 'Active' },
  { value: 'false', label: 'Inactive' },
];

function formatCurrency(amount: number | null): string {
  if (amount === null || amount === undefined) return '-';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}

export default function WaresPage() {
  const router = useRouter();
  const { t } = useTerminology();

  // Search and filter state
  const [search, setSearch] = React.useState('');
  const [type, setType] = React.useState('');
  const [activeFilter, setActiveFilter] = React.useState('');
  const [page, setPage] = React.useState(1);

  // Modal state
  const [isFormOpen, setIsFormOpen] = React.useState(false);

  // Data fetching
  const { data, isLoading, error } = useWares({
    page,
    search: search || undefined,
    type: type as 'commission' | 'charter' | undefined || undefined,
    is_active: activeFilter ? activeFilter === 'true' : undefined,
  });

  // Reset page when filters change
  React.useEffect(() => {
    setPage(1);
  }, [search, type, activeFilter]);

  const handleOpenCreate = () => {
    setIsFormOpen(true);
  };

  const handleCloseForm = () => {
    setIsFormOpen(false);
  };

  const handleRowClick = (ware: WareWithRelations) => {
    router.push(`/deals/wares/${ware.id}`);
  };

  const columns: Column<WareWithRelations>[] = React.useMemo(
    () => [
      {
        key: 'name',
        header: 'Name',
        cell: (ware) => (
          <div className="font-medium text-text-main">{ware.name}</div>
        ),
      },
      {
        key: 'type',
        header: 'Type',
        cell: (ware) => (
          <Badge variant={ware.type === 'commission' ? 'purple' : 'info'}>
            {ware.type === 'commission' ? 'Commission' : 'Charter'}
          </Badge>
        ),
      },
      {
        key: 'base_price',
        header: 'Base Price',
        cell: (ware) => (
          <span className="text-sm text-text-sub">
            {formatCurrency(ware.base_price)}
          </span>
        ),
      },
      {
        key: 'active',
        header: 'Active',
        cell: (ware) => (
          <Badge variant={ware.is_active ? 'success' : 'default'}>
            {ware.is_active ? 'Active' : 'Inactive'}
          </Badge>
        ),
      },
      {
        key: 'actions',
        header: '',
        cell: (ware) => (
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              router.push(`/deals/wares/${ware.id}`);
            }}
            className="opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <Pencil className="h-4 w-4 text-text-sub" />
          </Button>
        ),
      },
    ],
    []
  );

  if (error) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-8">
            <EmptyState
              icon={<Package className="h-12 w-12" />}
              title={`Error loading ${t('products').toLowerCase()}`}
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
          <h1 className="text-2xl font-semibold text-text-main">
            {t('products')}
          </h1>
          <p className="text-text-sub">
            Manage your product and service catalog
          </p>
        </div>
        <Button onClick={handleOpenCreate}>
          <Plus className="h-4 w-4 mr-2" />
          {t('newProduct')}
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-col md:flex-row gap-4">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder={`Search ${t('products').toLowerCase()}...`}
              className="md:w-64"
            />
            <Select
              options={typeOptions}
              value={type}
              onChange={setType}
              placeholder="All types"
              className="md:w-40"
            />
            <Select
              options={activeOptions}
              value={activeFilter}
              onChange={setActiveFilter}
              placeholder="All statuses"
              className="md:w-40"
            />
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <SkeletonTable rows={5} columns={5} />
          ) : data?.wares?.length === 0 ? (
            <EmptyState
              icon={<Package className="h-12 w-12" />}
              title={`No ${t('products').toLowerCase()} found`}
              description={
                search || type || activeFilter
                  ? 'Try adjusting your filters'
                  : `Get started by adding your first ${t('product').toLowerCase()}`
              }
            />
          ) : (
            <DataTable
              data={data?.wares || []}
              columns={columns}
              keyExtractor={(ware) => ware.id}
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
      <WareForm
        open={isFormOpen}
        onClose={handleCloseForm}
        onCreated={(id) => router.push(`/deals/wares/${id}`)}
      />
    </div>
  );
}
