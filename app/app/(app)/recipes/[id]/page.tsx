'use client';

import * as React from 'react';
import { use } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  BookOpen,
  Clock,
  ListTodo,
  Plus,
  Trash2,
  GripVertical,
  ChevronDown,
  ChevronRight,
  Pencil,
  Check,
  X,
  Map,
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
  DragOverEvent,
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
  useRecipe,
  useUpdateRecipe,
  useDeleteRecipe,
  useCreatePhase,
  useUpdatePhase,
  useDeletePhase,
  useReorderPhases,
  useDeleteTask,
  useReorderTasks,
  useMoveTask,
  type RecipeTask,
  type RecipePhase,
} from '@/lib/hooks/use-recipes';
import { useTerminology } from '@/lib/hooks/use-terminology';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalBody,
  ModalFooter,
} from '@/components/ui/modal';
import { RecipeTaskForm } from '@/components/domain/recipes/recipe-task-form';
import { InlineTaskAdder } from '@/components/domain/recipes/inline-task-adder';
import {
  getEnergyLabel,
  getMysteryFactorLabel,
} from '@/lib/calculations/energy';
import { MysteryFactor } from '@prisma/client';
import { cn } from '@/lib/utils/cn';
import { InlineIconPicker } from '@/components/ui/icon-picker';
import { getIconOption } from '@/lib/config/icons';

interface Props {
  params: Promise<{ id: string }>;
}

// Inline editable text component
function InlineText({
  value,
  onChange,
  className = '',
  placeholder = 'Click to edit...',
  as = 'input',
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  as?: 'input' | 'textarea';
}) {
  const [isEditing, setIsEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  const inputRef = React.useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  React.useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      if (inputRef.current instanceof HTMLInputElement) {
        inputRef.current.select();
      }
    }
  }, [isEditing]);

  React.useEffect(() => {
    setDraft(value);
  }, [value]);

  const handleSave = () => {
    if (draft.trim() !== value) {
      onChange(draft.trim());
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && as === 'input') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      setDraft(value);
      setIsEditing(false);
    }
  };

  if (isEditing) {
    const Component = as === 'textarea' ? 'textarea' : 'input';
    return (
      <Component
        ref={inputRef as React.Ref<HTMLInputElement & HTMLTextAreaElement>}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={handleSave}
        onKeyDown={handleKeyDown}
        className={`w-full px-2 py-1 rounded border border-primary bg-surface focus:outline-none focus:ring-2 focus:ring-primary ${className}`}
        rows={as === 'textarea' ? 3 : undefined}
      />
    );
  }

  return (
    <span
      onClick={() => setIsEditing(true)}
      className={`cursor-pointer hover:bg-surface-raised px-2 py-1 -mx-2 rounded transition-colors ${className} ${!value ? 'text-text-sub italic' : ''}`}
    >
      {value || placeholder}
    </span>
  );
}

