'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  Clock,
  Calendar,
  User,
  FolderKanban,
  AlertTriangle,
  AlertCircle,
  ExternalLink,
  CheckSquare,
  Play,
  Square,
  Building2,
  Globe,
  BookOpen,
  ClipboardCheck,
  Zap,
  HelpCircle,
  Battery,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { useAuth } from '@/lib/hooks/use-auth';
import { useTask, useUpdateTask } from '@/lib/hooks/use-tasks';
import { useTimer } from '@/lib/contexts/timer-context';
import { formatElapsedTime } from '@/lib/utils/time';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerBody,
  DrawerCloseButton,
} from '@/components/ui/drawer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip } from '@/components/ui/tooltip';
import { TaskRequirements } from './task-requirements';
import {
  TaskStatusInlineSelect,
  PriorityInlineSelect,
  EnergyInlineSelect,
  MysteryInlineSelect,
  BatteryInlineSelect,
} from '@/components/ui/field-selects';
import { calculateTimeEstimates, formatMinutes } from '@/lib/config/task-fields';
import { RichTextEditor, RichTextRenderer } from '@/components/ui/rich-text-editor';
import { InlineUserSelect } from '@/components/ui/user-select';
import {
  getTaskStatusLabel,
  getTaskStatusVariant,
} from '@/lib/calculations/status';
import { formatDuration } from '@/lib/calculations/energy';

