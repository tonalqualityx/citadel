'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useCreateRecipe } from '@/lib/hooks/use-recipes';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';

const typeOptions = [
  { value: 'project', label: 'Project' },
  { value: 'retainer', label: 'Retainer' },
  { value: 'internal', label: 'Internal' },
];

interface RecipeFormProps {
  onSuccess?: (recipeId: string) => void;
  onCancel?: () => void;
}

export function RecipeForm({ onSuccess, onCancel }: RecipeFormProps) {
  const router = useRouter();
  const createRecipe = useCreateRecipe();

  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [defaultType, setDefaultType] = React.useState('project');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const result = await createRecipe.mutateAsync({
      name: name.trim(),
      description: description.trim() || null,
      default_type: defaultType,
    });

    if (onSuccess) {
      onSuccess(result.recipe.id);
    } else {
      router.push(`/recipes/${result.recipe.id}`);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-text-main mb-1">
          Name *
        </label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g., Website Redesign"
          autoFocus
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-text-main mb-1">
          Description
        </label>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional description of this template..."
          rows={3}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-text-main mb-1">
          Default Project Type
        </label>
        <Select
          options={typeOptions}
          value={defaultType}
          onChange={setDefaultType}
        />
      </div>

      <div className="flex justify-end gap-2 pt-4">
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={!name.trim() || createRecipe.isPending}>
          {createRecipe.isPending ? 'Creating...' : 'Create Recipe'}
        </Button>
      </div>
    </form>
  );
}
