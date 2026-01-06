'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, FileText, Pencil, Trash2, X, Filter } from 'lucide-react';
import { useSops, useBulkDeleteSops } from '@/lib/hooks/use-sops';
import { useFunctions } from '@/lib/hooks/use-reference-data';
import { useTerminology } from '@/lib/hooks/use-terminology';
import { useAuth } from '@/lib/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable, Column } from '@/components/ui/data-table';
import { SearchInput } from '@/components/ui/search-input';
import { Select } from '@/components/ui/select';
import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonTable } from '@/components/ui/skeleton';
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalBody } from '@/components/ui/modal';
import { BulkEditSopsModal } from '@/components/domain/sops/bulk-edit-modal';
import { showToast } from '@/lib/hooks/use-toast';
import { calculateTimeRange } from '@/lib/config/task-fields';

interface Sop {
  id: string;
  title: string;
  function?: { id: string; name: string } | null;
  energy_estimate: number | null;
  mystery_factor: string;
  battery_impact: string;
  estimated_minutes: number | null;
  is_active: boolean;
  updated_at: string;
}

export default function SopsPage() {
  const router = useRouter();
  const { t } = useTerminology();
  const { isAdmin } = useAuth();
  const [search, setSearch] = React.useState('');
  const [functionId, setFunctionId] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const [isBulkEditOpen, setIsBulkEditOpen] = React.useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = React.useState(false);

  const { data: functionsData } = useFunctions();
  const { data, isLoading, error } = useSops({
    page,
    search: search || undefined,
    function_id: functionId || undefined,
  });
  const bulkDelete = useBulkDeleteSops();

  // Build function options for filter
  const functionOptions = React.useMemo(() => {
    const opts = (functionsData?.functions || []).map((f) => ({
      value: f.id,
      label: f.name,
    }));
    return [{ value: '', label: 'All Functions' }, ...opts];
  }, [functionsData?.functions]);

  // Clear selection when page, search, or function filter changes
  React.useEffect(() => {
    setSelectedIds([]);
  }, [page, search, functionId]);

  // Reset page when filters change
  React.useEffect(() => {
    setPage(1);
  }, [search, functionId]);

  const handleBulkEditSuccess = () => {
    setSelectedIds([]);
  };

  const handleBulkDelete = async () => {
    try {
      const result = await bulkDelete.mutateAsync(selectedIds);
      showToast.success(`Deleted ${result.deleted} ${t('sops').toLowerCase()}`);
      setSelectedIds([]);
      setIsDeleteConfirmOpen(false);
    } catch (error) {
      showToast.apiError(error, 'Failed to delete SOPs');
    }
  };

  const columns: Column<Sop>[] = [
    {
      key: 'title',
      header: 'Title',
      cell: (sop) => (
        <div>
          <div className="font-medium text-text-main">{sop.title}</div>
          <div className="text-sm text-text-sub">
            Updated {new Date(sop.updated_at).toLocaleDateString()}
          </div>
        </div>
      ),
    },
    {
      key: 'function',
      header: 'Function',
      cell: (sop) => (
        <span className="text-sm text-text-sub">{sop.function?.name || 'General'}</span>
      ),
    },
    {
      key: 'time',
      header: 'Est. Time',
      cell: (sop) => {
        const timeRange = calculateTimeRange(
          sop.energy_estimate,
          sop.mystery_factor,
          sop.battery_impact
        );
        return (
          <span className="text-sm text-text-sub">
            {timeRange || '-'}
          </span>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      cell: (sop) => (
        <Badge variant={sop.is_active ? 'success' : 'default'}>
          {sop.is_active ? 'Active' : 'Draft'}
        </Badge>
      ),
    },
  ];

  const handleRowClick = (sop: Sop) => {
    router.push(`/sops/${sop.id}`);
  };

  if (error) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-8">
            <EmptyState
              icon={<FileText className="h-12 w-12" />}
              title={`Error loading ${t('sops').toLowerCase()}`}
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
          <h1 className="text-2xl font-semibold text-text-main">{t('sops')}</h1>
          <p className="text-text-sub">Standard operating procedures and documentation</p>
        </div>
        <Link href="/sops/new">
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            New {t('sop')}
          </Button>
        </Link>
      </div>

      <Card>
        <CardContent className="py-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder={`Search ${t('sops').toLowerCase()}...`}
              className="sm:w-64"
            />
            <Select
              options={functionOptions}
              value={functionId}
              onChange={setFunctionId}
              placeholder="All Functions"
              className="sm:w-48"
            />
            {functionId && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setFunctionId('')}
                className="self-start"
              >
                <X className="h-4 w-4 mr-1" />
                Clear filter
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Bulk Action Toolbar */}
      {selectedIds.length > 0 && (
        <div className="flex items-center gap-3 p-3 bg-primary/10 border border-primary/20 rounded-lg">
          <span className="text-sm font-medium text-text-main">
            {selectedIds.length} {t('sops').toLowerCase()} selected
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
            <SkeletonTable rows={5} columns={4} />
          ) : data?.sops?.length === 0 ? (
            <EmptyState
              icon={<FileText className="h-12 w-12" />}
              title={`No ${t('sops').toLowerCase()} found`}
              action={
                <Link href="/sops/new">
                  <Button>
                    <Plus className="h-4 w-4 mr-2" />
                    Create your first {t('sop').toLowerCase()}
                  </Button>
                </Link>
              }
            />
          ) : (
            <DataTable
              data={data?.sops || []}
              columns={columns}
              keyExtractor={(sop) => sop.id}
              onRowClick={handleRowClick}
              page={page}
              totalPages={data?.pagination?.total_pages || 1}
              total={data?.pagination?.total}
              onPageChange={setPage}
              selectable
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
            />
          )}
        </CardContent>
      </Card>

      {/* Bulk Edit Modal */}
      <BulkEditSopsModal
        open={isBulkEditOpen}
        onOpenChange={setIsBulkEditOpen}
        selectedIds={selectedIds}
        onSuccess={handleBulkEditSuccess}
      />

      {/* Delete Confirmation Modal */}
      <Modal open={isDeleteConfirmOpen} onOpenChange={setIsDeleteConfirmOpen}>
        <ModalContent size="sm">
          <ModalHeader>
            <ModalTitle>Delete {selectedIds.length} {t('sops')}?</ModalTitle>
          </ModalHeader>
          <ModalBody>
            <p className="text-text-sub mb-4">
              This will mark the selected {t('sops').toLowerCase()} as inactive.
              They can be restored later if needed.
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
