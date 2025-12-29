'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Trash2,
  Clock,
  Calendar,
  FolderKanban,
  User,
  AlertTriangle,
  CheckSquare,
  ChevronRight,
  ChevronDown,
  Building2,
  Globe,
  BookOpen,
  ClipboardCheck,
  Zap,
  HelpCircle,
  Battery,
  Play,
  Square,
} from 'lucide-react';
import { useAuth } from '@/lib/hooks/use-auth';
import {
  useTask,
  useUpdateTask,
  useDeleteTask,
} from '@/lib/hooks/use-tasks';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import {
  TaskStatusInlineSelect,
  PriorityInlineSelect,
  EnergyInlineSelect,
  MysteryInlineSelect,
  BatteryInlineSelect,
  calculateTimeRange,
} from '@/components/ui/field-selects';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { Tooltip } from '@/components/ui/tooltip';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalBody,
} from '@/components/ui/modal';
import { TaskRequirements } from '@/components/domain/tasks/task-requirements';
import { RichTextEditor, RichTextRenderer } from '@/components/ui/rich-text-editor';
import { InlineUserSelect } from '@/components/ui/user-select';
import { useTimer } from '@/lib/contexts/timer-context';
import { formatElapsedTime } from '@/lib/utils/time';
import {
  getTaskStatusLabel,
  getTaskStatusVariant,
} from '@/lib/calculations/status';

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
        className={`bg-transparent border-b-2 border-primary outline-none ${className}`}
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
// INLINE DATE PICKER
// ============================================

interface InlineDateProps {
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  inputId?: string;
}

function InlineDate({ value, onChange, placeholder = 'Set date', inputId }: InlineDateProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Convert ISO datetime to YYYY-MM-DD for the input
  const inputValue = value ? value.split('T')[0] : '';

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const dateStr = e.target.value;
    // Convert YYYY-MM-DD to ISO datetime string
    const isoValue = dateStr ? new Date(dateStr + 'T00:00:00.000Z').toISOString() : null;
    onChange(isoValue);
  };

  const formattedValue = value ? new Date(value).toLocaleDateString() : null;

  const openPicker = () => {
    inputRef.current?.showPicker?.();
  };

  return (
    <div className="relative">
      <span
        onClick={openPicker}
        className="cursor-pointer hover:bg-surface-alt px-1 -mx-1 rounded transition-colors text-xl font-semibold text-text-main"
      >
        {formattedValue || <span className="text-text-sub">{placeholder}</span>}
      </span>
      <input
        ref={inputRef}
        id={inputId}
        type="date"
        value={inputValue}
        onChange={handleChange}
        className="absolute opacity-0 w-0 h-0 pointer-events-none"
      />
    </div>
  );
}

// ============================================
// MAIN PAGE COMPONENT
// ============================================

