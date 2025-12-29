'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, FolderKanban, Clock, CheckCircle2, Wand2 } from 'lucide-react';
import { useProjects } from '@/lib/hooks/use-projects';
import { useTerminology } from '@/lib/hooks/use-terminology';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable, Column } from '@/components/ui/data-table';
import { SearchInput } from '@/components/ui/search-input';
import { Select } from '@/components/ui/select';
import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonTable } from '@/components/ui/skeleton';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalBody,
} from '@/components/ui/modal';
import { ProjectForm } from '@/components/domain/projects/project-form';
import type { Project } from '@/lib/hooks/use-projects';
import { getProjectStatusLabel, getProjectStatusVariant } from '@/lib/calculations/status';

const statusOptions = [
  { value: 'quote', label: 'Quote' },
  { value: 'queue', label: 'Queue' },
  { value: 'ready', label: 'Ready' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'review', label: 'Review' },
  { value: 'done', label: 'Done' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'cancelled', label: 'Cancelled' },
];

const typeOptions = [
  { value: 'project', label: 'Project' },
  { value: 'retainer', label: 'Retainer' },
  { value: 'internal', label: 'Internal' },
];

export default function ProjectsPage() {
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

  const { data, isLoading, error } = useProjects({
    page,
    search: search || undefined,
    status: status as any || undefined,
    type: type as any || undefined,
  });

  const columns: Column<Project>[] = [
    {
      key: 'name',
      header: t('project'),
      cell: (project) => (
        <div>
          <div className="font-medium text-text-main">{project.name}</div>
          {project.client && (
            <div className="text-sm text-text-sub">{project.client.name}</div>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (project) => (
        <Badge variant={getProjectStatusVariant(project.status as any)}>
          {getProjectStatusLabel(project.status as any)}
        </Badge>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      cell: (project) => (
        <span className="text-sm text-text-sub capitalize">{project.type}</span>
      ),
    },
    {
      key: 'tasks',
      header: t('tasks'),
      cell: (project) => (
        <span className="text-sm text-text-sub">{project.tasks_count || 0}</span>
      ),
      className: 'text-center',
    },
    {
      key: 'estimate',
      header: 'Progress',
      cell: (project) => (
        <div className="w-32">
          <div className="flex justify-between text-xs text-text-sub mb-1">
            <span>{project.calculated?.estimated_range || '-'}</span>
            <span>{project.calculated?.progress_percent || 0}%</span>
          </div>
          <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full"
              style={{ width: `${project.calculated?.progress_percent || 0}%` }}
            />
          </div>
        </div>
      ),
    },
    {
      key: 'target_date',
      header: 'Target',
      cell: (project) => (
        <span className="text-sm text-text-sub">
          {project.target_date
            ? new Date(project.target_date).toLocaleDateString()
            : '-'}
        </span>
      ),
    },
  ];

  const handleRowClick = (project: Project) => {
    router.push(`/projects/${project.id}`);
  };

  const handleCreateSuccess = () => {
    setIsCreateOpen(false);
  };

  if (error) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-8">
            <EmptyState
              icon={<FolderKanban className="h-12 w-12" />}
              title={`Error loading ${t('projects').toLowerCase()}`}
              description={`There was a problem loading the ${t('project').toLowerCase()} list. Please try again.`}
              action={
                <Button onClick={() => window.location.reload()}>Retry</Button>
              }
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  const activeCount = data?.projects.filter(
    (p) => ['ready', 'in_progress', 'review'].includes(p.status)
  ).length || 0;

  const doneCount = data?.projects.filter((p) => p.status === 'done').length || 0;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text-main">{t('projects')}</h1>
          <p className="text-text-sub">Manage your projects and retainers</p>
        </div>
        <div className="flex gap-2">
          <Link href="/projects/new">
            <Button variant="secondary">
              <Wand2 className="h-4 w-4 mr-2" />
              Use Wizard
            </Button>
          </Link>
          <Button onClick={() => setIsCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Quick Create
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <FolderKanban className="h-5 w-5 text-primary" />
              </div>
              <div>
                <div className="text-2xl font-semibold text-text-main">
                  {data?.total || 0}
                </div>
                <div className="text-sm text-text-sub">Total {t('projects')}</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10">
                <Clock className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <div className="text-2xl font-semibold text-text-main">
                  {activeCount}
                </div>
                <div className="text-sm text-text-sub">Active</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/10">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <div className="text-2xl font-semibold text-text-main">
                  {doneCount}
                </div>
                <div className="text-sm text-text-sub">Completed</div>
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
              placeholder={`Search ${t('projects').toLowerCase()}...`}
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
            <SkeletonTable rows={5} columns={5} />
          ) : data?.projects.length === 0 ? (
            <EmptyState
              icon={<FolderKanban className="h-12 w-12" />}
              title={`No ${t('projects').toLowerCase()} found`}
              description={
                search || status || type
                  ? 'Try adjusting your filters'
                  : `Get started by creating your first ${t('project').toLowerCase()}`
              }
              action={
                !search &&
                !status &&
                !type && (
                  <Button onClick={() => setIsCreateOpen(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    New {t('project')}
                  </Button>
                )
              }
            />
          ) : (
            <DataTable
              data={data?.projects || []}
              columns={columns}
              keyExtractor={(project) => project.id}
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
            <ModalTitle>Create New {t('project')}</ModalTitle>
          </ModalHeader>
          <ModalBody>
            <ProjectForm
              onSuccess={handleCreateSuccess}
              onCancel={() => setIsCreateOpen(false)}
            />
          </ModalBody>
        </ModalContent>
      </Modal>
    </div>
  );
}
