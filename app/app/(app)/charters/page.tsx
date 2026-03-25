'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Plus, ScrollText } from 'lucide-react';
import { useCharters, useCreateCharter } from '@/lib/hooks/use-charters';
import { useTerminology } from '@/lib/hooks/use-terminology';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalBody,
} from '@/components/ui/modal';
import { CharterForm } from '@/components/domain/charters/CharterForm';
import { CharterList } from '@/components/domain/charters/CharterList';
import type { CharterStatus, CreateCharterInput } from '@/types/entities';

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'cancelled', label: 'Cancelled' },
];

export default function ChartersPage() {
  const router = useRouter();
  const { t } = useTerminology();
  const [search, setSearch] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [showCreateModal, setShowCreateModal] = React.useState(false);

  const debouncedSearch = useDebounce(search, 300);
  const createCharter = useCreateCharter();

  const { data, isLoading, error } = useCharters({
    page,
    limit: 20,
    search: debouncedSearch || undefined,
    status: (status as CharterStatus) || undefined,
  });

  // Reset page when filters change
  React.useEffect(() => {
    setPage(1);
  }, [debouncedSearch, status]);

  const handleCreate = async (input: CreateCharterInput) => {
    const result = await createCharter.mutateAsync(input);
    setShowCreateModal(false);
    if (result?.id) {
      router.push(`/charters/${result.id}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-main">{t('retainers')}</h1>
          <p className="text-sm text-text-sub mt-1">
            Manage recurring service agreements
          </p>
        </div>
        <Button onClick={() => setShowCreateModal(true)}>
          <Plus className="h-4 w-4 mr-2" />
          New {t('retainer')}
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="flex-1 max-w-sm">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${t('retainers').toLowerCase()}...`}
          />
        </div>
        <div className="w-48">
          <Select
            options={STATUS_OPTIONS}
            value={status}
            onChange={setStatus}
            placeholder="All Statuses"
          />
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : error ? (
        <div className="text-center py-12 text-red-500">
          Failed to load {t('retainers').toLowerCase()}
        </div>
      ) : !data?.charters?.length ? (
        <EmptyState
          icon={<ScrollText className="h-12 w-12" />}
          title={`No ${t('retainers').toLowerCase()} found`}
          description={
            search || status
              ? 'Try adjusting your filters'
              : `Create your first ${t('retainer').toLowerCase()} to get started`
          }
          action={
            !search && !status ? (
              <Button onClick={() => setShowCreateModal(true)} className="mt-4">
                <Plus className="h-4 w-4 mr-2" />
                New {t('retainer')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <CharterList
            charters={data.charters}
            onSelect={(id) => router.push(`/charters/${id}`)}
          />

          {/* Pagination */}
          {data.totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-text-sub">
                Page {data.page} of {data.totalPages} ({data.total} total)
              </p>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page >= data.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Create modal */}
      <Modal open={showCreateModal} onOpenChange={setShowCreateModal}>
        <ModalContent>
          <ModalHeader>
            <ModalTitle>New {t('retainer')}</ModalTitle>
          </ModalHeader>
          <ModalBody>
            <CharterForm
              onSubmit={handleCreate}
              onCancel={() => setShowCreateModal(false)}
              isSubmitting={createCharter.isPending}
            />
          </ModalBody>
        </ModalContent>
      </Modal>
    </div>
  );
}

// Simple debounce hook
function useDebounce(value: string, delay: number) {
  const [debouncedValue, setDebouncedValue] = React.useState(value);

  React.useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}
