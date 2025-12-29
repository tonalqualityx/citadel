'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Globe } from 'lucide-react';
import { useSites } from '@/lib/hooks/use-sites';
import { useTerminology } from '@/lib/hooks/use-terminology';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable, Column } from '@/components/ui/data-table';
import { SearchInput } from '@/components/ui/search-input';
import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonTable } from '@/components/ui/skeleton';

interface Site {
  id: string;
  name: string;
  url: string | null;
  client?: { id: string; name: string } | null;
}

export default function SitesPage() {
  const router = useRouter();
  const { t } = useTerminology();
  const [search, setSearch] = React.useState('');
  const [page, setPage] = React.useState(1);

  const { data, isLoading, error } = useSites({ page, search: search || undefined });

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
        <span className="text-sm text-text-sub">{site.client?.name || '-'}</span>
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
        <Button>
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

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <SkeletonTable rows={5} columns={2} />
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
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
