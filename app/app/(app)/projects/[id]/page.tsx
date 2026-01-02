'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Edit,
  Trash2,
  Users,
  CheckSquare,
  Clock,
  Calendar,
  Building2,
  Globe,
  Lock,
  ChevronDown,
  ChevronRight,
  Plus,
  Pencil,
  Check,
  X,
  GripVertical,
} from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  UniqueIdentifier,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  useProject,
  useUpdateProjectStatus,
  useDeleteProject,
  useLockProjectBudget,
  useCreateProjectPhase,
  useUpdateProjectPhase,
  useDeleteProjectPhase,
  useReorderProjectPhases,
} from '@/lib/hooks/use-projects';
import {
  useCreateTask,
  useUpdateTaskInProject,
  useReorderProjectTasks,
  useMoveTask,
} from '@/lib/hooks/use-tasks';
import { SopSelector } from '@/components/domain/recipes/sop-selector';
import { useTerminology } from '@/lib/hooks/use-terminology';
import { useAuth } from '@/lib/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalBody,
} from '@/components/ui/modal';
import { ProjectForm } from '@/components/domain/projects/project-form';
import { ProjectWorkloadTab } from '@/components/domain/projects/project-workload-tab';
import { ProjectTimeTab } from '@/components/domain/projects/project-time-tab';
import { MilestoneList } from '@/components/domain/projects/milestone-list';
import { ResourceLinks } from '@/components/domain/projects/resource-links';
import { ProjectTeamTab } from '@/components/domain/projects/project-team-tab';
import { TaskPeekDrawer } from '@/components/domain/tasks/task-peek-drawer';
import {
  getProjectStatusLabel,
  getProjectStatusVariant,
  getValidNextProjectStatuses,
} from '@/lib/calculations/status';
import { formatDuration } from '@/lib/calculations/energy';
import { getIconOption } from '@/lib/config/icons';
import { cn } from '@/lib/utils/cn';
import { InlineIconPicker } from '@/components/ui/icon-picker';
import { TaskList, type TaskListGroup } from '@/components/ui/task-list';
import {
  titleColumn,
  statusColumn,
  assigneeColumn,
  dueDateColumn,
  batteryColumn,
  mysteryColumn,
  rangedEstimateColumn,
  actionsColumn,
} from '@/components/ui/task-list-columns';
import type { Task } from '@/lib/hooks/use-tasks';

