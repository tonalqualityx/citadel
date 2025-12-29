'use client';

import * as React from 'react';
import { BookOpen, Layers, ListTodo, Check } from 'lucide-react';
import { useRecipes } from '@/lib/hooks/use-recipes';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils/cn';
import { StepHeader } from './wizard-layout';

interface WizardStep1RecipeProps {
  selectedRecipeId: string | null;
  onSelect: (recipeId: string, recipeName: string, requiresSitemap: boolean) => void;
}

export function WizardStep1Recipe({
  selectedRecipeId,
  onSelect,
}: WizardStep1RecipeProps) {
  const { data, isLoading, error } = useRecipes();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState
        icon={<BookOpen className="h-12 w-12" />}
        title="Error loading recipes"
        description="There was a problem loading the recipes."
      />
    );
  }

  const recipes = data?.recipes || [];

  if (recipes.length === 0) {
    return (
      <EmptyState
        icon={<BookOpen className="h-12 w-12" />}
        title="No recipes available"
        description="Create a recipe in Grimoire first to use the wizard."
      />
    );
  }

  return (
    <div>
      <StepHeader
        title="Select a Recipe"
        description="Choose a project template to start from"
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {recipes.map((recipe) => (
          <button
            key={recipe.id}
            type="button"
            onClick={() => onSelect(recipe.id, recipe.name, recipe.requires_sitemap)}
            className={cn(
              'p-4 rounded-lg border-2 text-left transition-all',
              selectedRecipeId === recipe.id
                ? 'border-primary bg-primary/5'
                : 'border-border hover:border-primary/50 hover:bg-surface-2'
            )}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <BookOpen className="h-5 w-5 text-primary" />
                <span className="font-medium text-text-main">{recipe.name}</span>
              </div>
              {selectedRecipeId === recipe.id && (
                <Check className="h-5 w-5 text-primary" />
              )}
            </div>
            {recipe.description && (
              <p className="text-sm text-text-sub mt-2 line-clamp-2">
                {recipe.description}
              </p>
            )}
            <div className="flex items-center gap-4 mt-3 text-sm text-text-sub">
              <div className="flex items-center gap-1">
                <Layers className="h-4 w-4" />
                <span>{recipe.phase_count} phases</span>
              </div>
              <div className="flex items-center gap-1">
                <ListTodo className="h-4 w-4" />
                <span>{recipe.task_count} tasks</span>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