export default function QuestDetailPage() {
  const params = useParams();
  const router = useRouter();
  const taskId = params.id as string;

  const [isDeleteOpen, setIsDeleteOpen] = React.useState(false);
  const [isSopExpanded, setIsSopExpanded] = React.useState(false);

  const { user } = useAuth();
  const isPmOrAdmin = user?.role === 'pm' || user?.role === 'admin';

  const { data: task, isLoading, error } = useTask(taskId);
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();
  const timer = useTimer();

  const isTimerRunningForThisTask = timer.isRunning && timer.taskId === taskId;

  const handleStartTimer = () => {
    if (!task) return;
    timer.startTimer(task.id, task.title, task.project?.id, task.project?.name);
  };

  const handleStopTimer = () => {
    timer.stopTimer();
  };

  // Debounced save for content changes
  const saveTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const save = React.useCallback(
    (updates: Record<string, unknown>) => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        updateTask.mutate({ id: taskId, data: updates as any });
      }, 500);
    },
    [updateTask, taskId]
  );

  // Immediate save for discrete changes
  const saveImmediate = React.useCallback(
    (updates: Record<string, unknown>) => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      updateTask.mutate({ id: taskId, data: updates as any });
    },
    [updateTask, taskId]
  );

  const handleDelete = async () => {
    await deleteTask.mutateAsync(taskId);
    router.push('/tasks');
  };

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error || !task) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-8">
            <EmptyState
              icon={<CheckSquare className="h-12 w-12" />}
              title="Quest not found"
              description="This quest may have been deleted or you don't have access."
              action={
                <Link href="/tasks">
                  <Button>Back to Tasks</Button>
                </Link>
              }
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  const hasBlockers = task.blocked_by && task.blocked_by.length > 0;
  const isBlocking = task.blocking && task.blocking.length > 0;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-4">
          <Link href="/tasks">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold text-text-main">
                <InlineText
                  value={task.title}
                  onChange={(title) => saveImmediate({ title })}
                  className="text-2xl font-semibold"
                />
              </h1>
              <TaskStatusInlineSelect
                value={task.status}
                onChange={(status) => saveImmediate({ status })}
                disabled={updateTask.isPending}
              />
              <PriorityInlineSelect
                value={task.priority}
                onChange={(priority) => saveImmediate({ priority })}
              />
            </div>
            {/* Breadcrumbs: Client > Site > Project */}
            {task.project && (
              <div className="flex items-center gap-1 mt-1 text-sm text-text-sub">
                {task.project.client && (
                  <>
                    <Link
                      href={`/clients/${task.project.client.id}`}
                      className="flex items-center gap-1 hover:text-primary"
                    >
                      <Building2 className="h-4 w-4" />
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
                      <Globe className="h-4 w-4" />
                      {task.project.site.name}
                    </Link>
                    <ChevronRight className="h-3 w-3 text-text-sub" />
                  </>
                )}
                <Link
                  href={`/projects/${task.project.id}`}
                  className="flex items-center gap-1 hover:text-primary"
                >
                  <FolderKanban className="h-4 w-4" />
                  {task.project.name}
                </Link>
              </div>
            )}
            {/* Assignee & Phase */}
            <div className="flex items-center gap-4 mt-2 text-sm text-text-sub">
              <div className="flex items-center gap-1">
                <User className="h-4 w-4" />
                <InlineUserSelect
                  value={task.assignee_id || null}
                  onChange={(assignee_id) => saveImmediate({ assignee_id })}
                  displayValue={task.assignee?.name}
                  placeholder="Unassigned"
                />
              </div>
              {task.phase && (
                <span className="text-text-sub">Phase: {task.phase}</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {updateTask.isPending && (
            <span className="text-sm text-text-sub flex items-center gap-2">
              <Spinner size="sm" />
              Saving...
            </span>
          )}
          {/* Timer Button */}
          {isTimerRunningForThisTask ? (
            <Button
              onClick={handleStopTimer}
              disabled={timer.isLoading}
              className="bg-amber-500 hover:bg-amber-600 text-white"
            >
              <Square className="h-4 w-4 mr-2" />
              Stop ({formatElapsedTime(timer.elapsedSeconds)})
            </Button>
          ) : task.status !== 'done' && task.status !== 'abandoned' ? (
            <Button
              onClick={handleStartTimer}
              disabled={timer.isLoading || timer.isRunning}
              variant="secondary"
            >
              <Play className="h-4 w-4 mr-2" />
              {timer.isRunning ? 'Switch Timer' : 'Start Timer'}
            </Button>
          ) : null}
          <Button variant="ghost" onClick={() => setIsDeleteOpen(true)}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Blocked Warning */}
      {hasBlockers && (
        <Card className="border-red-500/50 bg-red-50/50">
          <CardContent className="py-3">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-red-500 mt-0.5" />
              <div>
                <div className="font-medium text-red-700">This quest is blocked</div>
                <div className="text-sm text-red-600 mt-1">
                  Waiting on:{' '}
                  {task.blocked_by?.map((blocker, i) => (
                    <React.Fragment key={blocker.id}>
                      {i > 0 && ', '}
                      <Link
                        href={`/tasks/${blocker.id}`}
                        className="underline hover:text-red-800"
                      >
                        {blocker.title}
                      </Link>
                      {blocker.status !== 'done' && (
                        <span className="text-red-400"> ({getTaskStatusLabel(blocker.status as any)})</span>
                      )}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <Tooltip content="Due Date">
                <div
                  className="p-2 rounded-lg bg-amber-500/10 cursor-pointer hover:bg-amber-500/20 transition-colors"
                  onClick={() => {
                    const input = document.getElementById('task-due-date') as HTMLInputElement;
                    input?.showPicker?.();
                  }}
                >
                  <Calendar className="h-5 w-5 text-amber-500" />
                </div>
              </Tooltip>
              <InlineDate
                value={task.due_date}
                onChange={(due_date) => saveImmediate({ due_date })}
                placeholder="-"
                inputId="task-due-date"
              />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <Tooltip content="Energy Estimate">
                <div className="p-2 rounded-lg bg-blue-500/10 cursor-help">
                  <Zap className="h-5 w-5 text-blue-500" />
                </div>
              </Tooltip>
              <EnergyInlineSelect
                value={task.energy_estimate}
                onChange={(energy_estimate) => saveImmediate({ energy_estimate })}
              />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <Tooltip content="Mystery Factor">
                <div className="p-2 rounded-lg bg-purple-500/10 cursor-help">
                  <HelpCircle className="h-5 w-5 text-purple-500" />
                </div>
              </Tooltip>
              <MysteryInlineSelect
                value={task.mystery_factor || 'none'}
                onChange={(mystery_factor) => saveImmediate({ mystery_factor })}
              />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <Tooltip content="Battery Impact">
                <div className="p-2 rounded-lg bg-orange-500/10 cursor-help">
                  <Battery className="h-5 w-5 text-orange-500" />
                </div>
              </Tooltip>
              <BatteryInlineSelect
                value={task.battery_impact || 'average_drain'}
                onChange={(battery_impact) => saveImmediate({ battery_impact })}
              />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <Tooltip content="Time Estimate">
                <div className="p-2 rounded-lg bg-primary/10 cursor-help">
                  <Clock className="h-5 w-5 text-primary" />
                </div>
              </Tooltip>
              <div className="text-xl font-semibold text-text-main">
                {calculateTimeRange(
                  task.energy_estimate,
                  task.mystery_factor || 'none',
                  task.battery_impact || 'average_drain'
                ) || '-'}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Description */}
          <Card>
            <CardHeader>
              <CardTitle>Description</CardTitle>
            </CardHeader>
            <CardContent>
              <RichTextEditor
                content={task.description}
                onChange={(description) => save({ description })}
                placeholder="Add a description..."
              />
            </CardContent>
          </Card>

          {/* Requirements */}
          <Card>
            <CardHeader>
              <CardTitle>Requirements</CardTitle>
            </CardHeader>
            <CardContent>
              <TaskRequirements taskId={taskId} requirements={task.requirements} />
            </CardContent>
          </Card>

          {/* Quality Gate - PM/Admin only */}
          {isPmOrAdmin && task.review_requirements && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ClipboardCheck className="h-5 w-5" />
                  Quality Gate
                  <Badge variant="default" className="text-xs">PM/Admin only</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <TaskRequirements
                  taskId={taskId}
                  requirements={task.review_requirements}
                  fieldName="review_requirements"
                />
              </CardContent>
            </Card>
          )}

          {/* Linked SOP - Collapsible */}
          {task.sop && (
            <Card>
              <CardHeader
                className="flex flex-row items-center justify-between cursor-pointer hover:bg-surface-alt/50 transition-colors"
                onClick={() => setIsSopExpanded(!isSopExpanded)}
              >
                <CardTitle className="flex items-center gap-2">
                  <BookOpen className="h-5 w-5" />
                  Rune: {task.sop.title}
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Link
                    href={`/sops/${task.sop.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1 text-sm text-text-sub hover:text-text-main transition-colors"
                  >
                    View Full Rune
                    <ChevronRight className="h-4 w-4" />
                  </Link>
                  <ChevronDown
                    className={`h-5 w-5 text-text-sub transition-transform ${
                      isSopExpanded ? 'rotate-180' : ''
                    }`}
                  />
                </div>
              </CardHeader>
              {isSopExpanded && (
                <CardContent>
                  {task.sop.estimated_minutes && (
                    <div className="flex items-center gap-1 text-sm text-text-sub mb-4">
                      <Clock className="h-4 w-4" />
                      Estimated: {task.sop.estimated_minutes} minutes
                    </div>
                  )}
                  {task.sop.content ? (
                    <div className="bg-surface-2 rounded-lg p-4 border border-border">
                      <RichTextRenderer content={task.sop.content} />
                    </div>
                  ) : (
                    <p className="text-text-sub italic">No rune content available</p>
                  )}
                </CardContent>
              )}
            </Card>
          )}

          {/* Notes */}
          <Card>
            <CardHeader>
              <CardTitle>Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <RichTextEditor
                content={task.notes}
                onChange={(notes) => save({ notes })}
                placeholder="Add notes..."
              />
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Dependencies */}
          {(hasBlockers || isBlocking) && (
            <Card>
              <CardHeader>
                <CardTitle>Dependencies</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {hasBlockers && (
                  <div>
                    <div className="text-sm font-medium text-text-sub mb-2">
                      Blocked by:
                    </div>
                    <div className="space-y-2">
                      {task.blocked_by?.map((blocker) => (
                        <Link
                          key={blocker.id}
                          href={`/tasks/${blocker.id}`}
                          className="block p-2 rounded border border-border hover:bg-surface-2"
                        >
                          <div className="text-sm font-medium text-text-main">
                            {blocker.title}
                          </div>
                          <Badge
                            variant={getTaskStatusVariant(blocker.status as any)}
                            className="mt-1"
                          >
                            {getTaskStatusLabel(blocker.status as any)}
                          </Badge>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
                {isBlocking && (
                  <div>
                    <div className="text-sm font-medium text-text-sub mb-2">
                      Blocking:
                    </div>
                    <div className="space-y-2">
                      {task.blocking?.map((blocked) => (
                        <Link
                          key={blocked.id}
                          href={`/tasks/${blocked.id}`}
                          className="block p-2 rounded border border-border hover:bg-surface-2"
                        >
                          <div className="text-sm font-medium text-text-main">
                            {blocked.title}
                          </div>
                          <Badge
                            variant={getTaskStatusVariant(blocked.status as any)}
                            className="mt-1"
                          >
                            {getTaskStatusLabel(blocked.status as any)}
                          </Badge>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Details */}
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="text-text-sub">Function</dt>
                  <dd className="text-text-main">{task.function?.name || '-'}</dd>
                </div>
                <div>
                  <dt className="text-text-sub">Created</dt>
                  <dd className="text-text-main">
                    {new Date(task.created_at).toLocaleString()}
                  </dd>
                </div>
                {task.started_at && (
                  <div>
                    <dt className="text-text-sub">Started</dt>
                    <dd className="text-text-main">
                      {new Date(task.started_at).toLocaleString()}
                    </dd>
                  </div>
                )}
                {task.completed_at && (
                  <div>
                    <dt className="text-text-sub">Completed</dt>
                    <dd className="text-text-main">
                      {new Date(task.completed_at).toLocaleString()}
                    </dd>
                  </div>
                )}
                {task.created_by && (
                  <div>
                    <dt className="text-text-sub">Created by</dt>
                    <dd className="text-text-main">{task.created_by.name}</dd>
                  </div>
                )}
              </dl>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Delete Confirmation */}
      <Modal open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <ModalContent size="sm">
          <ModalHeader>
            <ModalTitle>Delete Quest</ModalTitle>
          </ModalHeader>
          <ModalBody>
            <p className="text-text-sub">
              Are you sure you want to delete this quest? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3 mt-4">
              <Button variant="ghost" onClick={() => setIsDeleteOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={deleteTask.isPending}
              >
                {deleteTask.isPending ? 'Deleting...' : 'Delete'}
              </Button>
            </div>
          </ModalBody>
        </ModalContent>
      </Modal>
    </div>
  );
}
