'use client';

import * as React from 'react';
import { useCreateTask, useUpdateTask } from '@/lib/hooks/use-recipes';
import { type Sop } from '@/lib/hooks/use-sops';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { SopSelector } from './sop-selector';

interface RecipeTaskFormProps {
  recipeId: string;
  phaseId: string;
  task?: {
    id: string;
    sop_id: string;
    title: string | null;
    is_variable: boolean;
    variable_source: string | null;
    sop?: {
      id: string;
      title: string;
      energy_estimate: number | null;
      mystery_factor: string;
      battery_impact: string;
      default_priority: number;
      function: { id: string; name: string } | null;
    };
  };
  onSuccess: () => void;
  onCancel: () => void;
}

export function RecipeTaskForm({
  recipeId,
  phaseId,
  task,
  onSuccess,
  onCancel,
}: RecipeTaskFormProps) {
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();

  const [sopId, setSopId] = React.useState<string | null>(task?.sop_id || null);
  const [selectedSop, setSelectedSop] = React.useState<Sop | null>(null);
  const [title, setTitle] = React.useState(task?.title || '');
  const [isVariable, setIsVariable] = React.useState(task?.is_variable || false);
  const [variableSource] = React.useState(task?.variable_source || 'sitemap_page');

  const isEditing = !!task;
  const isPending = createTask.isPending || updateTask.isPending;

  // When SOP changes, update the title to match (if not editing)
  const handleSopChange = (newSopId: string | null, sop: Sop | null) => {
    setSopId(newSopId);
    setSelectedSop(sop);
    // Auto-populate title with SOP name for new tasks
    if (!isEditing && sop && !title) {
      setTitle(sop.title);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sopId) return;

    // Title is optional - if it matches the SOP title, send null (use SOP title)
    const titleOverride = title.trim() && title.trim() !== selectedSop?.title
      ? title.trim()
      : null;

    const data = {
      sop_id: sopId,
      title: titleOverride,
      is_variable: isVariable,
      variable_source: isVariable ? variableSource : null,
    };

    if (isEditing) {
      await updateTask.mutateAsync({
        recipeId,
        phaseId,
        taskId: task.id,
        data,
      });
    } else {
      await createTask.mutateAsync({
        recipeId,
        phaseId,
        data,
      });
    }

    onSuccess();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* SOP Selector - Primary field */}
      <SopSelector
        value={sopId}
        onChange={handleSopChange}
      />

      {/* Title Override */}
      {sopId && (
        <div>
          <label className="block text-sm font-medium text-text-main mb-1">
            Title Override
          </label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={selectedSop?.title || 'Same as SOP title'}
          />
          <p className="text-xs text-text-sub mt-1">
            Leave blank to use the SOP title. Use <code className="bg-surface-alt px-1 rounded">{'{page}'}</code> for variable tasks.
          </p>
        </div>
      )}

      {/* Variable Task Toggle */}
      {sopId && (
        <div className="flex items-center justify-between p-3 rounded-lg border border-border">
          <div>
            <div className="font-medium text-text-main">Variable Task</div>
            <div className="text-sm text-text-sub">
              Create one task per sitemap page
            </div>
          </div>
          <Switch checked={isVariable} onCheckedChange={setIsVariable} />
        </div>
      )}

      {isVariable && sopId && (
        <p className="text-xs text-text-sub bg-surface-alt p-2 rounded-lg">
          💡 The <code className="bg-surface px-1 rounded">{'{page}'}</code> placeholder in the title will be replaced with each page name from the sitemap.
        </p>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-4">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!sopId || isPending}>
          {isPending ? 'Saving...' : isEditing ? 'Update Task' : 'Add Task'}
        </Button>
      </div>
    </form>
  );
}
