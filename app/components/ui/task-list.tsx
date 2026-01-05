'use client';

import * as React from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from './button';
import { Spinner } from './spinner';
import { cn } from '@/lib/utils/cn';

// ============================================
// TYPES
// ============================================

// Generic task type - any object with at least an id
export interface TaskLike {
  id: string;
  [key: string]: any;
}

export interface TaskListColumn<T extends TaskLike = TaskLike> {
  key: string;
  header: string;
  width?: string; // e.g., "120px", "1fr", "minmax(100px, 1fr)"
  cell: (task: T, onUpdate: (updates: Partial<T>) => void) => React.ReactNode;
  headerClassName?: string;
  cellClassName?: string;
}

export interface TaskListGroup<T extends TaskLike = TaskLike> {
  id: string;
  title: string;
  icon?: React.ReactNode;
  tasks: T[];
  collapsible?: boolean;
  defaultCollapsed?: boolean;
}

export interface TaskListProps<T extends TaskLike = TaskLike> {
  // Data - either flat tasks or grouped
  tasks?: T[];
  groups?: TaskListGroup<T>[];

  // Columns configuration
  columns: TaskListColumn<T>[];

  // Callbacks
  onTaskClick?: (task: T) => void;
  onTaskUpdate?: (taskId: string, updates: Partial<T>) => void;
  onLoadMore?: () => void;

  // Options
  showHeaders?: boolean;
  emptyMessage?: string;
  className?: string;
  hasMore?: boolean;
  isLoading?: boolean;

  // Custom rendering
  renderGroupHeader?: (
    group: TaskListGroup<T>,
    isCollapsed: boolean,
    toggleCollapse: () => void
  ) => React.ReactNode;
  renderGroupFooter?: (group: TaskListGroup<T>) => React.ReactNode;

  // Wrapper for task rows (e.g., for drag-and-drop)
  wrapTask?: (task: T, children: React.ReactNode) => React.ReactNode;

  // Wrapper for group content (e.g., for SortableContext)
  wrapGroupContent?: (group: TaskListGroup<T>, children: React.ReactNode) => React.ReactNode;
}

// ============================================
// TASK LIST COMPONENT
// ============================================

export function TaskList<T extends TaskLike = TaskLike>({
  tasks,
  groups,
  columns,
  onTaskClick,
  onTaskUpdate,
  onLoadMore,
  showHeaders = true,
  emptyMessage = 'No tasks',
  className,
  hasMore = false,
  isLoading = false,
  renderGroupHeader,
  renderGroupFooter,
  wrapTask,
  wrapGroupContent,
}: TaskListProps<T>) {
  const [collapsedGroups, setCollapsedGroups] = React.useState<Set<string>>(() => {
    const initial = new Set<string>();
    groups?.forEach((group) => {
      if (group.defaultCollapsed) {
        initial.add(group.id);
      }
    });
    return initial;
  });

  const toggleGroup = (groupId: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  // Build grid template columns from column widths
  const gridTemplateColumns = columns
    .map((col) => col.width || '1fr')
    .join(' ');

  // Render a single task row
  const renderRow = (task: T) => {
    const handleUpdate = (updates: Partial<T>) => {
      onTaskUpdate?.(task.id, updates);
    };

    const rowContent = (
      <div
        key={task.id}
        data-task-row
        className={cn(
          'grid items-center gap-4 px-4 py-3 border-b border-border',
          'transition-colors hover:bg-surface-alt cursor-pointer group'
        )}
        style={{ gridTemplateColumns }}
        onClick={() => onTaskClick?.(task)}
      >
        {columns.map((column) => (
          <div
            key={column.key}
            className={cn('min-w-0', column.cellClassName)}
            onClick={(e) => {
              // Prevent row click when clicking on interactive elements
              if ((e.target as HTMLElement).closest('button, input, select, [role="button"]')) {
                e.stopPropagation();
              }
            }}
          >
            {column.cell(task, handleUpdate)}
          </div>
        ))}
      </div>
    );

    // Wrap in custom wrapper if provided (e.g., for drag-and-drop)
    if (wrapTask) {
      return wrapTask(task, rowContent);
    }

    return rowContent;
  };

  // Render group header (default implementation)
  const defaultRenderGroupHeader = (group: TaskListGroup<T>) => {
    const isCollapsed = collapsedGroups.has(group.id);
    const taskCount = group.tasks.length;

    return (
      <div
        key={`header-${group.id}`}
        className={cn(
          'flex items-center gap-2 px-4 py-2 bg-surface-alt border-b border-border',
          group.collapsible && 'cursor-pointer hover:bg-surface-2'
        )}
        onClick={() => group.collapsible && toggleGroup(group.id)}
      >
        {group.collapsible && (
          <span className="text-text-sub">
            {isCollapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </span>
        )}
        {group.icon && <span className="flex-shrink-0">{group.icon}</span>}
        <span className="font-medium text-text-main">{group.title}</span>
        <span className="text-sm text-text-sub">({taskCount} task{taskCount !== 1 ? 's' : ''})</span>
      </div>
    );
  };

  // Calculate total tasks
  const totalTasks = groups
    ? groups.reduce((sum, g) => sum + g.tasks.length, 0)
    : (tasks?.length || 0);

  // Empty state - only show if no groups AND no tasks
  // If we have groups (even empty ones), we want to show them so users can add tasks
  const hasGroups = groups && groups.length > 0;
  if (totalTasks === 0 && !hasGroups) {
    return (
      <div className={cn('rounded-lg border border-border-warm', className)}>
        <div className="px-4 py-8 text-center text-text-sub">
          {emptyMessage}
        </div>
      </div>
    );
  }

  return (
    <div className={cn('rounded-lg border border-border-warm', className)}>
      {/* Header row */}
      {showHeaders && (
        <div
          className="grid items-center gap-4 px-4 py-2 bg-surface-alt border-b border-border-warm"
          style={{ gridTemplateColumns }}
        >
          {columns.map((column) => (
            <div
              key={column.key}
              className={cn(
                'text-xs font-medium text-text-sub uppercase tracking-wider',
                column.headerClassName
              )}
            >
              {column.header}
            </div>
          ))}
        </div>
      )}

      {/* Grouped content */}
      {groups ? (
        <div>
          {groups.map((group) => {
            const isCollapsed = collapsedGroups.has(group.id);

            const tasksContent = (
              <div>
                {group.tasks.length === 0 ? (
                  <div className="px-4 py-4 text-sm text-text-sub italic border-b border-border">
                    No tasks in this group
                  </div>
                ) : (
                  group.tasks.map((task) => renderRow(task))
                )}
              </div>
            );

            return (
              <div key={group.id}>
                {renderGroupHeader
                  ? renderGroupHeader(group, isCollapsed, () => toggleGroup(group.id))
                  : defaultRenderGroupHeader(group)}
                {!isCollapsed && (
                  <>
                    {wrapGroupContent
                      ? wrapGroupContent(group, tasksContent)
                      : tasksContent}
                    {renderGroupFooter && renderGroupFooter(group)}
                  </>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        /* Flat list */
        <div>
          {tasks?.map((task) => renderRow(task))}
        </div>
      )}

      {/* Load more button */}
      {hasMore && (
        <div className="flex justify-center px-4 py-3 border-t border-border bg-surface">
          <Button
            variant="ghost"
            size="sm"
            onClick={onLoadMore}
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Spinner size="sm" className="mr-2" />
                Loading...
              </>
            ) : (
              'Load more tasks'
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