// Sortable Phase Item
function SortablePhase({
  phase,
  isExpanded,
  onToggle,
  onEdit,
  onDelete,
  onEditTask,
  onDeleteTask,
  recipeId,
  isEditing,
  editingName,
  setEditingName,
  onSaveEdit,
  onCancelEdit,
  onUpdateIcon,
}: {
  phase: RecipePhase;
  isExpanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onEditTask: (task: RecipeTask) => void;
  onDeleteTask: (task: RecipeTask) => void;
  recipeId: string;
  isEditing: boolean;
  editingName: string;
  setEditingName: (name: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onUpdateIcon: (icon: string) => void;
}) {
  const [isAddingTask, setIsAddingTask] = React.useState(false);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: phase.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'border border-border rounded-lg',
        isDragging && 'opacity-50 shadow-lg'
      )}
    >
      {/* Phase Header */}
      <div className="flex items-center gap-2 p-3 bg-surface-raised rounded-t-lg border-b border-border">
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing p-1 hover:bg-surface rounded"
        >
          <GripVertical className="h-4 w-4 text-text-sub" />
        </button>

        <button
          onClick={onToggle}
          className="p-1 hover:bg-surface rounded"
        >
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-text-sub" />
          ) : (
            <ChevronRight className="h-4 w-4 text-text-sub" />
          )}
        </button>

        {/* Icon Picker - always visible */}
        <InlineIconPicker
          value={phase.icon || null}
          onChange={onUpdateIcon}
          placeholder="📁"
        />

        {isEditing ? (
          <div className="flex items-center gap-2 flex-1">
            <Input
              value={editingName}
              onChange={(e) => setEditingName(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSaveEdit();
                if (e.key === 'Escape') onCancelEdit();
              }}
            />
            <Button size="sm" onClick={onSaveEdit}>
              <Check className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="ghost" onClick={onCancelEdit}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <>
            <span className="font-medium text-text-main flex-1">{phase.name}</span>
            <span className="text-sm text-text-sub">{phase.tasks.length} tasks</span>
            <Button size="sm" variant="ghost" onClick={onEdit}>
              <Pencil className="h-3 w-3" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-red-500 hover:text-red-600"
              onClick={onDelete}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </>
        )}
      </div>

      {/* Phase Content (Tasks) */}
      {isExpanded && (
        <div className="p-3 space-y-2">
          <SortableContext
            items={phase.tasks.map((t) => t.id)}
            strategy={verticalListSortingStrategy}
          >
            {phase.tasks.map((task, index) => (
              <SortableTask
                key={task.id}
                task={task}
                index={index}
                onEdit={() => onEditTask(task)}
                onDelete={() => onDeleteTask(task)}
              />
            ))}
          </SortableContext>

          {isAddingTask ? (
            <InlineTaskAdder
              recipeId={recipeId}
              phaseId={phase.id}
              onClose={() => setIsAddingTask(false)}
            />
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-text-sub"
              onClick={() => setIsAddingTask(true)}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Task
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// Sortable Task Item
function SortableTask({
  task,
  index,
  onEdit,
  onDelete,
}: {
  task: RecipeTask;
  index: number;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  // Display title: use override if set, otherwise SOP title
  const displayTitle = task.title ?? task.sop?.title ?? 'Untitled';

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-start gap-3 p-3 bg-surface rounded-lg border border-border-warm',
        isDragging && 'opacity-50 shadow-lg'
      )}
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing p-1 hover:bg-surface-raised rounded mt-0.5"
      >
        <GripVertical className="h-4 w-4 text-text-sub" />
      </button>

      <span className="text-text-sub w-6 text-center text-sm">{index + 1}.</span>

      <div className="flex-1 min-w-0">
        <div className="font-medium text-text-main truncate">{displayTitle}</div>
        <div className="flex items-center gap-2 mt-1 text-sm text-text-sub flex-wrap">
          {task.sop?.function && (
            <Badge variant="default">{task.sop.function.name}</Badge>
          )}
          {task.sop?.energy_estimate && (
            <span>{getEnergyLabel(task.sop.energy_estimate)}</span>
          )}
          {task.sop?.mystery_factor && task.sop.mystery_factor !== 'none' && (
            <span>• {getMysteryFactorLabel(task.sop.mystery_factor as MysteryFactor)}</span>
          )}
          {task.is_variable && (
            <Badge variant="purple">Variable</Badge>
          )}
        </div>
      </div>

      <Button size="sm" variant="ghost" onClick={onEdit}>
        <Pencil className="h-3 w-3" />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="text-red-500 hover:text-red-600"
        onClick={onDelete}
      >
        <Trash2 className="h-3 w-3" />
      </Button>
    </div>
  );
}

const typeOptions = [
  { value: 'project', label: 'Project' },
  { value: 'retainer', label: 'Retainer' },
  { value: 'internal', label: 'Internal' },
];

export default function RecipeDetailPage({ params }: Props) {
  const { id } = use(params);
  const router = useRouter();
  const { t } = useTerminology();
  const { data: recipe, isLoading, error } = useRecipe(id);

  const updateRecipe = useUpdateRecipe();
  const deleteRecipe = useDeleteRecipe();
  const createPhase = useCreatePhase();
  const updatePhase = useUpdatePhase();
  const deletePhase = useDeletePhase();
  const reorderPhases = useReorderPhases();
  const deleteTask = useDeleteTask();
  const reorderTasks = useReorderTasks();
  const moveTask = useMoveTask();

  // UI state
  const [expandedPhases, setExpandedPhases] = React.useState<Set<string>>(new Set());
  const [isAddingPhase, setIsAddingPhase] = React.useState(false);
  const [newPhaseName, setNewPhaseName] = React.useState('');
  const [editingPhaseId, setEditingPhaseId] = React.useState<string | null>(null);
  const [editingPhaseName, setEditingPhaseName] = React.useState('');

  // Task modal state
  const [taskModalOpen, setTaskModalOpen] = React.useState(false);
  const [taskModalPhaseId, setTaskModalPhaseId] = React.useState<string | null>(null);
  const [editingTask, setEditingTask] = React.useState<RecipeTask | null>(null);

  // Delete modal state
  const [isDeleteOpen, setIsDeleteOpen] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<{
    type: 'recipe' | 'phase' | 'task';
    id: string;
    phaseId?: string;
    name: string;
  } | null>(null);

  // Drag state
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

  // Expand all phases by default when recipe loads
  React.useEffect(() => {
    if (recipe?.phases) {
      setExpandedPhases(new Set(recipe.phases.map((p) => p.id)));
    }
  }, [recipe?.phases]);

  const togglePhase = (phaseId: string) => {
    setExpandedPhases((prev) => {
      const next = new Set(prev);
      if (next.has(phaseId)) {
        next.delete(phaseId);
      } else {
        next.add(phaseId);
      }
      return next;
    });
  };

  const handleUpdateRecipe = async (field: string, value: unknown) => {
    await updateRecipe.mutateAsync({ id, data: { [field]: value } });
  };

  const handleAddPhase = async () => {
    if (!newPhaseName.trim()) return;
    await createPhase.mutateAsync({ recipeId: id, data: { name: newPhaseName.trim() } });
    setNewPhaseName('');
    setIsAddingPhase(false);
  };

  const handleUpdatePhase = async (phaseId: string) => {
    if (!editingPhaseName.trim()) return;
    await updatePhase.mutateAsync({ recipeId: id, phaseId, data: { name: editingPhaseName.trim() } });
    setEditingPhaseId(null);
  };

  const handleDeletePhase = async (phaseId: string) => {
    await deletePhase.mutateAsync({ recipeId: id, phaseId });
    setIsDeleteOpen(false);
    setDeleteTarget(null);
  };

  const handleDeleteTask = async (phaseId: string, taskId: string) => {
    await deleteTask.mutateAsync({ recipeId: id, phaseId, taskId });
    setIsDeleteOpen(false);
    setDeleteTarget(null);
  };

  const handleDeleteRecipe = async () => {
    await deleteRecipe.mutateAsync(id);
    router.push('/recipes');
  };

  // Open task modal for editing
  const openEditTaskModal = (task: RecipeTask, phaseId: string) => {
    setTaskModalPhaseId(phaseId);
    setEditingTask(task);
    setTaskModalOpen(true);
  };

  // Handle task modal success
  const handleTaskModalSuccess = () => {
    setTaskModalOpen(false);
    setTaskModalPhaseId(null);
    setEditingTask(null);
  };

  // DnD handlers
  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    setActiveId(active.id);

    // Determine if dragging a phase or task
    const isPhase = recipe?.phases?.some((p) => p.id === active.id);
    setActiveType(isPhase ? 'phase' : 'task');
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    setActiveType(null);

    if (!over || active.id === over.id || !recipe?.phases) return;

    // Check if dragging phases
    const activePhase = recipe.phases.find((p) => p.id === active.id);
    const overPhase = recipe.phases.find((p) => p.id === over.id);

    if (activePhase && overPhase) {
      // Reordering phases
      const oldIndex = recipe.phases.findIndex((p) => p.id === active.id);
      const newIndex = recipe.phases.findIndex((p) => p.id === over.id);

      if (oldIndex !== newIndex) {
        const newOrder = arrayMove(recipe.phases, oldIndex, newIndex);
        await reorderPhases.mutateAsync({
          recipeId: id,
          phaseIds: newOrder.map((p) => p.id),
        });
      }
      return;
    }

    // Check if dragging tasks within the same phase
    for (const phase of recipe.phases) {
      const activeTask = phase.tasks.find((t) => t.id === active.id);
      const overTask = phase.tasks.find((t) => t.id === over.id);

      if (activeTask && overTask) {
        // Same phase reorder
        const oldIndex = phase.tasks.findIndex((t) => t.id === active.id);
        const newIndex = phase.tasks.findIndex((t) => t.id === over.id);

        if (oldIndex !== newIndex) {
          const newOrder = arrayMove(phase.tasks, oldIndex, newIndex);
          await reorderTasks.mutateAsync({
            recipeId: id,
            phaseId: phase.id,
            taskIds: newOrder.map((t) => t.id),
          });
        }
        return;
      }
    }

    // Task moving between phases
    let sourcePhase: RecipePhase | undefined;
    let targetPhase: RecipePhase | undefined;
    let activeTask: RecipeTask | undefined;

    for (const phase of recipe.phases) {
      const task = phase.tasks.find((t) => t.id === active.id);
      if (task) {
        sourcePhase = phase;
        activeTask = task;
      }
      if (phase.id === over.id || phase.tasks.some((t) => t.id === over.id)) {
        targetPhase = phase;
      }
    }

    if (activeTask && sourcePhase && targetPhase && sourcePhase.id !== targetPhase.id) {
      // Find target position
      const overTask = targetPhase.tasks.find((t) => t.id === over.id);
      const targetIndex = overTask
        ? targetPhase.tasks.findIndex((t) => t.id === over.id)
        : targetPhase.tasks.length;

      await moveTask.mutateAsync({
        recipeId: id,
        taskId: activeTask.id,
        targetPhaseId: targetPhase.id,
        sortOrder: targetIndex,
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error || !recipe) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-8">
            <EmptyState
              icon={<BookOpen className="h-12 w-12" />}
              title={`${t('recipe')} not found`}
              action={
                <Link href="/recipes">
                  <Button>Back to {t('recipes')}</Button>
                </Link>
              }
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  const taskCount = recipe.phases?.reduce((sum, p) => sum + p.tasks.length, 0) || 0;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/recipes">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
        </Link>
      </div>

      {/* Title & Meta */}
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <h1 className="text-2xl font-semibold text-text-main flex items-center gap-3">
            <BookOpen className="h-6 w-6" />
            <InlineText
              value={recipe.name}
              onChange={(value) => handleUpdateRecipe('name', value)}
              className="text-2xl font-semibold"
            />
          </h1>
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Switch
                checked={recipe.is_active}
                onCheckedChange={(checked) => handleUpdateRecipe('is_active', checked)}
              />
              <span className="text-sm text-text-sub">
                {recipe.is_active ? 'Active' : 'Draft'}
              </span>
            </div>
            <Select
              options={typeOptions}
              value={recipe.default_type || 'project'}
              onChange={(value) => handleUpdateRecipe('default_type', value)}
              className="w-32"
            />
            <div className="flex items-center gap-2 border-l border-border pl-3">
              <Map className="h-4 w-4 text-text-sub" />
              <Switch
                checked={recipe.requires_sitemap}
                onCheckedChange={(checked) => handleUpdateRecipe('requires_sitemap', checked)}
              />
              <span className="text-sm text-text-sub">
                Requires Sitemap
              </span>
            </div>
          </div>
        </div>
        <Button
          variant="ghost"
          className="text-red-500 hover:text-red-600 hover:bg-red-50"
          onClick={() => {
            setDeleteTarget({ type: 'recipe', id, name: recipe.name });
            setIsDeleteOpen(true);
          }}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {/* Description */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Description</CardTitle>
        </CardHeader>
        <CardContent>
          <RichTextEditor
            content={recipe.description as any}
            onChange={(content) => handleUpdateRecipe('description', content)}
            placeholder="Add a description..."
          />
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <ListTodo className="h-5 w-5 text-primary" />
              </div>
              <div>
                <div className="text-2xl font-semibold text-text-main">{taskCount}</div>
                <div className="text-sm text-text-sub">{t('tasks')}</div>
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
                  {recipe.phases?.length || 0}
                </div>
                <div className="text-sm text-text-sub">Phases</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Phases & Tasks with Drag and Drop */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">Phases & {t('tasks')}</CardTitle>
          <Button size="sm" onClick={() => setIsAddingPhase(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Add Phase
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Add Phase Form */}
          {isAddingPhase && (
            <div className="flex items-center gap-2 p-3 bg-surface-raised rounded-lg">
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

          {/* Phase List with DnD */}
          {(!recipe.phases || recipe.phases.length === 0) && !isAddingPhase ? (
            <EmptyState
              icon={<Clock className="h-8 w-8" />}
              title="No phases yet"
              description="Add phases to organize your tasks"
            />
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={recipe.phases?.map((p) => p.id) || []}
                strategy={verticalListSortingStrategy}
              >
                {recipe.phases?.map((phase) => (
                  <SortablePhase
                    key={phase.id}
                    phase={phase}
                    recipeId={id}
                    isExpanded={expandedPhases.has(phase.id)}
                    onToggle={() => togglePhase(phase.id)}
                    onEdit={() => {
                      setEditingPhaseId(phase.id);
                      setEditingPhaseName(phase.name);
                    }}
                    onDelete={() => {
                      setDeleteTarget({ type: 'phase', id: phase.id, name: phase.name });
                      setIsDeleteOpen(true);
                    }}
                    onEditTask={(task) => openEditTaskModal(task, phase.id)}
                    onDeleteTask={(task) => {
                      const title = task.title ?? task.sop?.title ?? 'Untitled';
                      setDeleteTarget({ type: 'task', id: task.id, phaseId: phase.id, name: title });
                      setIsDeleteOpen(true);
                    }}
                    isEditing={editingPhaseId === phase.id}
                    editingName={editingPhaseName}
                    setEditingName={setEditingPhaseName}
                    onSaveEdit={() => handleUpdatePhase(phase.id)}
                    onCancelEdit={() => setEditingPhaseId(null)}
                    onUpdateIcon={(icon) => updatePhase.mutate({ recipeId: id, phaseId: phase.id, data: { icon } })}
                  />
                ))}
              </SortableContext>

              <DragOverlay>
                {activeId && activeType === 'phase' && (
                  <div className="bg-surface border border-primary rounded-lg p-3 shadow-lg opacity-90">
                    <span className="font-medium">
                      {recipe.phases?.find((p) => p.id === activeId)?.name}
                    </span>
                  </div>
                )}
                {activeId && activeType === 'task' && (
                  <div className="bg-surface border border-primary rounded-lg p-3 shadow-lg opacity-90">
                    <span className="font-medium">
                      {(() => {
                        for (const phase of recipe.phases || []) {
                          const task = phase.tasks.find((t) => t.id === activeId);
                          if (task) return task.title ?? task.sop?.title ?? 'Untitled';
                        }
                        return 'Task';
                      })()}
                    </span>
                  </div>
                )}
              </DragOverlay>
            </DndContext>
          )}
        </CardContent>
      </Card>

      {/* Task Add/Edit Modal */}
      <Modal open={taskModalOpen} onOpenChange={setTaskModalOpen}>
        <ModalContent className="max-w-lg">
          <ModalHeader>
            <ModalTitle>Edit Task</ModalTitle>
          </ModalHeader>
          <ModalBody>
            {taskModalPhaseId && (
              <RecipeTaskForm
                recipeId={id}
                phaseId={taskModalPhaseId}
                task={editingTask ? {
                  id: editingTask.id,
                  sop_id: editingTask.sop_id,
                  title: editingTask.title,
                  is_variable: editingTask.is_variable,
                  variable_source: editingTask.variable_source,
                  sop: editingTask.sop,
                } : undefined}
                onSuccess={handleTaskModalSuccess}
                onCancel={() => setTaskModalOpen(false)}
              />
            )}
          </ModalBody>
        </ModalContent>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <ModalContent>
          <ModalHeader>
            <ModalTitle>Delete {deleteTarget?.type}?</ModalTitle>
          </ModalHeader>
          <ModalBody>
            <p className="text-text-main">
              Are you sure you want to delete <strong>{deleteTarget?.name}</strong>?
              {deleteTarget?.type === 'phase' && ' This will also delete all tasks in this phase.'}
              {deleteTarget?.type === 'recipe' && ' This action cannot be undone.'}
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" onClick={() => setIsDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              className="bg-red-500 hover:bg-red-600 text-white"
              onClick={() => {
                if (deleteTarget?.type === 'recipe') {
                  handleDeleteRecipe();
                } else if (deleteTarget?.type === 'phase') {
                  handleDeletePhase(deleteTarget.id);
                } else if (deleteTarget?.type === 'task' && deleteTarget.phaseId) {
                  handleDeleteTask(deleteTarget.phaseId, deleteTarget.id);
                }
              }}
            >
              Delete
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
