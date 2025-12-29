'use client';

import * as React from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
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
  FileText,
  Plus,
  Trash2,
  GripVertical,
  ChevronRight,
  ChevronLeft,
  Grid3X3,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils/cn';
import { StepHeader } from './wizard-layout';
import { PageTaskMatrix, getDefaultTaskSelection } from './page-task-matrix';
import { useRecipe, type RecipeTask } from '@/lib/hooks/use-recipes';
import type { WizardPage } from '@/lib/hooks/use-project-wizard';

interface WizardStep3SitemapProps {
  recipeId: string;
  pages: WizardPage[];
  onAddPage: (page: Omit<WizardPage, 'id'>) => void;
  onUpdatePage: (id: string, updates: Partial<WizardPage>) => void;
  onRemovePage: (id: string) => void;
  onSetPages: (pages: WizardPage[]) => void;
  onToggleTask: (pageId: string, taskId: string) => void;
  onSelectAllColumn: (taskId: string) => void;
  onClearAllColumn: (taskId: string) => void;
  onSetPageVariableTasks: (pageId: string, taskIds: string[]) => void;
}

const PAGE_TYPE_OPTIONS = [
  { value: 'standard', label: 'Standard Page' },
  { value: 'landing', label: 'Landing Page' },
  { value: 'blog_post', label: 'Blog Post' },
  { value: 'blog_listing', label: 'Blog Listing' },
  { value: 'product', label: 'Product Page' },
  { value: 'category', label: 'Category Page' },
  { value: 'contact', label: 'Contact Page' },
  { value: 'form', label: 'Form Page' },
  { value: 'other', label: 'Other' },
];

const QUICK_ADD_PAGES = [
  { name: 'Home', pageType: 'landing', depth: 0 },
  { name: 'About', pageType: 'standard', depth: 0 },
  { name: 'Services', pageType: 'standard', depth: 0 },
  { name: 'Contact', pageType: 'contact', depth: 0 },
  { name: 'Blog', pageType: 'blog_listing', depth: 0 },
  { name: 'FAQ', pageType: 'standard', depth: 0 },
];

const MAX_DEPTH = 3;

interface SortablePageItemProps {
  page: WizardPage;
  onUpdate: (id: string, updates: Partial<WizardPage>) => void;
  onRemove: (id: string) => void;
  onIndent: (id: string) => void;
  onOutdent: (id: string) => void;
  canIndent: boolean;
  canOutdent: boolean;
  taskCount: number;
  totalTasks: number;
}

function SortablePageItem({
  page,
  onUpdate,
  onRemove,
  onIndent,
  onOutdent,
  canIndent,
  canOutdent,
  taskCount,
  totalTasks,
}: SortablePageItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: page.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-center gap-2 p-3 rounded-lg border border-border bg-surface-1 group',
        isDragging && 'opacity-50 shadow-lg z-50'
      )}
    >
      {/* Indentation visual */}
      <div
        className="flex items-center"
        style={{ marginLeft: `${page.depth * 24}px` }}
      >
        {/* Drag handle */}
        <button
          {...attributes}
          {...listeners}
          className="p-1 cursor-grab active:cursor-grabbing text-text-sub hover:text-text-main touch-none"
        >
          <GripVertical className="h-4 w-4" />
        </button>

        {/* Indent/Outdent buttons */}
        <div className="flex gap-0.5 mr-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOutdent(page.id)}
            disabled={!canOutdent}
            className="h-6 w-6 p-0"
            title="Outdent (make parent)"
          >
            <ChevronLeft className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onIndent(page.id)}
            disabled={!canIndent}
            className="h-6 w-6 p-0"
            title="Indent (make child)"
          >
            <ChevronRight className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Page name */}
      <div className="flex-1 min-w-0">
        <Input
          value={page.name}
          onChange={(e) => onUpdate(page.id, { name: e.target.value })}
          className="h-8"
        />
      </div>

      {/* Page type */}
      <div className="w-36">
        <Select
          label=""
          value={page.pageType}
          onChange={(value) => onUpdate(page.id, { pageType: value })}
          options={PAGE_TYPE_OPTIONS}
          className="h-8"
        />
      </div>

      {/* Task count badge */}
      <div className="w-20 text-center">
        <span
          className={cn(
            'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
            taskCount === totalTasks
              ? 'bg-success/10 text-success'
              : taskCount > 0
              ? 'bg-warning/10 text-warning'
              : 'bg-surface-alt text-text-sub'
          )}
        >
          {taskCount}/{totalTasks} tasks
        </span>
      </div>

      {/* Remove button */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onRemove(page.id)}
        className="h-8 w-8 p-0 text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

