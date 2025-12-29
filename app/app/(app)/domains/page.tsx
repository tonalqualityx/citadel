'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Link2 } from 'lucide-react';
import { useDomains } from '@/lib/hooks/use-domains';
import { useTerminology } from '@/lib/hooks/use-terminology';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable, Column } from '@/components/ui/data-table';
import { SearchInput } from '@/components/ui/search-input';
import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonTable } from '@/components/ui/skeleton';

interface Domain {
  id: string;
  name: string;
  registrar: string | null;
  expires_at: string | null;
  is_primary: boolean;
  site?: { id: string; name: string } | null;
}

export default function DomainsPage() {
  const router = useRouter();
  const { t } = useTerminology();
  const [search, setSearch] = React.useState('');
  const [page, setPage] = React.useState(1);

  const { data, isLoading, error } = useDomains({ page, search: search || undefined });

  const columns: Column<Domain>[] = [
    {
      key: 'name',
      header: 'Domain',
      cell: (domain) => (
        <div className="flex items-center gap-2">
          <span className="font-medium text-text-main">{domain.name}</span>
          {domain.is_primary && <Badge variant="purple">Primary</Badge>}
        </div>
      ),
    },
    {
      key: 'site',
      header: t('site'),
      cell: (domain) => (
        <span className="text-sm text-text-sub">{domain.site?.name || '-'}</span>
      ),
    },
    {
      key: 'registrar',
      header: 'Registrar',
      cell: (domain) => (
        <span className="text-sm text-text-sub">{domain.registrar || '-'}</span>
      ),
    },
    {
      key: 'expires',
      header: 'Expires',
      cell: (domain) => (
        <span className="text-sm text-text-sub">
          {domain.expires_at ? new Date(domain.expires_at).toLocaleDateString() : '-'}
        </span>
      ),
    },
  ];

  const handleRowClick = (domain: Domain) => {
    router.push(`/domains/${domain.id}`);
  };

  if (error) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-8">
            <EmptyState
              icon={<Link2 className="h-12 w-12" />}
              title="Error loading domains"
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
          <h1 className="text-2xl font-semibold text-text-main">{t('domains')}</h1>
          <p className="text-text-sub">Manage domain registrations</p>
        </div>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          New Domain
        </Button>
      </div>

      <Card>
        <CardContent className="py-4">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search domains..."
            className="md:w-64"
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <SkeletonTable rows={5} columns={4} />
          ) : data?.domains?.length === 0 ? (
            <EmptyState
              icon={<Link2 className="h-12 w-12" />}
              title="No domains found"
            />
          ) : (
            <DataTable
              data={data?.domains || []}
              columns={columns}
              keyExtractor={(domain) => domain.id}
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
