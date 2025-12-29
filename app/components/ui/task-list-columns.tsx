'use client';

import * as React from 'react';
import Link from 'next/link';
import { Calendar, ExternalLink, AlertCircle, Clock, CircleDot, CheckCircle2, Circle } from 'lucide-react';
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
import {
  formatDuration,
  getBatteryImpactLabel,
  getBatteryImpactVariant,
  getEnergyLabel,
  getMysteryFactorLabel,
  energyToMinutes,
  getMysteryMultiplier,
} from '@/lib/calculations/energy';
import { MysteryFactor } from '@prisma/client';
import type { TaskListColumn, TaskLike } from './task-list';
import type { Task } from '@/lib/hooks/use-tasks';

// Generic task type for columns that need specific fields
interface TaskWithFocus extends TaskLike {
  is_focus?: boolean;
}

interface TaskWithStatus extends TaskLike {
  status: string;
}

interface TaskWithPriority extends TaskLike {
  priority: number;
}

interface TaskWithAssignee extends TaskLike {
  assignee_id?: string | null;
  assignee?: { id: string; name: string; avatar_url?: string | null } | null;
}

interface TaskWithEnergy extends TaskLike {
  energy_estimate?: number | null;
}

interface TaskWithMystery extends TaskLike {
  mystery_factor?: string | null;
}

interface TaskWithBattery extends TaskLike {
  battery_impact?: string | null;
}

interface TaskWithDueDate extends TaskLike {
  due_date?: string | null;
}

interface TaskWithEstimate extends TaskLike {
  estimated_minutes?: number | null;
}

interface TaskWithProject extends TaskLike {
  project?: { id: string; name: string } | null;
}

interface TaskWithTimeSpent extends TaskLike {
  time_spent_minutes?: number | null;
  time_logged_minutes?: number; // Dashboard uses this name
}

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
 * Status icon column - compact status indicator for dashboard lists
 */
