'use client';

import * as React from 'react';
import Link from 'next/link';
import { Calendar, ExternalLink } from 'lucide-react';
import { Avatar } from './avatar';
import { Badge } from './badge';
import { Tooltip } from './tooltip';
import {
  TaskStatusInlineSelect,
  PriorityInlineSelect,
  EnergyInlineSelect,
  MysteryInlineSelect,
  BatteryInlineSelect,
  formatMinutes,
  calculateTimeRange,
} from './field-selects';
import { InlineUserSelect } from './user-select';
import {
  getTaskStatusLabel,
  getTaskStatusVariant,
  getPriorityLabel,
  getPriorityVariant,
} from '@/lib/calculations/status';
import { formatDuration, getBatteryImpactLabel, getBatteryImpactVariant } from '@/lib/calculations/energy';
import type { TaskListColumn } from './task-list';
import type { Task } from '@/lib/hooks/use-tasks';

// ============================================
// INLINE TEXT COMPONENT
// ============================================

interface InlineTextProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
}

function InlineText({ value, onChange, className = '', placeholder = 'Click to edit...' }: InlineTextProps) {
  const [isEditing, setIsEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  React.useEffect(() => {
    setDraft(value);
  }, [value]);

  const handleSave = () => {
    if (draft.trim() && draft.trim() !== value) {
      onChange(draft.trim());
    } else {
      setDraft(value);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') {
      setDraft(value);
      setIsEditing(false);
    }
  };

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={handleSave}
        onKeyDown={handleKeyDown}
        className={`bg-transparent border-b-2 border-primary outline-none w-full ${className}`}
      />
    );
  }

  return (
    <span
      onClick={(e) => {
        e.stopPropagation();
        setDraft(value);
        setIsEditing(true);
      }}
      className={`cursor-pointer hover:bg-surface-alt px-1 -mx-1 rounded transition-colors ${className}`}
    >
      {value || <span className="text-text-sub italic">{placeholder}</span>}
    </span>
  );
}

// ============================================
// COLUMN HELPER TYPES
// ============================================

interface TitleColumnOptions {
  editable?: boolean;
  showProject?: boolean;
}

interface EditableColumnOptions {
  editable?: boolean;
}

// ============================================
// COLUMN HELPERS
// ============================================

/**
 * Title column - shows task title with optional project name
 */
export function titleColumn(options?: TitleColumnOptions): TaskListColumn {
  return {
    key: 'title',
    header: 'Quest',
    width: 'minmax(200px, 2fr)',
    cell: (task, onUpdate) => (
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {options?.editable ? (
            <InlineText
              value={task.title}
              onChange={(title) => onUpdate({ title })}
              className="font-medium text-text-main truncate"
            />
          ) : (
            <span className="font-medium text-text-main truncate">{task.title}</span>
          )}
        </div>
        {options?.showProject && task.project && (
          <div className="text-sm text-text-sub truncate">{task.project.name}</div>
        )}
      </div>
    ),
  };
}

/**
 * Status column with inline select
 */
export function statusColumn(options?: EditableColumnOptions): TaskListColumn {
  return {
    key: 'status',
    header: 'Status',
    width: '120px',
    cell: (task, onUpdate) => {
      if (options?.editable) {
        return (
          <Tooltip content="Status">
            <div>
              <TaskStatusInlineSelect
                value={task.status}
                onChange={(status) => onUpdate({ status })}
              />
            </div>
          </Tooltip>
        );
      }
      return (
        <Badge variant={getTaskStatusVariant(task.status as any)}>
          {getTaskStatusLabel(task.status as any)}
        </Badge>
      );
    },
  };
}

/**
 * Priority column with inline select
 */
export function priorityColumn(options?: EditableColumnOptions): TaskListColumn {
  return {
    key: 'priority',
    header: 'Priority',
    width: '100px',
    cell: (task, onUpdate) => {
      if (options?.editable) {
        return (
          <Tooltip content="Priority">
            <div>
              <PriorityInlineSelect
                value={task.priority}
                onChange={(priority) => onUpdate({ priority })}
              />
            </div>
          </Tooltip>
        );
      }
      return (
        <Badge variant={getPriorityVariant(task.priority)}>
          {getPriorityLabel(task.priority)}
        </Badge>
      );
    },
  };
}

/**
 * Assignee column with inline user select
 */
export function assigneeColumn(options?: EditableColumnOptions): TaskListColumn {
  return {
    key: 'assignee',
    header: 'Assignee',
    width: '160px',
    cell: (task, onUpdate) => {
      if (options?.editable) {
        return (
          <div className="flex items-center gap-2">
            {task.assignee ? (
              <Avatar
                src={task.assignee.avatar_url}
                name={task.assignee.name}
                size="xs"
              />
            ) : (
              <div className="h-5 w-5 rounded-full bg-surface-alt flex-shrink-0" />
            )}
            <InlineUserSelect
              value={task.assignee_id || null}
              onChange={(assignee_id) => onUpdate({ assignee_id })}
              displayValue={task.assignee?.name}
              placeholder="Unassigned"
            />
          </div>
        );
      }
      return (
        <div className="flex items-center gap-2 text-sm text-text-sub">
          {task.assignee ? (
            <>
              <Avatar
                src={task.assignee.avatar_url}
                name={task.assignee.name}
                size="xs"
              />
              <span>{task.assignee.name}</span>
            </>
          ) : (
            '-'
          )}
        </div>
      );
    },
  };
}

/**
 * Energy estimate column with inline select
 */
