'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  Clock,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  Edit2,
  CalendarRange,
  Building2,
  FolderKanban,
  Layers,
} from 'lucide-react';
import { useTimeEntries, useDeleteTimeEntry, TimeEntry } from '@/lib/hooks/use-time-entries';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Spinner } from '@/components/ui/spinner';
import { Input } from '@/components/ui/input';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalBody,
} from '@/components/ui/modal';
import { TimeEntryForm } from '@/components/domain/time/time-entry-form';
import {
  formatDurationMinutes,
  formatShortDate,
  formatLongDate,
  getStartOfWeek,
  getWeekDates,
  isToday,
} from '@/lib/utils/time';

type ViewMode = 'day' | 'week' | 'month' | 'custom';
type GroupMode = 'none' | 'client' | 'project';

function getMonthDates(date: Date): Date[] {
  const year = date.getFullYear();
  const month = date.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const dates: Date[] = [];

  for (let d = new Date(firstDay); d <= lastDay; d.setDate(d.getDate() + 1)) {
    dates.push(new Date(d));
  }

  return dates;
}

function formatMonthYear(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function formatInputDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

export default function ChroniclesPage() {
  const searchParams = useSearchParams();
  const projectIdParam = searchParams.get('project_id');

  const [viewMode, setViewMode] = React.useState<ViewMode>('day');
  const [groupMode, setGroupMode] = React.useState<GroupMode>('none');
  const [selectedDate, setSelectedDate] = React.useState(() => new Date());
  const [customStartDate, setCustomStartDate] = React.useState<Date>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d;
  });
  const [customEndDate, setCustomEndDate] = React.useState<Date>(() => new Date());
  const [isCreateOpen, setIsCreateOpen] = React.useState(false);
  const [editingEntry, setEditingEntry] = React.useState<TimeEntry | null>(null);

  const deleteEntry = useDeleteTimeEntry();

  // Calculate date range based on view mode
  const dateRange = React.useMemo(() => {
    if (viewMode === 'day') {
      const start = new Date(selectedDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(selectedDate);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    } else if (viewMode === 'week') {
      const start = getStartOfWeek();
      // Adjust to the selected week
      const diff = Math.floor((selectedDate.getTime() - new Date().getTime()) / (7 * 24 * 60 * 60 * 1000));
      start.setDate(start.getDate() + diff * 7);
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    } else if (viewMode === 'month') {
      const year = selectedDate.getFullYear();
      const month = selectedDate.getMonth();
      const start = new Date(year, month, 1);
      start.setHours(0, 0, 0, 0);
      const end = new Date(year, month + 1, 0);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    } else {
      // Custom range
      const start = new Date(customStartDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(customEndDate);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
  }, [viewMode, selectedDate, customStartDate, customEndDate]);

  const { data, isLoading, error } = useTimeEntries({
    start_date: dateRange.start.toISOString(),
    end_date: dateRange.end.toISOString(),
    project_id: projectIdParam || undefined,
    limit: 500,
  });

  // Group entries by date
  const entriesByDate = React.useMemo(() => {
    if (!data?.entries) return new Map<string, TimeEntry[]>();

    const grouped = new Map<string, TimeEntry[]>();
    data.entries.forEach((entry) => {
      const dateKey = new Date(entry.started_at).toDateString();
      if (!grouped.has(dateKey)) {
        grouped.set(dateKey, []);
      }
      grouped.get(dateKey)!.push(entry);
    });
    return grouped;
  }, [data?.entries]);

  // Group entries by client or project
  const groupedEntries = React.useMemo(() => {
    if (!data?.entries || groupMode === 'none') return null;

    const groups = new Map<string, { name: string; id: string | null; entries: TimeEntry[]; totalMinutes: number }>();

    data.entries.forEach((entry) => {
      let key: string;
      let name: string;
      let id: string | null;

      if (groupMode === 'client') {
        // Group by client (via project)
        const client = entry.project?.client;
        key = client?.id || 'no-client';
        name = client?.name || 'No Client';
        id = client?.id || null;
      } else {
        // Group by project
        key = entry.project?.id || 'no-project';
        name = entry.project?.name || 'No Project';
        id = entry.project?.id || null;
      }

      if (!groups.has(key)) {
        groups.set(key, { name, id, entries: [], totalMinutes: 0 });
      }
      const group = groups.get(key)!;
      group.entries.push(entry);
      group.totalMinutes += entry.duration;
    });

    // Sort by total time descending
    return Array.from(groups.values()).sort((a, b) => b.totalMinutes - a.totalMinutes);
  }, [data?.entries, groupMode]);

  // Calculate totals
  const totalMinutes = data?.entries.reduce((sum, e) => sum + e.duration, 0) || 0;
  const billableMinutes = data?.entries.filter((e) => e.is_billable).reduce((sum, e) => sum + e.duration, 0) || 0;

  const navigateDate = (direction: 'prev' | 'next') => {
    const newDate = new Date(selectedDate);
    if (viewMode === 'day') {
      newDate.setDate(newDate.getDate() + (direction === 'next' ? 1 : -1));
    } else if (viewMode === 'week') {
      newDate.setDate(newDate.getDate() + (direction === 'next' ? 7 : -7));
    } else if (viewMode === 'month') {
      newDate.setMonth(newDate.getMonth() + (direction === 'next' ? 1 : -1));
    }
    setSelectedDate(newDate);
  };

  const goToToday = () => {
    setSelectedDate(new Date());
  };

  const handleDelete = async (id: string) => {
    if (confirm('Delete this time entry?')) {
      await deleteEntry.mutateAsync(id);
    }
  };

  const handleCreateSuccess = () => {
    setIsCreateOpen(false);
    setEditingEntry(null);
  };

  // Get display dates for current view
  const displayDates = React.useMemo(() => {
    if (viewMode === 'week') {
      return getWeekDates(dateRange.start);
    } else if (viewMode === 'month') {
      return getMonthDates(selectedDate);
    } else if (viewMode === 'custom') {
      // Get all dates in custom range
      const dates: Date[] = [];
      const current = new Date(dateRange.start);
      while (current <= dateRange.end) {
        dates.push(new Date(current));
        current.setDate(current.getDate() + 1);
      }
      return dates;
    }
    return [];
  }, [viewMode, dateRange, selectedDate]);

  // Get date range label
  const dateRangeLabel = React.useMemo(() => {
    switch (viewMode) {
      case 'day':
        return formatLongDate(selectedDate);
      case 'week':
        return `${formatShortDate(dateRange.start)} - ${formatShortDate(dateRange.end)}`;
      case 'month':
        return formatMonthYear(selectedDate);
      case 'custom':
        return `${formatShortDate(dateRange.start)} - ${formatShortDate(dateRange.end)}`;
    }
  }, [viewMode, selectedDate, dateRange]);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text-main">Chronicles</h1>
          <p className="text-text-sub">Track and review your time entries</p>
        </div>
        <Button onClick={() => setIsCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add Time Entry
        </Button>
      </div>

      {/* View Controls */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-col gap-4">
            {/* Top row: View mode and navigation */}
            <div className="flex flex-col md:flex-row items-center justify-between gap-4">
              {/* View Mode Toggle */}
              <div className="flex items-center gap-1 bg-surface-2 p-1 rounded-lg">
                <Button
                  variant={viewMode === 'day' ? 'primary' : 'ghost'}
                  size="sm"
                  onClick={() => setViewMode('day')}
                >
                  Day
                </Button>
                <Button
                  variant={viewMode === 'week' ? 'primary' : 'ghost'}
                  size="sm"
                  onClick={() => setViewMode('week')}
                >
                  Week
                </Button>
                <Button
                  variant={viewMode === 'month' ? 'primary' : 'ghost'}
                  size="sm"
                  onClick={() => setViewMode('month')}
                >
                  Month
                </Button>
                <Button
                  variant={viewMode === 'custom' ? 'primary' : 'ghost'}
                  size="sm"
                  onClick={() => setViewMode('custom')}
                >
                  <CalendarRange className="h-4 w-4 mr-1" />
                  Custom
                </Button>
              </div>

              {/* Group Mode Toggle */}
              <div className="flex items-center gap-1 bg-surface-2 p-1 rounded-lg">
                <span className="text-xs text-text-sub px-2">Group:</span>
                <Button
                  variant={groupMode === 'none' ? 'primary' : 'ghost'}
                  size="sm"
                  onClick={() => setGroupMode('none')}
                  title="No grouping"
                >
                  <Layers className="h-4 w-4" />
                </Button>
                <Button
                  variant={groupMode === 'client' ? 'primary' : 'ghost'}
                  size="sm"
                  onClick={() => setGroupMode('client')}
                  title="Group by client"
                >
                  <Building2 className="h-4 w-4" />
                </Button>
                <Button
                  variant={groupMode === 'project' ? 'primary' : 'ghost'}
                  size="sm"
                  onClick={() => setGroupMode('project')}
                  title="Group by project"
                >
                  <FolderKanban className="h-4 w-4" />
                </Button>
              </div>

              {/* Date Navigation - only show for non-custom views */}
              {viewMode !== 'custom' && (
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={() => navigateDate('prev')}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={goToToday}>
                    Today
                  </Button>
                  <span className="text-sm font-medium text-text-main min-w-[200px] text-center">
                    {dateRangeLabel}
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => navigateDate('next')}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              )}

              {/* Summary */}
              <div className="flex items-center gap-4 text-sm">
                <div className="flex items-center gap-1">
                  <Clock className="h-4 w-4 text-text-sub" />
                  <span className="text-text-main font-medium">
                    {formatDurationMinutes(totalMinutes)}
                  </span>
                  <span className="text-text-sub">total</span>
                </div>
                <div className="text-text-sub">
                  {formatDurationMinutes(billableMinutes)} billable
                </div>
              </div>
            </div>

            {/* Custom date range controls */}
            {viewMode === 'custom' && (
              <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-border">
                <div className="flex items-center gap-2">
                  <label className="text-sm text-text-sub">From:</label>
                  <Input
                    type="date"
                    value={formatInputDate(customStartDate)}
                    onChange={(e) => setCustomStartDate(new Date(e.target.value))}
                    className="w-auto"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-sm text-text-sub">To:</label>
                  <Input
                    type="date"
                    value={formatInputDate(customEndDate)}
                    onChange={(e) => setCustomEndDate(new Date(e.target.value))}
                    className="w-auto"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      const end = new Date();
                      const start = new Date();
                      start.setDate(start.getDate() - 7);
                      setCustomStartDate(start);
                      setCustomEndDate(end);
                    }}
                  >
                    Last 7 days
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      const end = new Date();
                      const start = new Date();
                      start.setDate(start.getDate() - 30);
                      setCustomStartDate(start);
                      setCustomEndDate(end);
                    }}
                  >
                    Last 30 days
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      const end = new Date();
                      const start = new Date();
                      start.setDate(start.getDate() - 90);
                      setCustomStartDate(start);
                      setCustomEndDate(end);
                    }}
                  >
                    Last 90 days
                  </Button>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Time Entries */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      ) : error ? (
        <Card>
          <CardContent className="py-8">
            <EmptyState
              icon={<Clock className="h-12 w-12" />}
              title="Error loading time entries"
              description="There was a problem loading your time entries."
              action={<Button onClick={() => window.location.reload()}>Retry</Button>}
            />
          </CardContent>
        </Card>
      ) : data?.entries.length === 0 ? (
        <Card>
          <CardContent className="py-8">
            <EmptyState
              icon={<Clock className="h-12 w-12" />}
              title="No time entries"
              description={`No time logged for this ${viewMode === 'custom' ? 'period' : viewMode}. Start a timer or add a manual entry.`}
              action={
                <Button onClick={() => setIsCreateOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Time Entry
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : groupMode !== 'none' && groupedEntries ? (
        // Grouped view - by client or project
        <div className="space-y-4">
          {groupedEntries.map((group) => (
            <Card key={group.id || 'ungrouped'}>
              <CardHeader className="py-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    {groupMode === 'client' ? (
                      <Building2 className="h-4 w-4" />
                    ) : (
                      <FolderKanban className="h-4 w-4" />
                    )}
                    {group.id ? (
                      <Link
                        href={groupMode === 'client' ? `/clients/${group.id}` : `/projects/${group.id}`}
                        className="hover:text-primary"
                      >
                        {group.name}
                      </Link>
                    ) : (
                      <span className="text-text-sub">{group.name}</span>
                    )}
                    <span className="text-xs text-text-sub font-normal">
                      ({group.entries.length} {group.entries.length === 1 ? 'entry' : 'entries'})
                    </span>
                  </CardTitle>
                  <span className="text-sm font-medium text-text-main">
                    {formatDurationMinutes(group.totalMinutes)}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="space-y-2">
                  {group.entries.map((entry) => (
                    <TimeEntryRow
                      key={entry.id}
                      entry={entry}
                      onEdit={() => setEditingEntry(entry)}
                      onDelete={() => handleDelete(entry.id)}
                      showProject={groupMode === 'client'}
                      showClient={groupMode === 'project'}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : viewMode === 'day' ? (
        // Day view - list all entries
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              {formatLongDate(selectedDate)}
              {isToday(selectedDate) && (
                <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded">
                  Today
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data?.entries.map((entry) => (
                <TimeEntryRow
                  key={entry.id}
                  entry={entry}
                  onEdit={() => setEditingEntry(entry)}
                  onDelete={() => handleDelete(entry.id)}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      ) : (
        // Week, Month, or Custom view - show daily breakdown
        <div className="space-y-4">
          {displayDates.map((date) => {
            const dateKey = date.toDateString();
            const dayEntries = entriesByDate.get(dateKey) || [];
            const dayTotal = dayEntries.reduce((sum, e) => sum + e.duration, 0);

            // Skip days with no entries in month/custom view to reduce clutter
            if ((viewMode === 'month' || viewMode === 'custom') && dayEntries.length === 0) {
              return null;
            }

            return (
              <Card key={dateKey}>
                <CardHeader className="py-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Calendar className="h-4 w-4" />
                      {formatShortDate(date)}
                      {isToday(date) && (
                        <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded">
                          Today
                        </span>
                      )}
                    </CardTitle>
                    <span className="text-sm font-medium text-text-main">
                      {formatDurationMinutes(dayTotal)}
                    </span>
                  </div>
                </CardHeader>
                {dayEntries.length > 0 && (
                  <CardContent className="pt-0">
                    <div className="space-y-2">
                      {dayEntries.map((entry) => (
                        <TimeEntryRow
                          key={entry.id}
                          entry={entry}
                          onEdit={() => setEditingEntry(entry)}
                          onDelete={() => handleDelete(entry.id)}
                        />
                      ))}
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}

          {/* Show empty days notice for week view */}
          {viewMode === 'week' && displayDates.every((d) => !entriesByDate.has(d.toDateString())) && (
            <Card>
              <CardContent className="py-8">
                <EmptyState
                  icon={<Clock className="h-12 w-12" />}
                  title="No time entries this week"
                  description="Start a timer or add a manual entry."
                  action={
                    <Button onClick={() => setIsCreateOpen(true)}>
                      <Plus className="h-4 w-4 mr-2" />
                      Add Time Entry
                    </Button>
                  }
                />
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Create/Edit Modal */}
      <Modal
        open={isCreateOpen || !!editingEntry}
        onOpenChange={(open) => {
          if (!open) {
            setIsCreateOpen(false);
            setEditingEntry(null);
          }
        }}
      >
        <ModalContent size="md">
          <ModalHeader>
            <ModalTitle>{editingEntry ? 'Edit Time Entry' : 'Add Time Entry'}</ModalTitle>
          </ModalHeader>
          <ModalBody>
            <TimeEntryForm
              entry={editingEntry}
              defaultDate={selectedDate}
              onSuccess={handleCreateSuccess}
              onCancel={() => {
                setIsCreateOpen(false);
                setEditingEntry(null);
              }}
            />
          </ModalBody>
        </ModalContent>
      </Modal>
    </div>
  );
}

function TimeEntryRow({
  entry,
  onEdit,
  onDelete,
  showProject = true,
  showClient = false,
}: {
  entry: TimeEntry;
  onEdit: () => void;
  onDelete: () => void;
  showProject?: boolean;
  showClient?: boolean;
}) {
  return (
    <div className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-surface-2 transition-colors group">
      <div className="flex items-center gap-4 flex-1 min-w-0">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {entry.task ? (
              <Link
                href={`/tasks/${entry.task.id}`}
                className="font-medium text-text-main hover:text-primary truncate"
              >
                {entry.task.title}
              </Link>
            ) : (
              <span className="text-text-sub italic">No task</span>
            )}
          </div>
          <div className="flex items-center gap-2 text-sm text-text-sub">
            {showClient && entry.project?.client && (
              <Link
                href={`/clients/${entry.project.client.id}`}
                className="hover:text-primary"
              >
                {entry.project.client.name}
              </Link>
            )}
            {showProject && entry.project && (
              <Link
                href={`/projects/${entry.project.id}`}
                className="hover:text-primary"
              >
                {entry.project.name}
              </Link>
            )}
            {entry.description && (
              <span className="truncate">{entry.description}</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 text-sm text-text-sub">
          {new Date(entry.started_at).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
          {entry.ended_at && (
            <>
              <span>-</span>
              {new Date(entry.ended_at).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 ml-4">
        <span className="font-medium text-text-main tabular-nums">
          {formatDurationMinutes(entry.duration)}
        </span>
        {!entry.is_billable && (
          <span className="text-xs text-text-sub bg-surface-2 px-1.5 py-0.5 rounded">
            Non-billable
          </span>
        )}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button variant="ghost" size="sm" onClick={onEdit} className="h-7 w-7 p-0">
            <Edit2 className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" onClick={onDelete} className="h-7 w-7 p-0 text-red-500 hover:text-red-600">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
