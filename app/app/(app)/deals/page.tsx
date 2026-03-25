'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
} from '@dnd-kit/core';
import { Plus, Handshake, LayoutGrid, List } from 'lucide-react';
import { useAccords, useUpdateAccordStatus } from '@/lib/hooks/use-accords';
import { useClients } from '@/lib/hooks/use-clients';
import { useUsers } from '@/lib/hooks/use-users';
import { useTerminology } from '@/lib/hooks/use-terminology';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable, Column } from '@/components/ui/data-table';
import { SearchInput } from '@/components/ui/search-input';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonTable } from '@/components/ui/skeleton';
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalBody } from '@/components/ui/modal';
import { AccordCard } from '@/components/domain/accords/AccordCard';
import { AccordForm } from '@/components/domain/accords/AccordForm';
import type { AccordWithRelations, AccordStatus } from '@/types/entities';

const COLUMN_STATUSES: AccordStatus[] = [
  'lead',
  'meeting',
  'proposal',
  'contract',
  'signed',
];

const COLUMN_LABELS: Record<string, string> = {
  lead: 'Lead',
  meeting: 'Meeting',
  proposal: 'Proposal',
  contract: 'Contract',
  signed: 'Signed',
  active: 'Active',
  lost: 'Lost',
};

const STATUS_OPTIONS = [
  { value: 'lead', label: 'Lead' },
  { value: 'meeting', label: 'Meeting' },
  { value: 'proposal', label: 'Proposal' },
  { value: 'contract', label: 'Contract' },
  { value: 'signed', label: 'Signed' },
  { value: 'active', label: 'Active' },
  { value: 'lost', label: 'Lost' },
];

type ViewMode = 'kanban' | 'list';

const VIEW_STORAGE_KEY = 'deals-view-preference';

function getStoredView(): ViewMode {
  if (typeof window === 'undefined') return 'kanban';
  return (localStorage.getItem(VIEW_STORAGE_KEY) as ViewMode) || 'kanban';
}

interface KanbanColumnProps {
  status: AccordStatus;
  accords: AccordWithRelations[];
}

function KanbanColumn({ status, accords }: KanbanColumnProps) {
  const { isOver, setNodeRef } = useDroppable({ id: status });

  return (
    <div
      ref={setNodeRef}
      className={`min-w-[280px] flex-1 flex flex-col rounded-lg border transition-colors ${
        isOver
          ? 'border-primary bg-primary/5'
          : 'border-border-warm bg-background-light'
      }`}
    >
      {/* Column header */}
      <div className="flex items-center justify-between p-3 border-b border-border-warm">
        <span className="text-sm font-semibold text-text-main">
          {COLUMN_LABELS[status]}
        </span>
        <Badge size="sm">{accords.length}</Badge>
      </div>

      {/* Cards */}
      <div className="flex-1 p-2 space-y-2 overflow-y-auto min-h-[200px]">
        {accords.map((accord) => (
          <AccordCard key={accord.id} accord={accord} />
        ))}
      </div>
    </div>
  );
}

function formatCurrency(amount: number | null): string {
  if (amount === null || amount === undefined) return '-';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}

