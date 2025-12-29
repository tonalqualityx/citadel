'use client';

import * as React from 'react';
import { Check, Minus } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils/cn';
import type { WizardPage } from '@/lib/hooks/use-project-wizard';
import type { RecipeTask } from '@/lib/hooks/use-recipes';

interface PageTaskMatrixProps {
  pages: WizardPage[];
  variableTasks: RecipeTask[];
  onToggleTask: (pageId: string, taskId: string) => void;
  onSelectAllColumn: (taskId: string) => void;
  onClearAllColumn: (taskId: string) => void;
  onSelectAllRow: (pageId: string, taskIds: string[]) => void;
  onClearAllRow: (pageId: string) => void;
}

export function PageTaskMatrix({
  pages,
  variableTasks,
  onToggleTask,
  onSelectAllColumn,
  onClearAllColumn,
  onSelectAllRow,
  onClearAllRow,
}: PageTaskMatrixProps) {
  if (pages.length === 0) {
    return (
      <div className="text-center text-text-sub py-8">
        Add pages above to configure which tasks apply to each page.
      </div>
    );
  }

  if (variableTasks.length === 0) {
    return (
      <div className="text-center text-text-sub py-8">
        This recipe has no variable tasks. All tasks will be created once.
      </div>
    );
  }

  // Check if all pages have a task selected
  const isColumnFullySelected = (taskId: string) =>
    pages.every((page) => page.selectedVariableTasks.includes(taskId));

  // Check if any pages have a task selected
  const isColumnPartiallySelected = (taskId: string) =>
    pages.some((page) => page.selectedVariableTasks.includes(taskId)) &&
    !isColumnFullySelected(taskId);

  // Check if a page has all tasks selected
  const isRowFullySelected = (pageId: string) => {
    const page = pages.find((p) => p.id === pageId);
    return page && variableTasks.every((t) => page.selectedVariableTasks.includes(t.id));
  };

  // Handle column header click (toggle all)
  const handleColumnHeaderClick = (taskId: string) => {
    if (isColumnFullySelected(taskId)) {
      onClearAllColumn(taskId);
    } else {
      onSelectAllColumn(taskId);
    }
  };

  // Handle row header click (toggle all)
  const handleRowHeaderClick = (pageId: string) => {
    if (isRowFullySelected(pageId)) {
      onClearAllRow(pageId);
    } else {
      onSelectAllRow(pageId, variableTasks.map((t) => t.id));
    }
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {/* Corner cell with "Select All" functionality */}
            <th className="sticky left-0 z-20 bg-surface p-2 text-left text-sm font-medium text-text-sub border-b border-r border-border min-w-[150px]">
              Page / Task
            </th>
            {/* Task column headers */}
            {variableTasks.map((task) => {
              const title = task.title || task.sop.title;
              const displayTitle = title.replace(/\{page\}/gi, '').trim() || title;
              const isFullySelected = isColumnFullySelected(task.id);
              const isPartiallySelected = isColumnPartiallySelected(task.id);

              return (
                <th
                  key={task.id}
                  className="p-2 text-center border-b border-border min-w-[120px]"
                >
                  <div className="flex flex-col items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleColumnHeaderClick(task.id)}
                      className="flex items-center justify-center gap-1 text-xs font-medium text-text-main hover:text-primary transition-colors"
                      title={`${isFullySelected ? 'Deselect' : 'Select'} for all pages`}
                    >
                      <div
                        className={cn(
                          'w-4 h-4 rounded border flex items-center justify-center',
                          isFullySelected
                            ? 'bg-primary border-primary text-white'
                            : isPartiallySelected
                            ? 'bg-primary/20 border-primary'
                            : 'border-border'
                        )}
                      >
                        {isFullySelected && <Check className="h-3 w-3" />}
                        {isPartiallySelected && <Minus className="h-3 w-3 text-primary" />}
                      </div>
                    </button>
                    <span className="text-xs text-text-main font-medium line-clamp-2 max-w-[100px]">
                      {displayTitle}
                    </span>
                    {task.sop.function && (
                      <Badge variant="default" size="sm">
                        {task.sop.function.name}
                      </Badge>
                    )}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {pages.map((page, index) => {
            const isFullySelected = isRowFullySelected(page.id);
            const hasAnySelected = page.selectedVariableTasks.length > 0;
            const isPartiallySelected = hasAnySelected && !isFullySelected;

            return (
              <tr
                key={page.id}
                className={cn(
                  'transition-colors',
                  index % 2 === 0 ? 'bg-surface' : 'bg-surface-alt'
                )}
              >
                {/* Page name cell (sticky) */}
                <td className="sticky left-0 z-10 p-2 border-r border-border bg-inherit">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleRowHeaderClick(page.id)}
                      className="flex items-center justify-center"
                      title={`${isFullySelected ? 'Deselect' : 'Select'} all tasks`}
                    >
                      <div
                        className={cn(
                          'w-4 h-4 rounded border flex items-center justify-center',
                          isFullySelected
                            ? 'bg-primary border-primary text-white'
                            : isPartiallySelected
                            ? 'bg-primary/20 border-primary'
                            : 'border-border'
                        )}
                      >
                        {isFullySelected && <Check className="h-3 w-3" />}
                        {isPartiallySelected && <Minus className="h-3 w-3 text-primary" />}
                      </div>
                    </button>
                    <span
                      className="text-sm text-text-main truncate max-w-[120px]"
                      style={{ paddingLeft: `${page.depth * 12}px` }}
                      title={page.name}
                    >
                      {page.name}
                    </span>
                  </div>
                </td>
                {/* Task checkboxes */}
                {variableTasks.map((task) => {
                  const isChecked = page.selectedVariableTasks.includes(task.id);
                  return (
                    <td key={task.id} className="p-2 text-center border-border">
                      <Checkbox
                        checked={isChecked}
                        onCheckedChange={() => onToggleTask(page.id, task.id)}
                        className="mx-auto"
                      />
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Summary row */}
      <div className="flex items-center justify-between mt-3 px-2 text-sm text-text-sub">
        <span>
          {pages.length} page{pages.length !== 1 ? 's' : ''} &times;{' '}
          {variableTasks.length} variable task{variableTasks.length !== 1 ? 's' : ''}
        </span>
        <span>
          {pages.reduce((sum, p) => sum + p.selectedVariableTasks.length, 0)} tasks will be created
        </span>
      </div>
    </div>
  );
}

// Smart defaults helper function
export function getDefaultTaskSelection(
  variableTasks: RecipeTask[],
  isFirstPage: boolean
): string[] {
  if (isFirstPage) {
    // First page gets all tasks
    return variableTasks.map((t) => t.id);
  }

  // Subsequent pages: exclude design-related tasks
  return variableTasks
    .filter((task) => {
      const title = (task.title || task.sop.title).toLowerCase();
      const functionName = task.sop.function?.name?.toLowerCase() || '';

      // Exclude if appears to be design-related
      const isDesignTask =
        title.includes('design') ||
        functionName.includes('design') ||
        functionName.includes('creative');

      return !isDesignTask;
    })
    .map((t) => t.id);
}
