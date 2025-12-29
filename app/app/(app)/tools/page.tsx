'use client';

import * as React from 'react';
import { Plus, Wrench } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { useTerminology } from '@/lib/hooks/use-terminology';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable, Column } from '@/components/ui/data-table';
import { SearchInput } from '@/components/ui/search-input';
import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonTable } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';

interface Tool {
  id: string;
  name: string;
  category: string | null;
  url: string | null;
  is_active: boolean;
}

export default function ToolsPage() {
  const { t } = useTerminology();
  const [search, setSearch] = React.useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['tools', search],
    queryFn: () => apiClient.get<{ tools: Tool[] }>('/tools', { params: { search } }),
  });

  const columns: Column<Tool>[] = [
    {
      key: 'name',
      header: 'Name',
      cell: (tool) => (
        <div>
          <div className="font-medium text-text-main">{tool.name}</div>
          {tool.url && (
            <a href={tool.url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline">
              {tool.url}
            </a>
          )}
        </div>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      cell: (tool) => (
        <span className="text-sm text-text-sub">{tool.category || '-'}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (tool) => (
        <Badge variant={tool.is_active ? 'success' : 'default'}>
          {tool.is_active ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
  ];

  if (error) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-8">
            <EmptyState
              icon={<Wrench className="h-12 w-12" />}
              title="Error loading tools"
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
          <h1 className="text-2xl font-semibold text-text-main">{t('tools')}</h1>
          <p className="text-text-sub">Manage software tools and licenses</p>
        </div>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          New Tool
        </Button>
      </div>

      <Card>
        <CardContent className="py-4">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search tools..."
            className="md:w-64"
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <SkeletonTable rows={5} columns={3} />
          ) : data?.tools?.length === 0 ? (
            <EmptyState
              icon={<Wrench className="h-12 w-12" />}
              title="No tools found"
            />
          ) : (
            <DataTable
              data={data?.tools || []}
              columns={columns}
              keyExtractor={(tool) => tool.id}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