export function statusIconColumn(): TaskListColumn {
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'blocked':
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      case 'in_progress':
        return <Clock className="h-4 w-4 text-blue-500" />;
      case 'done':
        return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
      case 'abandoned':
        return <Circle className="h-4 w-4 text-text-sub line-through" />;
      default:
        return <CircleDot className="h-4 w-4 text-text-sub" />;
    }
  };

  return {
    key: 'status_icon',
    header: '',
    width: '24px',
    cell: (task) => (
      <Tooltip content={getTaskStatusLabel(task.status as any)}>
        <span>{getStatusIcon(task.status)}</span>
      </Tooltip>
    ),
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
      if (!task.energy_estimate) {
        return <span className="text-sm text-text-sub">-</span>;
      }
      return (
        <Badge variant="default" className="text-xs">
          {getEnergyLabel(task.energy_estimate)}
        </Badge>
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
      // Only show if not 'none' or null
      if (!task.mystery_factor || task.mystery_factor === 'none') {
        return <span className="text-sm text-text-sub">-</span>;
      }
      return (
        <Badge variant="default" className="text-xs">
          {getMysteryFactorLabel(task.mystery_factor)}
        </Badge>
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
      // Only show badge if not default/average_drain
      if (!task.battery_impact || task.battery_impact === 'average_drain') {
        return <span className="text-sm text-text-sub">-</span>;
      }
      return (
        <Badge variant={getBatteryImpactVariant(task.battery_impact as any)} className="text-xs">
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
 * Client/Project/Site column - shows hierarchy: Client → Project (Site)
 */
export function clientProjectSiteColumn(): TaskListColumn {
  return {
    key: 'client_project_site',
    header: 'Client / Project',
    width: 'minmax(150px, 2fr)',
    cell: (task) => {
      if (!task.project) {
        return <span className="text-sm text-text-sub">Ad-hoc</span>;
      }

      const parts: string[] = [];
      if (task.project.client?.name) {
        parts.push(task.project.client.name);
      }
      parts.push(task.project.name);
      if (task.project.site?.name) {
        parts.push(task.project.site.name);
      }

      return (
        <div className="text-sm text-text-sub truncate" title={parts.join(' → ')}>
          {parts.join(' → ')}
        </div>
      );
    },
  };
}

/**
 * Ranged estimate column - shows min-max range based on energy + mystery
 */
export function rangedEstimateColumn(): TaskListColumn {
  return {
    key: 'ranged_estimate',
    header: 'Estimate',
    width: '100px',
    cell: (task) => {
      if (!task.energy_estimate) {
        return <span className="text-sm text-text-sub">-</span>;
      }

      // Calculate base and max minutes
      const baseMinutes = energyToMinutes(task.energy_estimate);
      const mysteryFactor = (task.mystery_factor || 'none') as MysteryFactor;
      const multiplier = getMysteryMultiplier(mysteryFactor);
      const maxMinutes = Math.round(baseMinutes * multiplier);

      // Format the range
      let rangeText: string;
      if (baseMinutes === maxMinutes || mysteryFactor === 'none') {
        rangeText = formatDuration(baseMinutes);
      } else {
        rangeText = `${formatDuration(baseMinutes)} - ${formatDuration(maxMinutes)}`;
      }

      return (
        <Tooltip content={`Energy: ${task.energy_estimate}, Mystery: ${getMysteryFactorLabel(mysteryFactor)}`}>
          <span className="text-sm text-text-sub">{rangeText}</span>
        </Tooltip>
      );
    },
  };
}

/**
 * Time spent column (read-only)
 */
export function timeSpentColumn<T extends TaskWithTimeSpent>(): TaskListColumn<T> {
  return {
    key: 'time_spent',
    header: 'Logged',
    width: '80px',
    cell: (task) => {
      const minutes = task.time_spent_minutes ?? task.time_logged_minutes;
      return (
        <span className="text-sm text-text-sub">
          {minutes ? formatDuration(minutes) : '-'}
        </span>
      );
    },
  };
}

/**
 * Focus checkbox column for toggling is_focus
 */
export function focusColumn<T extends TaskWithFocus>(options: { onToggleFocus: (taskId: string, isFocus: boolean) => void }): TaskListColumn<T> {
  return {
    key: 'focus',
    header: '',
    width: '32px',
    cell: (task) => (
      <button
        onClick={(e) => {
          e.stopPropagation();
          options.onToggleFocus(task.id, !task.is_focus);
        }}
        className={`h-4 w-4 shrink-0 rounded border flex items-center justify-center transition-colors ${
          task.is_focus
            ? 'bg-primary border-primary text-white'
            : 'border-border-warm bg-surface hover:border-primary'
        }`}
        title={task.is_focus ? 'Remove from focus' : 'Add to focus'}
      >
        {task.is_focus && (
          <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
            <path d="M2 6l3 3 5-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </button>
    ),
  };
}

// Task type for approve column
interface TaskWithReview extends TaskLike {
  status: string;
  needs_review?: boolean;
  approved?: boolean;
}

/**
 * Approve button column - shows approve button for tasks that are done and need review
 */
export function approveColumn<T extends TaskWithReview>(options: {
  onApprove: (taskId: string) => void;
}): TaskListColumn<T> {
  return {
    key: 'approve',
    header: '',
    width: '90px',
    cell: (task) => {
      // Only show for tasks that are done, need review, and aren't approved yet
      const showApprove = task.status === 'done' && task.needs_review && !task.approved;

      if (!showApprove) {
        return null;
      }

      return (
        <button
          onClick={(e) => {
            e.stopPropagation();
            options.onApprove(task.id);
          }}
          className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 transition-colors"
          title="Approve task"
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          Approve
        </button>
      );
    },
  };
}

/**
 * Actions column with view details button
 */
export function actionsColumn<T extends TaskLike>(options?: { onViewDetails?: (task: T) => void }): TaskListColumn<T> {
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