// ============================================
// INLINE EDITABLE TEXT COMPONENT
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
      onClick={() => {
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
// TASK PEEK DRAWER
// ============================================

interface TaskPeekDrawerProps {
  taskId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TaskPeekDrawer({ taskId, open, onOpenChange }: TaskPeekDrawerProps) {
  const [isSopExpanded, setIsSopExpanded] = React.useState(false);

  const { user } = useAuth();
  const isPmOrAdmin = user?.role === 'pm' || user?.role === 'admin';

  const { data: task, isLoading } = useTask(taskId || '', {
    enabled: !!taskId && open,
  });
  const updateTask = useUpdateTask();
  const timer = useTimer();

  const isTimerRunningForThisTask = timer.isRunning && timer.taskId === taskId;

  const handleStartTimer = () => {
    if (!task) return;
    timer.startTimer(task.id, task.title, task.project?.id, task.project?.name);
  };

  const handleStopTimer = () => {
    timer.stopTimer();
  };

  const saveImmediate = React.useCallback(
    (updates: Record<string, unknown>) => {
      if (!taskId) return;
      updateTask.mutate({ id: taskId, data: updates as any });
    },
    [updateTask, taskId]
  );

  const hasBlockers = task?.blocked_by && task.blocked_by.length > 0;
  const isBlocking = task?.blocking && task.blocking.length > 0;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent side="right" size="xl">
        <DrawerHeader>
          <DrawerTitle className="flex-1 pr-8">
            {isLoading ? (
              'Loading...'
            ) : task ? (
              <InlineText
                value={task.title}
                onChange={(title) => saveImmediate({ title })}
                className="text-lg font-semibold"
                placeholder="Enter task title..."
              />
            ) : (
              'Task'
            )}
          </DrawerTitle>
          <DrawerCloseButton />
        </DrawerHeader>
        <DrawerBody>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Spinner size="lg" />
            </div>
          ) : task ? (
            <div className="space-y-5">
              {/* Breadcrumbs: Client > Site > Project */}
              {task.project && (
                <div className="flex items-center gap-1 text-sm text-text-sub flex-wrap">
                  {task.project.client && (
                    <>
                      <Link
                        href={`/clients/${task.project.client.id}`}
                        className="flex items-center gap-1 hover:text-primary"
                      >
                        <Building2 className="h-3.5 w-3.5" />
                        {task.project.client.name}
                      </Link>
                      <ChevronRight className="h-3 w-3 text-text-sub" />
                    </>
                  )}
                  {task.project.site && (
                    <>
                      <Link
                        href={`/sites/${task.project.site.id}`}
                        className="flex items-center gap-1 hover:text-primary"
                      >
                        <Globe className="h-3.5 w-3.5" />
                        {task.project.site.name}
                      </Link>
                      <ChevronRight className="h-3 w-3 text-text-sub" />
                    </>
                  )}
                  <Link
                    href={`/projects/${task.project.id}`}
                    className="flex items-center gap-1 hover:text-primary"
                  >
                    <FolderKanban className="h-3.5 w-3.5" />
                    {task.project.name}
                  </Link>
                </div>
              )}

              {/* Status, Priority, Assignee, Due Date Row - ABOVE timer */}
              <div className="flex items-center gap-3 flex-wrap">
                <Tooltip content="Status">
                  <div>
                    <TaskStatusInlineSelect
                      value={task.status}
                      onChange={(status) => saveImmediate({ status })}
                      disabled={updateTask.isPending}
                    />
                  </div>
                </Tooltip>
                <Tooltip content="Priority">
                  <div>
                    <PriorityInlineSelect
                      value={task.priority}
                      onChange={(priority) => saveImmediate({ priority })}
                    />
                  </div>
                </Tooltip>
                <Tooltip content="Assignee">
                  <div className="flex items-center gap-1">
                    <User className="h-4 w-4 text-text-sub" />
                    <InlineUserSelect
                      value={task.assignee_id || null}
                      onChange={(assignee_id) => saveImmediate({ assignee_id })}
                      displayValue={task.assignee?.name}
                      placeholder="Unassigned"
                    />
                  </div>
                </Tooltip>
                <Tooltip content="Due Date">
                  <div className="flex items-center gap-1">
                    <Calendar
                      className="h-4 w-4 text-amber-500 cursor-pointer hover:text-amber-400"
                      onClick={() => {
                        const input = document.getElementById('peek-due-date') as HTMLInputElement;
                        input?.showPicker?.();
                      }}
                    />
                    <input
                      id="peek-due-date"
                      type="date"
                      value={task.due_date ? task.due_date.split('T')[0] : ''}
                      onChange={(e) => {
                        const dateStr = e.target.value;
                        const isoValue = dateStr ? new Date(dateStr + 'T00:00:00.000Z').toISOString() : null;
                        saveImmediate({ due_date: isoValue });
                      }}
                      className="bg-transparent text-sm text-text-main border-none p-0 focus:outline-none focus:ring-0 w-28 [&::-webkit-calendar-picker-indicator]:hidden"
                    />
                  </div>
                </Tooltip>
              </div>

              {/* Timer Action */}
              <div>
                {isTimerRunningForThisTask ? (
                  <Button
                    onClick={handleStopTimer}
                    disabled={timer.isLoading}
                    className="w-full bg-amber-500 hover:bg-amber-600"
                  >
                    <Square className="h-4 w-4 mr-2" />
                    Stop Timer ({formatElapsedTime(timer.elapsedSeconds)})
                  </Button>
                ) : task.status !== 'done' && task.status !== 'abandoned' ? (
                  <Button
                    onClick={handleStartTimer}
                    disabled={timer.isLoading}
                    variant="secondary"
                    className="w-full"
                  >
                    <Play className="h-4 w-4 mr-2" />
                    {timer.isRunning ? 'Switch Timer to This Quest' : 'Start Timer'}
                  </Button>
                ) : null}
              </div>

              {/* Energy, Mystery, Battery Row - BELOW timer */}
              <div className="flex items-center gap-3 flex-wrap">
                <Tooltip content="Energy Estimate">
                  <div className="flex items-center gap-1">
                    <Zap className="h-4 w-4 text-blue-500" />
                    <EnergyInlineSelect
                      value={task.energy_estimate}
                      onChange={(energy_estimate) => saveImmediate({ energy_estimate })}
                    />
                  </div>
                </Tooltip>
                <Tooltip content="Mystery Factor">
                  <div className="flex items-center gap-1">
                    <HelpCircle className="h-4 w-4 text-purple-500" />
                    <MysteryInlineSelect
                      value={task.mystery_factor || 'none'}
                      onChange={(mystery_factor) => saveImmediate({ mystery_factor })}
                    />
                  </div>
                </Tooltip>
                <Tooltip content="Battery Impact">
                  <div className="flex items-center gap-1">
                    <Battery className="h-4 w-4 text-orange-500" />
                    <BatteryInlineSelect
                      value={task.battery_impact || 'average_drain'}
                      onChange={(battery_impact) => saveImmediate({ battery_impact })}
                    />
                  </div>
                </Tooltip>
              </div>

              {/* Time Estimate with Progress Bar */}
              {(() => {
                const timeEstimates = calculateTimeEstimates(
                  task.energy_estimate,
                  task.mystery_factor || 'none',
                  task.battery_impact || 'average_drain'
                );
                const timeSpent = task.time_spent_minutes || 0;

                if (!timeEstimates) return null;

                const progressPercent = Math.min((timeSpent / timeEstimates.high) * 100, 100);
                const isOverHigh = timeSpent > timeEstimates.high;
                const isOverBase = timeSpent > timeEstimates.base;

                let barColor = 'bg-green-500';
                if (isOverHigh) {
                  barColor = 'bg-orange-500';
                } else if (isOverBase) {
                  barColor = 'bg-yellow-500';
                }

                return (
                  <div className="p-3 bg-surface-alt rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-primary" />
                        <span className="text-sm font-medium text-text-main">
                          {formatMinutes(timeEstimates.base)} - {formatMinutes(timeEstimates.high)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className={`text-sm font-medium ${isOverHigh ? 'text-orange-600' : 'text-text-sub'}`}>
                          {formatMinutes(timeSpent)} tracked
                        </span>
                        {isOverHigh && (
                          <AlertCircle className="h-4 w-4 text-orange-500" />
                        )}
                      </div>
                    </div>
                    <div className="h-2 bg-surface-2 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${barColor} rounded-full transition-all duration-300`}
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                  </div>
                );
              })()}

              {/* Blocked Warning */}
              {hasBlockers && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5" />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-red-700">Blocked by:</div>
                      <div className="space-y-1 mt-1">
                        {task.blocked_by?.map((blocker: any) => (
                          <Link
                            key={blocker.id}
                            href={`/tasks/${blocker.id}`}
                            className="flex items-center gap-2 text-sm text-red-600 hover:text-red-800"
                          >
                            <span>{blocker.title}</span>
                            <Badge variant={getTaskStatusVariant(blocker.status as any)} className="text-xs">
                              {getTaskStatusLabel(blocker.status as any)}
                            </Badge>
                          </Link>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Description */}
              <div>
                <h4 className="text-sm font-medium text-text-main mb-2">Description</h4>
                <div className="text-sm bg-surface-alt p-3 rounded-lg border border-border">
                  <RichTextEditor
                    content={task.description}
                    onChange={(description) => saveImmediate({ description })}
                    placeholder="Add a description..."
                  />
                </div>
              </div>

              {/* Requirements */}
              <div>
                <h4 className="text-sm font-medium text-text-main mb-2 flex items-center gap-2">
                  <CheckSquare className="h-4 w-4" />
                  Requirements
                </h4>
                <TaskRequirements
                  taskId={task.id}
                  requirements={task.requirements}
                />
              </div>

              {/* Quality Gate - PM/Admin only */}
              {isPmOrAdmin && (
                <div>
                  <h4 className="text-sm font-medium text-text-main mb-2 flex items-center gap-2">
                    <ClipboardCheck className="h-4 w-4" />
                    Quality Gate
                    <Badge variant="default" className="text-xs">PM/Admin</Badge>
                  </h4>
                  <TaskRequirements
                    taskId={task.id}
                    requirements={task.review_requirements}
                    fieldName="review_requirements"
                  />
                </div>
              )}

              {/* Linked SOP - Collapsible */}
              {task.sop && (
                <div className="border border-border rounded-lg overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setIsSopExpanded(!isSopExpanded)}
                    className="w-full flex items-center justify-between p-3 bg-surface-alt hover:bg-surface-2 transition-colors text-left"
                  >
                    <div className="flex items-center gap-2">
                      <BookOpen className="h-4 w-4 text-text-sub" />
                      <span className="text-sm font-medium text-text-main">
                        Rune: {task.sop.title}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/sops/${task.sop.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-xs text-primary hover:underline"
                      >
                        View Full
                      </Link>
                      <ChevronDown
                        className={`h-4 w-4 text-text-sub transition-transform ${
                          isSopExpanded ? 'rotate-180' : ''
                        }`}
                      />
                    </div>
                  </button>
                  {isSopExpanded && (
                    <div className="p-3 border-t border-border">
                      {task.sop.estimated_minutes && (
                        <div className="flex items-center gap-1 text-xs text-text-sub mb-2">
                          <Clock className="h-3 w-3" />
                          Est: {task.sop.estimated_minutes} minutes
                        </div>
                      )}
                      {task.sop.content ? (
                        <div className="text-sm">
                          <RichTextRenderer content={task.sop.content} />
                        </div>
                      ) : (
                        <p className="text-sm text-text-sub italic">No content</p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Dependencies */}
              {(hasBlockers || isBlocking) && (
                <div>
                  <h4 className="text-sm font-medium text-text-main mb-2">Dependencies</h4>
                  <div className="space-y-3">
                    {hasBlockers && (
                      <div>
                        <div className="text-xs text-text-sub mb-1">Blocked by:</div>
                        <div className="space-y-1">
                          {task.blocked_by?.map((blocker: any) => (
                            <Link
                              key={blocker.id}
                              href={`/tasks/${blocker.id}`}
                              className="flex items-center justify-between p-2 rounded border border-border hover:bg-surface-2"
                            >
                              <span className="text-sm text-text-main">{blocker.title}</span>
                              <Badge variant={getTaskStatusVariant(blocker.status as any)} className="text-xs">
                                {getTaskStatusLabel(blocker.status as any)}
                              </Badge>
                            </Link>
                          ))}
                        </div>
                      </div>
                    )}
                    {isBlocking && (
                      <div>
                        <div className="text-xs text-text-sub mb-1">Blocking:</div>
                        <div className="space-y-1">
                          {task.blocking?.map((blocked: any) => (
                            <Link
                              key={blocked.id}
                              href={`/tasks/${blocked.id}`}
                              className="flex items-center justify-between p-2 rounded border border-border hover:bg-surface-2"
                            >
                              <span className="text-sm text-text-main">{blocked.title}</span>
                              <Badge variant={getTaskStatusVariant(blocked.status as any)} className="text-xs">
                                {getTaskStatusLabel(blocked.status as any)}
                              </Badge>
                            </Link>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Notes */}
              {task.notes && (
                <div>
                  <h4 className="text-sm font-medium text-text-main mb-2">Notes</h4>
                  <div className="text-sm text-text-sub bg-surface-alt p-3 rounded-lg">
                    <RichTextRenderer content={task.notes} />
                  </div>
                </div>
              )}

              {/* Details */}
              <div>
                <h4 className="text-sm font-medium text-text-main mb-2">Details</h4>
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  {task.function && (
                    <>
                      <dt className="text-text-sub">Function</dt>
                      <dd className="text-text-main">{task.function.name}</dd>
                    </>
                  )}
                  {task.phase && (
                    <>
                      <dt className="text-text-sub">Phase</dt>
                      <dd className="text-text-main">{task.phase}</dd>
                    </>
                  )}
                  <dt className="text-text-sub">Created</dt>
                  <dd className="text-text-main">
                    {new Date(task.created_at).toLocaleDateString()}
                  </dd>
                  {task.started_at && (
                    <>
                      <dt className="text-text-sub">Started</dt>
                      <dd className="text-text-main">
                        {new Date(task.started_at).toLocaleDateString()}
                      </dd>
                    </>
                  )}
                  {task.completed_at && (
                    <>
                      <dt className="text-text-sub">Completed</dt>
                      <dd className="text-text-main">
                        {new Date(task.completed_at).toLocaleDateString()}
                      </dd>
                    </>
                  )}
                  {task.created_by && (
                    <>
                      <dt className="text-text-sub">Created by</dt>
                      <dd className="text-text-main">{task.created_by.name}</dd>
                    </>
                  )}
                  {task.time_spent_minutes != null && task.time_spent_minutes > 0 && (
                    <>
                      <dt className="text-text-sub">Time Spent</dt>
                      <dd className="text-text-main">{formatDuration(task.time_spent_minutes)}</dd>
                    </>
                  )}
                </dl>
              </div>

              {/* View Full Details Link */}
              <div className="pt-4 border-t border-border">
                <Link href={`/tasks/${task.id}`}>
                  <Button variant="secondary" className="w-full">
                    <ExternalLink className="h-4 w-4 mr-2" />
                    View in Fullscreen
                  </Button>
                </Link>
              </div>
            </div>
          ) : (
            <div className="text-center py-12 text-text-sub">Task not found</div>
          )}
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