function getDaysAtStatus(enteredAt: string): number {
  const entered = new Date(enteredAt);
  const now = new Date();
  const diff = now.getTime() - entered.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

export default function DealsPage() {
  const { t } = useTerminology();
  const router = useRouter();
  const [isCreateOpen, setIsCreateOpen] = React.useState(false);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [viewMode, setViewMode] = React.useState<ViewMode>('kanban');

  // List view state
  const [search, setSearch] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('');
  const [clientFilter, setClientFilter] = React.useState('');
  const [ownerFilter, setOwnerFilter] = React.useState('');
  const [page, setPage] = React.useState(1);

  // Initialize view mode from localStorage
  React.useEffect(() => {
    setViewMode(getStoredView());
  }, []);

  const handleViewChange = (mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem(VIEW_STORAGE_KEY, mode);
  };

  // Fetch data for kanban (all non-lost accords)
  const kanbanQuery = useAccords({ limit: 200 });

  // Fetch data for list view with filters
  const listQuery = useAccords({
    page,
    limit: 20,
    search: search || undefined,
    status: statusFilter || undefined,
    client_id: clientFilter || undefined,
    owner_id: ownerFilter || undefined,
  });

  // Reference data for filters
  const { data: clientsData } = useClients({ limit: 100 });
  const { data: usersData } = useUsers();

  const updateStatus = useUpdateAccordStatus();

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  // Reset page when filters change
  React.useEffect(() => {
    setPage(1);
  }, [search, statusFilter, clientFilter, ownerFilter]);

  // Group accords by status for kanban
  const accordsByStatus = React.useMemo(() => {
    const grouped: Record<string, AccordWithRelations[]> = {};
    for (const status of COLUMN_STATUSES) {
      grouped[status] = [];
    }
    if (kanbanQuery.data?.accords) {
      for (const accord of kanbanQuery.data.accords) {
        // Only show accords in kanban columns (exclude active/lost)
        if (grouped[accord.status]) {
          grouped[accord.status].push(accord);
        }
      }
    }
    return grouped;
  }, [kanbanQuery.data]);

  const activeAccord = React.useMemo(() => {
    if (!activeId || !kanbanQuery.data?.accords) return null;
    return kanbanQuery.data.accords.find((a) => a.id === activeId) || null;
  }, [activeId, kanbanQuery.data]);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;

    const accordId = active.id as string;
    const newStatus = over.id as AccordStatus;

    const accord = kanbanQuery.data?.accords?.find((a) => a.id === accordId);
    if (accord && accord.status !== newStatus) {
      updateStatus.mutate({ id: accordId, status: newStatus });
    }
  };

  const handleDragCancel = () => {
    setActiveId(null);
  };

  const handleRowClick = (accord: AccordWithRelations) => {
    router.push(`/deals/${accord.id}`);
  };

  // Client options for filter
  const clientOptions = React.useMemo(() => {
    if (!clientsData?.clients) return [];
    return clientsData.clients.map((c) => ({ value: c.id, label: c.name }));
  }, [clientsData]);

  // Owner options for filter
  const ownerOptions = React.useMemo(() => {
    if (!usersData?.users) return [];
    return usersData.users.map((u) => ({ value: u.id, label: u.name }));
  }, [usersData]);

  // List view columns
  const columns: Column<AccordWithRelations>[] = React.useMemo(
    () => [
      {
        key: 'name',
        header: 'Name',
        cell: (accord) => (
          <div className="font-medium text-text-main">{accord.name}</div>
        ),
      },
      {
        key: 'client',
        header: 'Client',
        cell: (accord) => (
          <span className="text-sm text-text-sub">
            {accord.client?.name || accord.lead_business_name || '-'}
          </span>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        cell: (accord) => {
          const variant = accord.status === 'signed' ? 'success'
            : accord.status === 'lost' ? 'error'
            : accord.status === 'active' ? 'info'
            : 'default';
          return (
            <Badge variant={variant}>
              {COLUMN_LABELS[accord.status] || accord.status}
            </Badge>
          );
        },
      },
      {
        key: 'total_value',
        header: 'Total Value',
        cell: (accord) => (
          <span className="text-sm text-text-sub">
            {formatCurrency(accord.total_value)}
          </span>
        ),
      },
      {
        key: 'owner',
        header: 'Owner',
        cell: (accord) => (
          <span className="text-sm text-text-sub">
            {accord.owner?.name || '-'}
          </span>
        ),
      },
      {
        key: 'days_at_status',
        header: 'Days at Status',
        cell: (accord) => (
          <span className="text-sm text-text-sub">
            {getDaysAtStatus(accord.entered_current_status_at)}d
          </span>
        ),
      },
      {
        key: 'created_at',
        header: 'Created',
        cell: (accord) => (
          <span className="text-sm text-text-sub">
            {new Date(accord.created_at).toLocaleDateString()}
          </span>
        ),
      },
    ],
    []
  );

  // Filter out lost deals from list view by default (unless explicitly filtering for them)
  const listData = React.useMemo(() => {
    if (!listQuery.data?.accords) return [];
    if (statusFilter) return listQuery.data.accords;
    return listQuery.data.accords.filter((a) => a.status !== 'lost');
  }, [listQuery.data, statusFilter]);

  const isLoading = viewMode === 'kanban' ? kanbanQuery.isLoading : listQuery.isLoading;
  const error = viewMode === 'kanban' ? kanbanQuery.error : listQuery.error;

  if (isLoading && viewMode === 'kanban') {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <EmptyState
          icon={<Handshake className="h-12 w-12" />}
          title={`Error loading ${t('deals').toLowerCase()}`}
          description="There was a problem loading the pipeline. Please try again."
          action={
            <Button onClick={() => window.location.reload()}>Retry</Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text-main">
            {t('deals')}
          </h1>
          <p className="text-text-sub">Track your sales pipeline</p>
        </div>
        <div className="flex items-center gap-3">
          {/* View toggle */}
          <div className="flex items-center border border-border-warm rounded-lg overflow-hidden">
            <button
              onClick={() => handleViewChange('kanban')}
              className={`p-2 transition-colors ${
                viewMode === 'kanban'
                  ? 'bg-primary/10 text-primary'
                  : 'text-text-sub hover:text-text-main hover:bg-surface'
              }`}
              title="Kanban view"
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              onClick={() => handleViewChange('list')}
              className={`p-2 transition-colors ${
                viewMode === 'list'
                  ? 'bg-primary/10 text-primary'
                  : 'text-text-sub hover:text-text-main hover:bg-surface'
              }`}
              title="List view"
            >
              <List className="h-4 w-4" />
            </button>
          </div>
          <Button onClick={() => setIsCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            {t('newDeal')}
          </Button>
        </div>
      </div>

      {/* Kanban View */}
      {viewMode === 'kanban' && (
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <div className="flex gap-4 overflow-x-auto pb-4">
            {COLUMN_STATUSES.map((status) => (
              <KanbanColumn
                key={status}
                status={status}
                accords={accordsByStatus[status] || []}
              />
            ))}
          </div>

          <DragOverlay>
            {activeAccord ? (
              <div className="w-[280px] opacity-90 rotate-2">
                <AccordCard accord={activeAccord} />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {/* List View */}
      {viewMode === 'list' && (
        <>
          {/* Filters */}
          <Card>
            <CardContent className="py-4">
              <div className="flex flex-col md:flex-row gap-4">
                <SearchInput
                  value={search}
                  onChange={setSearch}
                  placeholder={`Search ${t('deals').toLowerCase()}...`}
                  className="md:w-64"
                />
                <Select
                  options={STATUS_OPTIONS}
                  value={statusFilter}
                  onChange={setStatusFilter}
                  placeholder="All statuses"
                  className="md:w-40"
                />
                <Select
                  options={clientOptions}
                  value={clientFilter}
                  onChange={setClientFilter}
                  placeholder="All clients"
                  className="md:w-48"
                />
                <Select
                  options={ownerOptions}
                  value={ownerFilter}
                  onChange={setOwnerFilter}
                  placeholder="All owners"
                  className="md:w-44"
                />
              </div>
            </CardContent>
          </Card>

          {/* Table */}
          <Card>
            <CardContent className="p-0">
              {listQuery.isLoading ? (
                <SkeletonTable rows={5} columns={7} />
              ) : listData.length === 0 ? (
                <EmptyState
                  icon={<Handshake className="h-12 w-12" />}
                  title={`No ${t('deals').toLowerCase()} found`}
                  description={
                    search || statusFilter || clientFilter || ownerFilter
                      ? 'Try adjusting your filters'
                      : `Get started by creating your first ${t('deal').toLowerCase()}`
                  }
                />
              ) : (
                <DataTable
                  data={listData}
                  columns={columns}
                  keyExtractor={(accord) => accord.id}
                  onRowClick={handleRowClick}
                  page={page}
                  totalPages={listQuery.data?.totalPages || 1}
                  total={listQuery.data?.total}
                  onPageChange={setPage}
                />
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Create Modal */}
      <Modal open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <ModalContent size="lg">
          <ModalHeader>
            <ModalTitle>{t('newDeal')}</ModalTitle>
          </ModalHeader>
          <ModalBody>
            <AccordForm
              onSuccess={() => setIsCreateOpen(false)}
              onCancel={() => setIsCreateOpen(false)}
            />
          </ModalBody>
        </ModalContent>
      </Modal>
    </div>
  );
}