export default function ProjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { t } = useTerminology();
  const { isPmOrAdmin } = useAuth();
  const projectId = params.id as string;

  const [isEditOpen, setIsEditOpen] = React.useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = React.useState(false);
  const [isLockBudgetOpen, setIsLockBudgetOpen] = React.useState(false);
  const [budgetHours, setBudgetHours] = React.useState('');
  const [hourlyRate, setHourlyRate] = React.useState('');
  const [budgetAmount, setBudgetAmount] = React.useState('');
  const [peekTaskId, setPeekTaskId] = React.useState<string | null>(null);
  const [isPeekOpen, setIsPeekOpen] = React.useState(false);
  const [collapsedPhases, setCollapsedPhases] = React.useState<Set<string>>(new Set());

  // Phase editing state
  const [isAddingPhase, setIsAddingPhase] = React.useState(false);
  const [newPhaseName, setNewPhaseName] = React.useState('');
  const [editingPhaseId, setEditingPhaseId] = React.useState<string | null>(null);
  const [editingPhaseName, setEditingPhaseName] = React.useState('');
  const [deletePhaseId, setDeletePhaseId] = React.useState<string | null>(null);
  const [deletePhaseName, setDeletePhaseName] = React.useState('');

  // Task adding state
  const [addingTaskToPhaseId, setAddingTaskToPhaseId] = React.useState<string | null>(null);
  const [newTaskTitle, setNewTaskTitle] = React.useState('');
  const [selectedSopId, setSelectedSopId] = React.useState<string | null>(null);

  // Drag and drop state
  const [activeId, setActiveId] = React.useState<UniqueIdentifier | null>(null);
  const [activeType, setActiveType] = React.useState<'phase' | 'task' | null>(null);

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const togglePhaseCollapse = (phaseId: string) => {
    setCollapsedPhases((prev) => {
      const next = new Set(prev);
      if (next.has(phaseId)) {
        next.delete(phaseId);
      } else {
        next.add(phaseId);
      }
      return next;
    });
  };

  const { data: project, isLoading, error } = useProject(projectId);
  const updateStatus = useUpdateProjectStatus();
  const deleteProject = useDeleteProject();
  const lockBudget = useLockProjectBudget();
  const createPhase = useCreateProjectPhase();
  const updatePhase = useUpdateProjectPhase();
  const deletePhase = useDeleteProjectPhase();
  const createTask = useCreateTask();
  const updateTask = useUpdateTaskInProject(projectId);
  const reorderTasks = useReorderProjectTasks(projectId);
  const reorderPhases = useReorderProjectPhases();
  const moveTask = useMoveTask(projectId);

  // Initialize budget fields when project loads or modal opens
  React.useEffect(() => {
    if (project && isLockBudgetOpen) {
      setBudgetHours(project.calculated?.estimated_hours_max?.toString() || '');
      setHourlyRate(project.hourly_rate?.toString() || '');
      setBudgetAmount(project.budget_amount?.toString() || '');
    }
  }, [project, isLockBudgetOpen]);

  const handleStatusChange = async (newStatus: string) => {
    await updateStatus.mutateAsync({ id: projectId, status: newStatus });
  };

  const handleDelete = async () => {
    await deleteProject.mutateAsync(projectId);
    router.push('/projects');
  };

  const handleLockBudget = async () => {
    const hours = parseFloat(budgetHours);
    if (isNaN(hours) || hours <= 0) return;

    await lockBudget.mutateAsync({
      id: projectId,
      data: {
        budget_hours: hours,
        hourly_rate: hourlyRate ? parseFloat(hourlyRate) : undefined,
        budget_amount: budgetAmount ? parseFloat(budgetAmount) : undefined,
      },
    });
    setIsLockBudgetOpen(false);
  };

  // Phase handlers
  const handleAddPhase = async () => {
    if (!newPhaseName.trim()) return;
    await createPhase.mutateAsync({
      projectId,
      data: { name: newPhaseName.trim() },
    });
    setNewPhaseName('');
    setIsAddingPhase(false);
  };

  const handleUpdatePhaseName = async (phaseId: string) => {
    if (!editingPhaseName.trim()) return;
    await updatePhase.mutateAsync({
      projectId,
      phaseId,
      data: { name: editingPhaseName.trim() },
    });
    setEditingPhaseId(null);
  };

  const handleUpdatePhaseIcon = async (phaseId: string, icon: string) => {
    await updatePhase.mutateAsync({
      projectId,
      phaseId,
      data: { icon },
    });
  };

  const handleDeletePhase = async () => {
    if (!deletePhaseId) return;
    await deletePhase.mutateAsync({ projectId, phaseId: deletePhaseId });
    setDeletePhaseId(null);
    setDeletePhaseName('');
  };

  // Quick task add handler
  const handleQuickAddTask = async (phaseId: string | null) => {
    if (!newTaskTitle.trim()) return;

    await createTask.mutateAsync({
      title: newTaskTitle.trim(),
      project_id: projectId,
      phase_id: phaseId,
      sop_id: selectedSopId || undefined,  // API handles SOP field inheritance
    });

    setNewTaskTitle('');
    setSelectedSopId(null);
    setAddingTaskToPhaseId(null);
  };

  // Task update handler for TaskList
  const handleTaskUpdate = (taskId: string, updates: Partial<Task>) => {
    updateTask.mutate({ id: taskId, data: updates as any });
  };

  const handleTaskClick = (task: Task) => {
    setPeekTaskId(task.id);
    setIsPeekOpen(true);
  };

  // DnD handlers
  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    setActiveId(active.id);

    // Determine if dragging a phase or task
    const isPhase = project?.phases?.some((p: any) => p.id === active.id);
    setActiveType(isPhase ? 'phase' : 'task');
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    setActiveType(null);

    if (!over || active.id === over.id || !project) return;

    const phases = project.phases || [];
    const tasks = project.tasks || [];

    // Check if dragging phases
    const activePhase = phases.find((p: any) => p.id === active.id);
    const overPhase = phases.find((p: any) => p.id === over.id);

    if (activePhase && overPhase) {
      // Reordering phases
      const oldIndex = phases.findIndex((p: any) => p.id === active.id);
      const newIndex = phases.findIndex((p: any) => p.id === over.id);

      if (oldIndex !== newIndex) {
        const newOrder = arrayMove(phases, oldIndex, newIndex);
        await reorderPhases.mutateAsync({
          projectId,
          phaseIds: newOrder.map((p: any) => p.id),
        });
      }
      return;
    }

    // Check if dragging tasks
    const activeTask = tasks.find((t: any) => t.id === active.id);
    if (!activeTask) return;

    const overTask = tasks.find((t: any) => t.id === over.id);
    const overPhaseForTask = phases.find((p: any) => p.id === over.id);

    // Get source phase
    const sourcePhaseId = activeTask.project_phase?.id || null;

    if (overTask) {
      const targetPhaseId = overTask.project_phase?.id || null;

      if (sourcePhaseId === targetPhaseId) {
        // Same phase reorder
        const phaseTasks = tasks
          .filter((t: any) => (t.project_phase?.id || null) === sourcePhaseId)
          .sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0));

        const oldIndex = phaseTasks.findIndex((t: any) => t.id === active.id);
        const newIndex = phaseTasks.findIndex((t: any) => t.id === over.id);

        if (oldIndex !== newIndex) {
          const newOrder = arrayMove(phaseTasks, oldIndex, newIndex);
          await reorderTasks.mutateAsync({
            taskIds: newOrder.map((t: any) => t.id),
            phaseId: sourcePhaseId,
          });
        }
      } else {
        // Moving to a different phase
        const targetPhaseTasks = tasks
          .filter((t: any) => (t.project_phase?.id || null) === targetPhaseId)
          .sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0));

        const targetIndex = targetPhaseTasks.findIndex((t: any) => t.id === over.id);

        await moveTask.mutateAsync({
          taskId: activeTask.id,
          targetPhaseId: targetPhaseId,
          sortOrder: targetIndex >= 0 ? targetIndex : targetPhaseTasks.length,
        });
      }
    } else if (overPhaseForTask) {
      // Dropping on a phase header - move to end of that phase
      const targetPhaseTasks = tasks
        .filter((t: any) => t.project_phase?.id === overPhaseForTask.id)
        .length;

      await moveTask.mutateAsync({
        taskId: activeTask.id,
        targetPhaseId: overPhaseForTask.id,
        sortOrder: targetPhaseTasks,
      });
    }
  };

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-8">
            <EmptyState
              icon={<Building2 className="h-12 w-12" />}
              title={`${t('project')} not found`}
              description={`This ${t('project').toLowerCase()} may have been deleted or you don't have access.`}
              action={
                <Link href="/projects">
                  <Button>Back to {t('projects')}</Button>
                </Link>
              }
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  const validNextStatuses = getValidNextProjectStatuses(project.status as any);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-4">
          <Link href="/projects">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold text-text-main">{project.name}</h1>
              <Badge variant={getProjectStatusVariant(project.status as any)}>
                {getProjectStatusLabel(project.status as any)}
              </Badge>
            </div>
            <div className="flex items-center gap-4 mt-1 text-sm text-text-sub">
              {project.client && (
                <Link
                  href={`/clients/${project.client.id}`}
                  className="flex items-center gap-1 hover:text-primary"
                >
                  <Building2 className="h-4 w-4" />
                  {project.client.name}
                </Link>
              )}
              {project.site && (
                <Link
                  href={`/sites/${project.site.id}`}
                  className="flex items-center gap-1 hover:text-primary"
                >
                  <Globe className="h-4 w-4" />
                  {project.site.name}
                </Link>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isPmOrAdmin && !project.budget_locked && (
            <Button variant="secondary" onClick={() => setIsLockBudgetOpen(true)}>
              <Lock className="h-4 w-4 mr-2" />
              Lock Budget
            </Button>
          )}
          <Button variant="ghost" onClick={() => setIsEditOpen(true)}>
            <Edit className="h-4 w-4 mr-2" />
            Edit
          </Button>
          <Button variant="ghost" onClick={() => setIsDeleteOpen(true)}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Budget Locked Banner - PM/Admin Only */}
      {isPmOrAdmin && project.budget_locked && (
        <Card className="border-green-500/50 bg-green-50/50">
          <CardContent className="py-3">
            <div className="flex items-center gap-3">
              <Lock className="h-5 w-5 text-green-600" />
              <div>
                <span className="font-medium text-green-700">Budget Locked</span>
                <span className="text-green-600 ml-2">
                  {project.budget_hours}h @ ${project.hourly_rate || 0}/hr = ${project.budget_amount?.toLocaleString() || 0}
                </span>
                {project.budget_locked_at && (
                  <span className="text-green-500 ml-2 text-sm">
                    ({new Date(project.budget_locked_at).toLocaleDateString()})
                  </span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Status Actions */}
      {validNextStatuses.length > 0 && (
        <Card>
          <CardContent className="py-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm text-text-sub mr-2">Move to:</span>
              {validNextStatuses.map((status) => (
                <Button
                  key={status}
                  variant="secondary"
                  size="sm"
                  onClick={() => handleStatusChange(status)}
                  disabled={updateStatus.isPending}
                >
                  {getProjectStatusLabel(status)}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats Cards */}
      <div className={`grid grid-cols-1 gap-4 ${isPmOrAdmin ? 'md:grid-cols-4' : 'md:grid-cols-3'}`}>
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <CheckSquare className="h-5 w-5 text-primary" />
              </div>
              <div>
                <div className="text-2xl font-semibold text-text-main">
                  {project.tasks_count || 0}
                </div>
                <div className="text-sm text-text-sub">{t('tasks')}</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10">
                <Users className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <div className="text-2xl font-semibold text-text-main">
                  {project.team_assignments?.length || 0}
                </div>
                <div className="text-sm text-text-sub">Team Members</div>
              </div>
            </div>
          </CardContent>
        </Card>
        {/* Estimates Card - PM/Admin Only */}
        {isPmOrAdmin && (
          <Card>
            <CardContent className="py-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-amber-500/10">
                  <Clock className="h-5 w-5 text-amber-500" />
                </div>
                <div className="flex-1">
                  <div className="text-2xl font-semibold text-text-main">
                    {project.calculated?.estimated_range || '-'}
                  </div>
                  <div className="text-sm text-text-sub">Estimated</div>
                </div>
              </div>
              {/* Progress Bar */}
              {project.calculated && project.calculated.total_energy_minutes > 0 && (
                <div className="mt-3">
                  <div className="flex justify-between text-xs text-text-sub mb-1">
                    <span>{project.calculated.progress_percent}% complete</span>
                    <span>{formatDuration(project.calculated.completed_energy_minutes)} / {formatDuration(project.calculated.total_energy_minutes)}</span>
                  </div>
                  <div className="h-2 bg-surface-2 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all duration-300"
                      style={{ width: `${project.calculated.progress_percent}%` }}
                    />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/10">
                <Calendar className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <div className="text-2xl font-semibold text-text-main">
                  {project.target_date
                    ? new Date(project.target_date).toLocaleDateString()
                    : '-'}
                </div>
                <div className="text-sm text-text-sub">Target Date</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="tasks">
        <TabsList>
          <TabsTrigger value="tasks">{t('tasks')}</TabsTrigger>
          <TabsTrigger value="workload">Workload</TabsTrigger>
          <TabsTrigger value="time">Time</TabsTrigger>
          <TabsTrigger value="team">Team</TabsTrigger>
          <TabsTrigger value="details">Details</TabsTrigger>
        </TabsList>

        <TabsContent value="tasks" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>{t('tasks')}</CardTitle>
              {isPmOrAdmin && (
                <Button size="sm" onClick={() => setIsAddingPhase(true)}>
                  <Plus className="h-4 w-4 mr-1" />
                  Add Phase
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {/* Add Phase Form */}
              {isAddingPhase && (
                <div className="flex items-center gap-2 p-3 mb-4 bg-surface-raised rounded-lg border border-border">
                  <Input
                    value={newPhaseName}
                    onChange={(e) => setNewPhaseName(e.target.value)}
                    placeholder="Phase name..."
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAddPhase();
                      if (e.key === 'Escape') {
                        setIsAddingPhase(false);
                        setNewPhaseName('');
                      }
                    }}
                  />
                  <Button size="sm" onClick={handleAddPhase} disabled={!newPhaseName.trim()}>
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setIsAddingPhase(false); setNewPhaseName(''); }}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              )}

              {(() => {
                // Build groups from phases (including empty ones)
                const tasksByPhase = new Map<string, { phase: any; tasks: Task[] }>();
                const unphased: Task[] = [];

                // First, initialize all phases from project.phases (so empty ones show up)
                (project.phases || []).forEach((phase: any) => {
                  tasksByPhase.set(phase.id, {
                    phase,
                    tasks: [],
                  });
                });

                // Then distribute tasks to their phases
                (project.tasks || []).forEach((task: any) => {
                  if (task.project_phase) {
                    const phaseId = task.project_phase.id;
                    if (tasksByPhase.has(phaseId)) {
                      tasksByPhase.get(phaseId)!.tasks.push(task);
                    } else {
                      // Phase exists on task but not in project.phases - shouldn't happen but handle it
                      tasksByPhase.set(phaseId, {
                        phase: task.project_phase,
                        tasks: [task],
                      });
                    }
                  } else {
                    unphased.push(task);
                  }
                });

                // Sort phases by sort_order
                const sortedPhases = Array.from(tasksByPhase.values()).sort(
                  (a, b) => (a.phase.sort_order || 0) - (b.phase.sort_order || 0)
                );

                // Build groups array for TaskList (sort tasks within each phase)
                const groups: TaskListGroup<Task>[] = sortedPhases.map(({ phase, tasks }) => ({
                  id: phase.id,
                  title: phase.name,
                  icon: phase.icon ? getIconOption(phase.icon)?.emoji : undefined,
                  tasks: [...tasks].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)),
                  collapsible: true,
                  // Store phase data in a custom property for the header renderer
                  ...({ _phase: phase } as any),
                }));

                // Add unphased tasks group if any (also sorted)
                if (unphased.length > 0) {
                  groups.push({
                    id: 'unphased',
                    title: `Other ${t('tasks')}`,
                    tasks: [...unphased].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)),
                    collapsible: true,
                  });
                }

                // Calculate max tasks for progress bar scaling
                const maxTasks = Math.max(...groups.map(g => g.tasks.length), 1);

                // Define columns for project context
                const columns = [
                  statusColumn({ editable: true }),
                  titleColumn({ editable: true }),
                  assigneeColumn({ editable: true }),
                  dueDateColumn({ editable: true }),
                  batteryColumn({ editable: true }),
                  mysteryColumn({ editable: true }),
                  rangedEstimateColumn(),
                  actionsColumn({ onViewDetails: (task) => router.push(`/tasks/${task.id}`) }),
                ];

                // Only show empty state if there are no phases at all
                if (groups.length === 0) {
                  return (
                    <EmptyState
                      icon={<CheckSquare className="h-10 w-10" />}
                      title={`No ${t('tasks').toLowerCase()} yet`}
                      description={`Create ${t('tasks').toLowerCase()} to track work for this ${t('project').toLowerCase()}`}
                      action={
                        <Link href={`/tasks?project_id=${project.id}`}>
                          <Button>Add {t('task')}</Button>
                        </Link>
                      }
                    />
                  );
                }

                // Sortable task wrapper component
                const SortableTaskWrapper = ({ task, children }: { task: Task; children: React.ReactNode }) => {
                  const {
                    attributes,
                    listeners,
                    setNodeRef,
                    transform,
                    transition,
                    isDragging,
                  } = useSortable({ id: task.id, disabled: !isPmOrAdmin });

                  const style = {
                    transform: CSS.Transform.toString(transform),
                    transition,
                  };

                  return (
                    <div
                      ref={setNodeRef}
                      style={style}
                      className={cn('flex items-center group', isDragging && 'opacity-50 z-50')}
                    >
                      {isPmOrAdmin && (
                        <button
                          {...attributes}
                          {...listeners}
                          className="cursor-grab active:cursor-grabbing p-1 mr-1 hover:bg-surface-raised rounded opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                          tabIndex={-1}
                        >
                          <GripVertical className="h-4 w-4 text-text-sub" />
                        </button>
                      )}
                      <div className="flex-1">{children}</div>
                    </div>
                  );
                };

                // Sortable phase header component
                const SortablePhaseHeader = ({ phase, isCollapsed, toggleCollapse, maxTasks, completedTasks, progressPercent, barWidth }: any) => {
                  const {
                    attributes,
                    listeners,
                    setNodeRef,
                    transform,
                    transition,
                    isDragging,
                  } = useSortable({ id: phase.id, disabled: !isPmOrAdmin });

                  const style = {
                    transform: CSS.Transform.toString(transform),
                    transition,
                  };

                  return (
                    <div
                      ref={setNodeRef}
                      style={style}
                      className={cn(
                        'flex items-center gap-2 p-3 bg-surface-alt border-b border-border',
                        isDragging && 'opacity-50 z-50'
                      )}
                    >
                      {/* Phase drag handle - PM/Admin only */}
                      {isPmOrAdmin && (
                        <button
                          {...attributes}
                          {...listeners}
                          className="cursor-grab active:cursor-grabbing p-1 hover:bg-surface rounded flex-shrink-0"
                          tabIndex={-1}
                        >
                          <GripVertical className="h-4 w-4 text-text-sub" />
                        </button>
                      )}

                      {/* Collapse toggle */}
                      <button
                        type="button"
                        onClick={toggleCollapse}
                        className="p-1 hover:bg-surface rounded flex-shrink-0"
                      >
                        {isCollapsed ? (
                          <ChevronRight className="h-4 w-4 text-text-sub" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-text-sub" />
                        )}
                      </button>

                      {/* Icon Picker - PM/Admin only */}
                      {isPmOrAdmin ? (
                        <InlineIconPicker
                          value={phase.icon || null}
                          onChange={(icon) => handleUpdatePhaseIcon(phase.id, icon)}
                          placeholder="📁"
                        />
                      ) : phase.icon ? (
                        <span className="text-lg leading-none flex-shrink-0">{getIconOption(phase.icon)?.emoji}</span>
                      ) : null}

                      {/* Phase Name - editable or display */}
                      {editingPhaseId === phase.id ? (
                        <div className="flex items-center gap-2 flex-1">
                          <Input
                            value={editingPhaseName}
                            onChange={(e) => setEditingPhaseName(e.target.value)}
                            autoFocus
                            className="h-8"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleUpdatePhaseName(phase.id);
                              if (e.key === 'Escape') setEditingPhaseId(null);
                            }}
                          />
                          <Button size="sm" onClick={() => handleUpdatePhaseName(phase.id)}>
                            <Check className="h-4 w-4" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingPhaseId(null)}>
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={toggleCollapse}
                            className="text-sm font-semibold text-text-main uppercase tracking-wide hover:text-primary transition-colors"
                          >
                            {phase.name}
                          </button>
                          {isPmOrAdmin && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 w-6 p-0 opacity-50 hover:opacity-100"
                              onClick={() => {
                                setEditingPhaseId(phase.id);
                                setEditingPhaseName(phase.name);
                              }}
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                          )}
                        </>
                      )}

                      {/* Task count */}
                      <span className="text-xs text-text-sub ml-auto">
                        {completedTasks}/{phase.taskCount || 0}
                      </span>

                      {/* Progress bar */}
                      <div className="w-24 h-2 bg-surface rounded-full overflow-hidden flex-shrink-0">
                        <div
                          className="h-full bg-surface-2 rounded-full relative"
                          style={{ width: `${barWidth}%` }}
                        >
                          <div
                            className="absolute inset-y-0 left-0 bg-primary rounded-full transition-all duration-300"
                            style={{ width: `${progressPercent}%` }}
                          />
                        </div>
                      </div>

                      {/* Delete button - PM/Admin only */}
                      {isPmOrAdmin && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0 text-red-500 hover:text-red-600 opacity-50 hover:opacity-100 flex-shrink-0"
                          onClick={() => {
                            setDeletePhaseId(phase.id);
                            setDeletePhaseName(phase.name);
                          }}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  );
                };

                // Get all task IDs for the current group's SortableContext
                const getTaskIdsForGroup = (group: TaskListGroup<Task>) => {
                  return group.tasks.map((t) => t.id);
                };

                return (
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                  >
                    <TaskList
                      groups={groups}
                      columns={columns}
                      onTaskClick={handleTaskClick}
                      onTaskUpdate={handleTaskUpdate}
                      showHeaders={true}
                      wrapTask={(task, children) => (
                        <SortableTaskWrapper task={task}>{children}</SortableTaskWrapper>
                      )}
                      wrapGroupContent={(group, children) => (
                        <SortableContext
                          items={getTaskIdsForGroup(group)}
                          strategy={verticalListSortingStrategy}
                        >
                          {children}
                        </SortableContext>
                      )}
                      renderGroupHeader={(group, isCollapsed, toggleCollapse) => {
                        const completedTasks = group.tasks.filter(
                          (t) => t.status === 'done' || t.status === 'abandoned'
                        ).length;
                        const progressPercent = group.tasks.length > 0
                          ? (completedTasks / group.tasks.length) * 100
                          : 0;
                        const barWidth = maxTasks > 0 ? (group.tasks.length / maxTasks) * 100 : 0;
                        const phase = (group as any)._phase;

                        // For phases, use the SortablePhaseHeader
                        if (phase) {
                          return (
                            <SortablePhaseHeader
                              phase={{ ...phase, taskCount: group.tasks.length }}
                              isCollapsed={isCollapsed}
                              toggleCollapse={toggleCollapse}
                              maxTasks={maxTasks}
                              completedTasks={completedTasks}
                              progressPercent={progressPercent}
                              barWidth={barWidth}
                            />
                          );
                        }

                        // For unphased group, use a simple header (no drag handle)
                        return (
                          <div className="flex items-center gap-2 p-3 bg-surface-alt border-b border-border">
                            <button
                              type="button"
                              onClick={toggleCollapse}
                              className="p-1 hover:bg-surface rounded flex-shrink-0"
                            >
                              {isCollapsed ? (
                                <ChevronRight className="h-4 w-4 text-text-sub" />
                              ) : (
                                <ChevronDown className="h-4 w-4 text-text-sub" />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={toggleCollapse}
                              className="text-sm font-semibold text-text-main uppercase tracking-wide hover:text-primary transition-colors"
                            >
                              {group.title}
                            </button>
                            <span className="text-xs text-text-sub ml-auto">
                              {completedTasks}/{group.tasks.length}
                            </span>
                            <div className="w-24 h-2 bg-surface rounded-full overflow-hidden flex-shrink-0">
                              <div
                                className="h-full bg-surface-2 rounded-full relative"
                                style={{ width: `${barWidth}%` }}
                              >
                                <div
                                  className="absolute inset-y-0 left-0 bg-primary rounded-full transition-all duration-300"
                                  style={{ width: `${progressPercent}%` }}
                                />
                              </div>
                            </div>
                          </div>
                        );
                      }}
                    renderGroupFooter={(group) => {
                      const phase = (group as any)._phase;
                      if (!isPmOrAdmin || !phase) return null;

                      const phaseId = phase.id;

                      if (addingTaskToPhaseId === phaseId) {
                        return (
                          <div className="flex items-center gap-2 p-2 border-t border-border">
                            <SopSelector
                              value={selectedSopId}
                              onChange={(sopId, _sop) => setSelectedSopId(sopId)}
                              className="!w-[200px] shrink-0"
                              showLabel={false}
                              showPreview={false}
                            />
                            <Input
                              value={newTaskTitle}
                              onChange={(e) => setNewTaskTitle(e.target.value)}
                              placeholder={`Add ${t('task').toLowerCase()}...`}
                              autoFocus
                              className="h-8 flex-1"
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleQuickAddTask(phaseId);
                                if (e.key === 'Escape') {
                                  setAddingTaskToPhaseId(null);
                                  setNewTaskTitle('');
                                  setSelectedSopId(null);
                                }
                              }}
                            />
                            <Button size="sm" onClick={() => handleQuickAddTask(phaseId)} disabled={!newTaskTitle.trim()}>
                              <Check className="h-4 w-4" />
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => { setAddingTaskToPhaseId(null); setNewTaskTitle(''); setSelectedSopId(null); }}>
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        );
                      }

                      return (
                        <div className="border-t border-border">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="w-full justify-start text-text-sub"
                            onClick={() => setAddingTaskToPhaseId(phaseId)}
                          >
                            <Plus className="h-4 w-4 mr-2" />
                            Add {t('task')}
                          </Button>
                        </div>
                      );
                    }}
                  />

                    {/* Drag Overlay for visual feedback */}
                    <DragOverlay>
                      {activeId && activeType === 'phase' && (
                        <div className="bg-surface border border-primary rounded-lg p-3 shadow-lg opacity-90">
                          <span className="font-medium">
                            {(project.phases || []).find((p: any) => p.id === activeId)?.name}
                          </span>
                        </div>
                      )}
                      {activeId && activeType === 'task' && (
                        <div className="bg-surface border border-primary rounded-lg p-3 shadow-lg opacity-90">
                          <span className="font-medium">
                            {(project.tasks || []).find((t: any) => t.id === activeId)?.title}
                          </span>
                        </div>
                      )}
                    </DragOverlay>
                  </DndContext>
                );
              })()}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="workload" className="mt-4">
          <ProjectWorkloadTab
            projectId={project.id}
            tasks={project.tasks || []}
            teamAssignments={project.team_assignments || []}
          />
        </TabsContent>

        <TabsContent value="time" className="mt-4">
          <ProjectTimeTab
            projectId={project.id}
            budgetHours={project.budget_hours}
            budgetLocked={project.budget_locked}
          />
        </TabsContent>

        <TabsContent value="team" className="mt-4">
          <ProjectTeamTab projectId={project.id} tasks={project.tasks} />
        </TabsContent>

        <TabsContent value="details" className="mt-4 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <dt className="text-sm text-text-sub">Type</dt>
                  <dd className="text-text-main capitalize">{project.type}</dd>
                </div>
                <div>
                  <dt className="text-sm text-text-sub">Budget</dt>
                  <dd className="text-text-main">
                    {project.budget_amount
                      ? `$${project.budget_amount.toLocaleString()}`
                      : '-'}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-text-sub">Start Date</dt>
                  <dd className="text-text-main">
                    {project.start_date
                      ? new Date(project.start_date).toLocaleDateString()
                      : '-'}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-text-sub">Target Date</dt>
                  <dd className="text-text-main">
                    {project.target_date
                      ? new Date(project.target_date).toLocaleDateString()
                      : '-'}
                  </dd>
                </div>
                {project.completed_date && (
                  <div>
                    <dt className="text-sm text-text-sub">Completed Date</dt>
                    <dd className="text-text-main">
                      {new Date(project.completed_date).toLocaleDateString()}
                    </dd>
                  </div>
                )}
                <div>
                  <dt className="text-sm text-text-sub">Retainer</dt>
                  <dd className="text-text-main">{project.is_retainer ? 'Yes' : 'No'}</dd>
                </div>
                {project.description && (
                  <div className="md:col-span-2">
                    <dt className="text-sm text-text-sub">Description</dt>
                    <dd className="text-text-main whitespace-pre-wrap">
                      {project.description}
                    </dd>
                  </div>
                )}
                {project.notes && (
                  <div className="md:col-span-2">
                    <dt className="text-sm text-text-sub">Notes</dt>
                    <dd className="text-text-main whitespace-pre-wrap">{project.notes}</dd>
                  </div>
                )}
              </dl>
            </CardContent>
          </Card>

          {/* Resource Links Section */}
          <ResourceLinks projectId={projectId} />

          {/* Milestones Section */}
          <MilestoneList projectId={projectId} />
        </TabsContent>
      </Tabs>

      {/* Edit Modal */}
      <Modal open={isEditOpen} onOpenChange={setIsEditOpen}>
        <ModalContent size="lg">
          <ModalHeader>
            <ModalTitle>Edit {t('project')}</ModalTitle>
          </ModalHeader>
          <ModalBody>
            <ProjectForm
              project={project}
              onSuccess={() => setIsEditOpen(false)}
              onCancel={() => setIsEditOpen(false)}
            />
          </ModalBody>
        </ModalContent>
      </Modal>

      {/* Delete Confirmation */}
      <Modal open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <ModalContent size="sm">
          <ModalHeader>
            <ModalTitle>Delete {t('project')}</ModalTitle>
          </ModalHeader>
          <ModalBody>
            <p className="text-text-sub">
              Are you sure you want to delete this {t('project').toLowerCase()}? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3 mt-4">
              <Button variant="ghost" onClick={() => setIsDeleteOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={deleteProject.isPending}
              >
                {deleteProject.isPending ? 'Deleting...' : 'Delete'}
              </Button>
            </div>
          </ModalBody>
        </ModalContent>
      </Modal>

      {/* Lock Budget Modal */}
      <Modal open={isLockBudgetOpen} onOpenChange={setIsLockBudgetOpen}>
        <ModalContent size="md">
          <ModalHeader>
            <ModalTitle>Lock Budget</ModalTitle>
          </ModalHeader>
          <ModalBody>
            <p className="text-text-sub mb-4">
              Lock the budget based on the current estimate. Once locked, this becomes the agreed-upon budget for the project.
            </p>

            <div className="bg-surface-2 rounded-lg p-4 mb-4">
              <div className="text-sm text-text-sub mb-1">Calculated Estimate (from {t('tasks').toLowerCase()})</div>
              <div className="text-lg font-medium text-text-main">
                {project.calculated?.estimated_range || `No ${t('tasks').toLowerCase()} yet`}
              </div>
            </div>

            <div className="space-y-4">
              <Input
                label="Budget Hours"
                type="number"
                step="0.5"
                min="0"
                value={budgetHours}
                onChange={(e) => setBudgetHours(e.target.value)}
                placeholder="Hours to budget"
              />
              <Input
                label="Hourly Rate ($)"
                type="number"
                step="0.01"
                min="0"
                value={hourlyRate}
                onChange={(e) => setHourlyRate(e.target.value)}
                placeholder="Rate per hour"
              />
              <Input
                label="Total Budget ($)"
                type="number"
                step="0.01"
                min="0"
                value={budgetAmount}
                onChange={(e) => setBudgetAmount(e.target.value)}
                placeholder="Total budget amount"
              />
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <Button variant="ghost" onClick={() => setIsLockBudgetOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleLockBudget}
                disabled={lockBudget.isPending || !budgetHours}
              >
                <Lock className="h-4 w-4 mr-2" />
                {lockBudget.isPending ? 'Locking...' : 'Lock Budget'}
              </Button>
            </div>
          </ModalBody>
        </ModalContent>
      </Modal>

      {/* Delete Phase Confirmation */}
      <Modal open={!!deletePhaseId} onOpenChange={(open) => !open && setDeletePhaseId(null)}>
        <ModalContent size="sm">
          <ModalHeader>
            <ModalTitle>Delete Phase</ModalTitle>
          </ModalHeader>
          <ModalBody>
            <p className="text-text-sub">
              Are you sure you want to delete <strong>{deletePhaseName}</strong>? Tasks in this phase will become unassigned to any phase.
            </p>
            <div className="flex justify-end gap-3 mt-4">
              <Button variant="ghost" onClick={() => setDeletePhaseId(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDeletePhase}
                disabled={deletePhase.isPending}
              >
                {deletePhase.isPending ? 'Deleting...' : 'Delete'}
              </Button>
            </div>
          </ModalBody>
        </ModalContent>
      </Modal>

      {/* Task Peek Drawer */}
      <TaskPeekDrawer
        taskId={peekTaskId}
        open={isPeekOpen}
        onOpenChange={setIsPeekOpen}
      />
    </div>
  );
}
