'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Clock,
  Download,
  Filter,
  BarChart3,
  DollarSign,
  Users,
  Briefcase,
} from 'lucide-react';
import { apiClient } from '@/lib/api/client';
import { useTimeReports, TimeEntry, TimeReportFilters } from '@/lib/hooks/use-time-reports';
import { useClients } from '@/lib/hooks/use-clients';
import { useProjects } from '@/lib/hooks/use-projects';
import { useUsers } from '@/lib/hooks/use-users';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { DataTable, Column } from '@/components/ui/data-table';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { generateCSV, downloadCSV, formatHours, formatDate } from '@/lib/utils/export';

type GroupBy = 'day' | 'week' | 'project' | 'user' | 'client';

export default function TimeReportsPage() {
  // Default to current month
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const lastOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

  const [startDate, setStartDate] = useState(formatDateForInput(firstOfMonth));
  const [endDate, setEndDate] = useState(formatDateForInput(lastOfMonth));
  const [clientId, setClientId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [userId, setUserId] = useState('');
  const [groupBy, setGroupBy] = useState<GroupBy>('day');
  const [showFilters, setShowFilters] = useState(false);

  // Fetch filter options
  const { data: clientsData } = useClients({ limit: 100 });
  const { data: projectsData } = useProjects({ limit: 100, client_id: clientId || undefined });
  const { data: usersData } = useUsers();

  // Build filters
  const filters: TimeReportFilters = useMemo(() => ({
    start: startDate,
    end: endDate,
    client_id: clientId || undefined,
    project_id: projectId || undefined,
    user_id: userId || undefined,
    group_by: groupBy,
  }), [startDate, endDate, clientId, projectId, userId, groupBy]);

  // Fetch report data
  const { data, isLoading, error } = useTimeReports(filters);

  // Build options for selects
  const clientOptions = useMemo(() =>
    clientsData?.clients.map(c => ({ value: c.id, label: c.name })) || [],
    [clientsData]
  );

  const projectOptions = useMemo(() =>
    projectsData?.projects.map(p => ({ value: p.id, label: p.name })) || [],
    [projectsData]
  );

  const userOptions = useMemo(() =>
    usersData?.users.map(u => ({ value: u.id, label: u.name })) || [],
    [usersData]
  );

  const groupByOptions = [
    { value: 'day', label: 'Day' },
    { value: 'week', label: 'Week' },
    { value: 'project', label: 'Project' },
    { value: 'user', label: 'User' },
    { value: 'client', label: 'Client' },
  ];

  // Quick date presets
  const setDatePreset = (preset: 'today' | 'week' | 'month' | 'quarter') => {
    const now = new Date();
    let start: Date;
    let end: Date = now;

    switch (preset) {
      case 'today':
        start = now;
        break;
      case 'week':
        start = new Date(now);
        start.setDate(now.getDate() - now.getDay()); // Start of week (Sunday)
        break;
      case 'month':
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        break;
      case 'quarter':
        const quarter = Math.floor(now.getMonth() / 3);
        start = new Date(now.getFullYear(), quarter * 3, 1);
        end = new Date(now.getFullYear(), quarter * 3 + 3, 0);
        break;
    }

    setStartDate(formatDateForInput(start));
    setEndDate(formatDateForInput(end));
  };

  // Export to CSV
  const handleExport = () => {
    if (!data?.entries.length) return;

    const csvData = data.entries.map(entry => ({
      date: formatDate(entry.started_at),
      user: entry.user?.name || 'Unknown',
      client: entry.project?.client?.name || 'No Client',
      project: entry.project?.name || 'No Project',
      task: entry.task?.title || '',
      description: entry.description || '',
      hours: (entry.duration / 60).toFixed(2),
      billable: entry.is_billable ? 'Yes' : 'No',
      rate: entry.hourly_rate?.toString() || '',
    }));

    const columns = [
      { key: 'date', label: 'Date' },
      { key: 'user', label: 'User' },
      { key: 'client', label: 'Client' },
      { key: 'project', label: 'Project' },
      { key: 'task', label: 'Task' },
      { key: 'description', label: 'Description' },
      { key: 'hours', label: 'Hours' },
      { key: 'billable', label: 'Billable' },
      { key: 'rate', label: 'Rate' },
    ];

    const csv = generateCSV(csvData, columns);
    const filename = `time-report_${startDate}_to_${endDate}.csv`;
    downloadCSV(csv, filename);
  };

  // Table columns
  const columns: Column<TimeEntry>[] = [
    {
      key: 'date',
      header: 'Date',
      cell: (entry) => formatDate(entry.started_at),
    },
    {
      key: 'user',
      header: 'User',
      cell: (entry) => entry.user?.name || 'Unknown',
    },
    {
      key: 'project',
      header: 'Project',
      cell: (entry) => (
        <div>
          <div className="font-medium">{entry.project?.name || 'No Project'}</div>
          {entry.project?.client && (
            <div className="text-xs text-text-sub">{entry.project.client.name}</div>
          )}
        </div>
      ),
    },
    {
      key: 'description',
      header: 'Description',
      cell: (entry) => (
        <div className="max-w-xs truncate">
          {entry.task?.title && (
            <span className="text-text-sub">{entry.task.title}: </span>
          )}
          {entry.description || '-'}
        </div>
      ),
    },
    {
      key: 'hours',
      header: 'Hours',
      cell: (entry) => formatHours(entry.duration),
      className: 'text-right',
    },
    {
      key: 'billable',
      header: 'Billable',
      cell: (entry) => (
        <span className={entry.is_billable ? 'text-green-600' : 'text-text-sub'}>
          {entry.is_billable ? 'Yes' : 'No'}
        </span>
      ),
      className: 'text-center',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text-main flex items-center gap-2">
            <BarChart3 className="h-6 w-6" />
            Time Reports
          </h1>
          <p className="text-text-sub">Analyze time tracking data</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
          >
            <Filter className="h-4 w-4 mr-2" />
            Filters
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleExport}
            disabled={!data?.entries.length}
          >
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Date Range & Quick Presets */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex gap-2">
              <Input
                type="date"
                label="Start Date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-40"
              />
              <Input
                type="date"
                label="End Date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-40"
              />
            </div>

            <div className="flex gap-1">
              <Button variant="ghost" size="sm" onClick={() => setDatePreset('today')}>
                Today
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setDatePreset('week')}>
                This Week
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setDatePreset('month')}>
                This Month
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setDatePreset('quarter')}>
                This Quarter
              </Button>
            </div>

            <div className="ml-auto">
              <Select
                label="Group By"
                options={groupByOptions}
                value={groupBy}
                onChange={(v) => setGroupBy(v as GroupBy)}
                className="w-32"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Filters Panel */}
      {showFilters && (
        <Card>
          <CardContent className="py-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Select
                label="Client"
                options={clientOptions}
                value={clientId}
                onChange={(v) => {
                  setClientId(v);
                  setProjectId(''); // Reset project when client changes
                }}
                placeholder="All Clients"
              />
              <Select
                label="Project"
                options={projectOptions}
                value={projectId}
                onChange={setProjectId}
                placeholder="All Projects"
              />
              <Select
                label="User"
                options={userOptions}
                value={userId}
                onChange={setUserId}
                placeholder="All Users"
              />
            </div>
            <div className="mt-4 flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setClientId('');
                  setProjectId('');
                  setUserId('');
                }}
              >
                Clear Filters
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary Cards */}
      {data?.totals && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="py-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-100 text-blue-600">
                  <Clock className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-text-main">
                    {data.totals.totalHours}
                  </div>
                  <div className="text-sm text-text-sub">Total Hours</div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="py-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-green-100 text-green-600">
                  <DollarSign className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-text-main">
                    {data.totals.billableHours}
                  </div>
                  <div className="text-sm text-text-sub">
                    Billable ({data.totals.billablePercent}%)
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="py-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-purple-100 text-purple-600">
                  <Users className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-text-main">
                    {data.totals.entryCount}
                  </div>
                  <div className="text-sm text-text-sub">Time Entries</div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="py-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-amber-100 text-amber-600">
                  <Briefcase className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-text-main">
                    {data.grouped.length}
                  </div>
                  <div className="text-sm text-text-sub">
                    {groupBy === 'day' ? 'Days' :
                     groupBy === 'week' ? 'Weeks' :
                     groupBy === 'project' ? 'Projects' :
                     groupBy === 'user' ? 'Users' : 'Clients'}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Grouped Summary */}
      {data?.grouped && data.grouped.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              Breakdown by {groupBy.charAt(0).toUpperCase() + groupBy.slice(1)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data.grouped.slice(0, 10).map((group) => {
                const percent = data.totals.totalMinutes > 0
                  ? (group.minutes / data.totals.totalMinutes) * 100
                  : 0;

                return (
                  <div key={group.key} className="flex items-center gap-4">
                    <div className="w-48 truncate font-medium text-text-main">
                      {group.label}
                    </div>
                    <div className="flex-1">
                      <div className="h-3 bg-background-light rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full transition-all"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    </div>
                    <div className="w-20 text-right text-sm font-medium text-text-main">
                      {group.hours} hrs
                    </div>
                    <div className="w-12 text-right text-sm text-text-sub">
                      {Math.round(percent)}%
                    </div>
                  </div>
                );
              })}
              {data.grouped.length > 10 && (
                <div className="text-sm text-text-sub text-center pt-2">
                  And {data.grouped.length - 10} more...
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Detail Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Time Entries</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Spinner size="lg" />
            </div>
          ) : error ? (
            <EmptyState
              icon={<Clock className="h-12 w-12" />}
              title="Error loading data"
              description="There was a problem loading the time report."
              action={<Button onClick={() => window.location.reload()}>Retry</Button>}
            />
          ) : !data?.entries.length ? (
            <EmptyState
              icon={<Clock className="h-12 w-12" />}
              title="No time entries"
              description="No time entries found for the selected date range and filters."
            />
          ) : (
            <DataTable
              data={data.entries}
              columns={columns}
              keyExtractor={(entry) => entry.id}
              emptyMessage="No time entries found"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function formatDateForInput(date: Date): string {
  return date.toISOString().split('T')[0];
}
