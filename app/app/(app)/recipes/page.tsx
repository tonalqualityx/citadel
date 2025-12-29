'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Plus, BookOpen } from 'lucide-react';
import { useRecipes } from '@/lib/hooks/use-recipes';
import { useTerminology } from '@/lib/hooks/use-terminology';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable, Column } from '@/components/ui/data-table';
import { SearchInput } from '@/components/ui/search-input';
import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonTable } from '@/components/ui/skeleton';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalBody,
} from '@/components/ui/modal';
import { RecipeForm } from '@/components/domain/recipes/recipe-form';

interface Recipe {
  id: string;
  name: string;
  description: string | null;
  default_type: string;
  is_active: boolean;
  task_count?: number;
  phase_count?: number;
}

export default function RecipesPage() {
  const router = useRouter();
  const { t } = useTerminology();
  const [search, setSearch] = React.useState('');
  const [isCreateOpen, setIsCreateOpen] = React.useState(false);

  const { data, isLoading, error } = useRecipes();

  // Client-side filtering
  const filteredRecipes = React.useMemo(() => {
    if (!data?.recipes) return [];
    if (!search) return data.recipes;
    const searchLower = search.toLowerCase();
    return data.recipes.filter(
      (recipe) =>
        recipe.name.toLowerCase().includes(searchLower) ||
        recipe.description?.toLowerCase().includes(searchLower)
    );
  }, [data?.recipes, search]);

  const columns: Column<Recipe>[] = [
    {
      key: 'name',
      header: 'Name',
      cell: (recipe) => (
        <div>
          <div className="font-medium text-text-main">{recipe.name}</div>
          {recipe.description && (
            <div className="text-sm text-text-sub line-clamp-1">{recipe.description}</div>
          )}
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Default Type',
      cell: (recipe) => (
        <span className="text-sm text-text-sub capitalize">
          {recipe.default_type?.replace('_', ' ') || '-'}
        </span>
      ),
    },
    {
      key: 'tasks',
      header: t('tasks'),
      cell: (recipe) => (
        <span className="text-sm text-text-sub">{recipe.task_count || 0}</span>
      ),
      className: 'text-center',
    },
    {
      key: 'phases',
      header: 'Phases',
      cell: (recipe) => (
        <span className="text-sm text-text-sub">{recipe.phase_count || 0}</span>
      ),
      className: 'text-center',
    },
    {
      key: 'status',
      header: 'Status',
      cell: (recipe) => (
        <Badge variant={recipe.is_active ? 'success' : 'default'}>
          {recipe.is_active ? 'Active' : 'Draft'}
        </Badge>
      ),
    },
  ];

  const handleRowClick = (recipe: Recipe) => {
    router.push(`/recipes/${recipe.id}`);
  };

  const handleCreateSuccess = (recipeId: string) => {
    setIsCreateOpen(false);
    router.push(`/recipes/${recipeId}`);
  };

  if (error) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-8">
            <EmptyState
              icon={<BookOpen className="h-12 w-12" />}
              title={`Error loading ${t('recipes').toLowerCase()}`}
              action={<Button onClick={() => window.location.reload()}>Retry</Button>}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text-main">{t('recipes')}</h1>
          <p className="text-text-sub">Project templates with predefined tasks</p>
        </div>
        <Button onClick={() => setIsCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          New {t('recipe')}
        </Button>
      </div>

      <Card>
        <CardContent className="py-4">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder={`Search ${t('recipes').toLowerCase()}...`}
            className="md:w-64"
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <SkeletonTable rows={5} columns={5} />
          ) : filteredRecipes.length === 0 ? (
            <EmptyState
              icon={<BookOpen className="h-12 w-12" />}
              title={`No ${t('recipes').toLowerCase()} found`}
            />
          ) : (
            <DataTable
              data={filteredRecipes}
              columns={columns}
              keyExtractor={(recipe) => recipe.id}
              onRowClick={handleRowClick}
            />
          )}
        </CardContent>
      </Card>

      {/* Create Modal */}
      <Modal open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <ModalContent>
          <ModalHeader>
            <ModalTitle>Create New {t('recipe')}</ModalTitle>
          </ModalHeader>
          <ModalBody>
            <RecipeForm
              onSuccess={handleCreateSuccess}
              onCancel={() => setIsCreateOpen(false)}
            />
          </ModalBody>
        </ModalContent>
      </Modal>
    </div>
  );
}
