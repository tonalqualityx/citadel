'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, FileText } from 'lucide-react';
import { useSops } from '@/lib/hooks/use-sops';
import { useTerminology } from '@/lib/hooks/use-terminology';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable, Column } from '@/components/ui/data-table';
import { SearchInput } from '@/components/ui/search-input';
import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonTable } from '@/components/ui/skeleton';

interface Sop {
  id: string;
  title: string;
  function?: { id: string; name: string } | null;
  estimated_minutes: number | null;
  is_active: boolean;
  updated_at: string;
}

export default function SopsPage() {
  const router = useRouter();
  const { t } = useTerminology();
  const [search, setSearch] = React.useState('');
  const [page, setPage] = React.useState(1);

  const { data, isLoading, error } = useSops({ page, search: search || undefined });

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
      cell: (sop) => (
        <span className="text-sm text-text-sub">
          {sop.estimated_minutes ? `${sop.estimated_minutes} min` : '-'}
        </span>
      ),
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
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder={`Search ${t('sops').toLowerCase()}...`}
            className="md:w-64"
          />
        </CardContent>
      </Card>

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
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