export function WizardStep3Sitemap({
  recipeId,
  pages,
  onAddPage,
  onUpdatePage,
  onRemovePage,
  onSetPages,
  onToggleTask,
  onSelectAllColumn,
  onClearAllColumn,
  onSetPageVariableTasks,
}: WizardStep3SitemapProps) {
  const [newPageName, setNewPageName] = React.useState('');

  // Fetch recipe to get variable tasks
  const { data: recipe, isLoading: isLoadingRecipe } = useRecipe(recipeId);

  // Extract variable tasks from recipe
  const variableTasks = React.useMemo(() => {
    if (!recipe?.phases) return [];

    const tasks: RecipeTask[] = [];
    recipe.phases.forEach((phase) => {
      phase.tasks.forEach((task) => {
        if (task.is_variable && task.variable_source === 'sitemap_page') {
          tasks.push(task);
        }
      });
    });
    return tasks;
  }, [recipe]);

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

  const handleAddPage = () => {
    if (!newPageName.trim()) return;
    const isFirstPage = pages.length === 0;
    onAddPage({
      name: newPageName.trim(),
      pageType: 'standard',
      depth: 0,
      selectedVariableTasks: getDefaultTaskSelection(variableTasks, isFirstPage),
    });
    setNewPageName('');
  };

  const handleQuickAdd = (page: (typeof QUICK_ADD_PAGES)[number]) => {
    if (pages.some((p) => p.name.toLowerCase() === page.name.toLowerCase())) {
      return;
    }
    const isFirstPage = pages.length === 0;
    onAddPage({
      ...page,
      selectedVariableTasks: getDefaultTaskSelection(variableTasks, isFirstPage),
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = pages.findIndex((p) => p.id === active.id);
      const newIndex = pages.findIndex((p) => p.id === over.id);

      if (oldIndex !== -1 && newIndex !== -1) {
        const newPages = arrayMove(pages, oldIndex, newIndex);
        onSetPages(newPages);
      }
    }
  };

  const handleIndent = (id: string) => {
    const index = pages.findIndex((p) => p.id === id);
    if (index <= 0) return;

    const page = pages[index];
    const prevPage = pages[index - 1];

    if (page.depth < MAX_DEPTH && prevPage.depth >= page.depth) {
      onUpdatePage(id, { depth: page.depth + 1 });
    }
  };

  const handleOutdent = (id: string) => {
    const page = pages.find((p) => p.id === id);
    if (!page || page.depth <= 0) return;

    onUpdatePage(id, { depth: page.depth - 1 });
  };

  const canIndent = (page: WizardPage, index: number): boolean => {
    if (index === 0) return false;
    if (page.depth >= MAX_DEPTH) return false;

    const prevPage = pages[index - 1];
    return prevPage.depth >= page.depth;
  };

  const canOutdent = (page: WizardPage): boolean => {
    return page.depth > 0;
  };

  const handleSelectAllRow = (pageId: string, taskIds: string[]) => {
    onSetPageVariableTasks(pageId, taskIds);
  };

  const handleClearAllRow = (pageId: string) => {
    onSetPageVariableTasks(pageId, []);
  };

  // Count pages by depth level
  const depthCounts = React.useMemo(() => {
    const counts: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
    pages.forEach((p) => {
      counts[p.depth] = (counts[p.depth] || 0) + 1;
    });
    return counts;
  }, [pages]);

  if (isLoadingRecipe) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <StepHeader
        title="Define Sitemap & Variable Tasks"
        description="Add pages and configure which variable tasks apply to each page."
      />

      {/* Page Management Section */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Pages
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Quick Add */}
          <div>
            <p className="text-sm text-text-sub mb-2">Quick add common pages:</p>
            <div className="flex flex-wrap gap-2">
              {QUICK_ADD_PAGES.map((page) => {
                const exists = pages.some(
                  (p) => p.name.toLowerCase() === page.name.toLowerCase()
                );
                return (
                  <Button
                    key={page.name}
                    variant="secondary"
                    size="sm"
                    onClick={() => handleQuickAdd(page)}
                    disabled={exists}
                    className={cn(exists && 'opacity-50')}
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    {page.name}
                  </Button>
                );
              })}
            </div>
          </div>

          {/* Add New Page */}
          <div className="flex gap-2">
            <Input
              value={newPageName}
              onChange={(e) => setNewPageName(e.target.value)}
              placeholder="Enter page name..."
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddPage();
                }
              }}
            />
            <Button onClick={handleAddPage} disabled={!newPageName.trim()}>
              <Plus className="h-4 w-4 mr-2" />
              Add Page
            </Button>
          </div>

          {/* Page List */}
          {pages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 border border-dashed border-border rounded-lg">
              <FileText className="h-10 w-10 text-text-sub mb-3" />
              <p className="text-text-sub">No pages added yet</p>
              <p className="text-sm text-text-sub mt-1">
                Add pages to configure variable tasks
              </p>
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={pages.map((p) => p.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-2">
                  {pages.map((page, index) => (
                    <SortablePageItem
                      key={page.id}
                      page={page}
                      onUpdate={onUpdatePage}
                      onRemove={onRemovePage}
                      onIndent={handleIndent}
                      onOutdent={handleOutdent}
                      canIndent={canIndent(page, index)}
                      canOutdent={canOutdent(page)}
                      taskCount={page.selectedVariableTasks.length}
                      totalTasks={variableTasks.length}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}

          {pages.length > 0 && (
            <div className="text-sm text-text-sub">
              {pages.length} page{pages.length !== 1 ? 's' : ''} added
              {(depthCounts[1] > 0 || depthCounts[2] > 0 || depthCounts[3] > 0) && (
                <span className="ml-1">
                  ({depthCounts[0]} top-level
                  {depthCounts[1] > 0 && `, ${depthCounts[1]} child`}
                  {depthCounts[2] > 0 && `, ${depthCounts[2]} grandchild`}
                  {depthCounts[3] > 0 && `, ${depthCounts[3]} great-grandchild`})
                </span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Variable Task Matrix Section */}
      {variableTasks.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Grid3X3 className="h-4 w-4" />
              Variable Task Selection
            </CardTitle>
            <p className="text-sm text-text-sub mt-1">
              Configure which variable tasks apply to each page. Click column headers to select/deselect for all pages.
            </p>
          </CardHeader>
          <CardContent>
            <PageTaskMatrix
              pages={pages}
              variableTasks={variableTasks}
              onToggleTask={onToggleTask}
              onSelectAllColumn={onSelectAllColumn}
              onClearAllColumn={onClearAllColumn}
              onSelectAllRow={handleSelectAllRow}
              onClearAllRow={handleClearAllRow}
            />
          </CardContent>
        </Card>
      )}

      {variableTasks.length === 0 && pages.length > 0 && (
        <div className="text-sm text-text-sub text-center py-4 bg-surface-alt rounded-lg">
          This recipe has no variable tasks. All tasks will be created once regardless of pages.
        </div>
      )}
    </div>
  );
}