export function energyColumn(options?: EditableColumnOptions): TaskListColumn {
  return {
    key: 'energy',
    header: 'Energy',
    width: '100px',
    cell: (task, onUpdate) => {
      if (options?.editable) {
        return (
          <Tooltip content="Energy Estimate">
            <div>
              <EnergyInlineSelect
                value={task.energy_estimate}
                onChange={(energy_estimate) => onUpdate({ energy_estimate })}
              />
            </div>
          </Tooltip>
        );
      }
      return (
        <span className="text-sm text-text-sub">
          {task.energy_estimate || '-'}
        </span>
      );
    },
  };
}

/**
 * Mystery factor column with inline select
 */
export function mysteryColumn(options?: EditableColumnOptions): TaskListColumn {
  return {
    key: 'mystery',
    header: 'Mystery',
    width: '100px',
    cell: (task, onUpdate) => {
      if (options?.editable) {
        return (
          <Tooltip content="Mystery Factor">
            <div>
              <MysteryInlineSelect
                value={task.mystery_factor || 'none'}
                onChange={(mystery_factor) => onUpdate({ mystery_factor })}
              />
            </div>
          </Tooltip>
        );
      }
      return (
        <span className="text-sm text-text-sub">
          {task.mystery_factor || '-'}
        </span>
      );
    },
  };
}

/**
 * Battery impact column with inline select
 */
export function batteryColumn(options?: EditableColumnOptions): TaskListColumn {
  return {
    key: 'battery',
    header: 'Battery',
    width: '110px',
    cell: (task, onUpdate) => {
      if (options?.editable) {
        return (
          <Tooltip content="Battery Impact">
            <div>
              <BatteryInlineSelect
                value={task.battery_impact || 'average_drain'}
                onChange={(battery_impact) => onUpdate({ battery_impact })}
              />
            </div>
          </Tooltip>
        );
      }
      return (
        <Badge variant={getBatteryImpactVariant(task.battery_impact as any)}>
          {getBatteryImpactLabel(task.battery_impact as any)}
        </Badge>
      );
    },
  };
}

/**
 * Due date column with inline date picker
 */
export function dueDateColumn(options?: EditableColumnOptions): TaskListColumn {
  return {
    key: 'due_date',
    header: 'Due',
    width: '120px',
    cell: (task, onUpdate) => {
      const inputId = `due-date-${task.id}`;

      if (options?.editable) {
        return (
          <Tooltip content="Due Date">
            <div className="flex items-center gap-1">
              <Calendar
                className="h-4 w-4 text-amber-500 cursor-pointer hover:text-amber-400 flex-shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  const input = document.getElementById(inputId) as HTMLInputElement;
                  input?.showPicker?.();
                }}
              />
              <input
                id={inputId}
                type="date"
                value={task.due_date ? task.due_date.split('T')[0] : ''}
                onChange={(e) => {
                  const dateStr = e.target.value;
                  const isoValue = dateStr ? new Date(dateStr + 'T00:00:00.000Z').toISOString() : null;
                  onUpdate({ due_date: isoValue });
                }}
                onClick={(e) => e.stopPropagation()}
                className="bg-transparent text-sm text-text-main border-none p-0 focus:outline-none focus:ring-0 w-24 [&::-webkit-calendar-picker-indicator]:hidden"
              />
            </div>
          </Tooltip>
        );
      }
      return (
        <span className="text-sm text-text-sub">
          {task.due_date
            ? new Date(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            : '-'}
        </span>
      );
    },
  };
}

/**
 * Estimated time column (read-only, calculated from energy + mystery)
 */
export function estimateColumn(): TaskListColumn {
  return {
    key: 'estimate',
    header: 'Estimate',
    width: '90px',
    cell: (task) => (
      <Tooltip content="Time Estimate">
        <span className="text-sm text-text-sub">
          {task.estimated_minutes ? formatDuration(task.estimated_minutes) : '-'}
        </span>
      </Tooltip>
    ),
  };
}

/**
 * Project column (read-only, links to project)
 */
export function projectColumn(): TaskListColumn {
  return {
    key: 'project',
    header: 'Project',
    width: 'minmax(100px, 1fr)',
    cell: (task) => {
      if (!task.project) {
        return <span className="text-sm text-text-sub">-</span>;
      }
      return (
        <Link
          href={`/projects/${task.project.id}`}
          className="text-sm text-text-sub hover:text-primary truncate"
          onClick={(e) => e.stopPropagation()}
        >
          {task.project.name}
        </Link>
      );
    },
  };
}

/**
 * Time spent column (read-only)
 */
export function timeSpentColumn(): TaskListColumn {
  return {
    key: 'time_spent',
    header: 'Spent',
    width: '80px',
    cell: (task) => (
      <span className="text-sm text-text-sub">
        {task.time_spent_minutes ? formatDuration(task.time_spent_minutes) : '-'}
      </span>
    ),
  };
}

/**
 * Actions column with view details button
 */
export function actionsColumn(options?: { onViewDetails?: (task: Task) => void }): TaskListColumn {
  return {
    key: 'actions',
    header: '',
    width: '40px',
    cell: (task) => (
      <button
        onClick={(e) => {
          e.stopPropagation();
          options?.onViewDetails?.(task);
        }}
        className="opacity-0 group-hover:opacity-100 p-1 text-text-sub hover:text-primary transition-opacity"
        title="View details"
      >
        <ExternalLink className="h-4 w-4" />
      </button>
    ),
  };
}
