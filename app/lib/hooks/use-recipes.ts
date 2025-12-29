import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';

// SOP data included with recipe tasks
export interface RecipeTaskSop {
  id: string;
  title: string;
  energy_estimate: number | null;
  mystery_factor: string;
  battery_impact: string;
  default_priority: number;
  function: { id: string; name: string } | null;
}

export interface RecipeTask {
  id: string;
  sop_id: string;
  title: string | null; // Override title (null means use SOP title)
  is_variable: boolean;
  variable_source: string | null;
  sort_order: number;
  depends_on_ids: string[];
  sop: RecipeTaskSop; // SOP data for display
}

export interface RecipePhase {
  id: string;
  name: string;
  icon: string | null;
  sort_order: number;
  tasks: RecipeTask[];
}

export interface Recipe {
  id: string;
  name: string;
  description: string | null;
  default_type: string;
  requires_sitemap: boolean; // Show sitemap step in wizard?
  is_active: boolean;
  phase_count?: number;
  task_count?: number;
  project_count?: number;
  phases?: RecipePhase[];
  created_at: string;
  updated_at: string;
}

interface RecipeListResponse {
  recipes: Recipe[];
}

export const recipeKeys = {
  all: ['recipes'] as const,
  lists: () => [...recipeKeys.all, 'list'] as const,
  list: (params?: { include_inactive?: boolean }) => [...recipeKeys.lists(), params] as const,
  detail: (id: string) => [...recipeKeys.all, 'detail', id] as const,
};

export function useRecipes(params?: { include_inactive?: boolean }) {
  const queryString = new URLSearchParams();
  if (params?.include_inactive) queryString.set('include_inactive', 'true');
  const url = `/recipes${queryString.toString() ? `?${queryString}` : ''}`;

  return useQuery({
    queryKey: recipeKeys.list(params),
    queryFn: () => apiClient.get<RecipeListResponse>(url),
  });
}

export function useRecipe(id: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: recipeKeys.detail(id),
    queryFn: () => apiClient.get<Recipe>(`/recipes/${id}`),
    enabled: options?.enabled ?? !!id,
  });
}

interface CreateRecipeInput {
  name: string;
  description?: string | null;
  default_type?: string;
}

export function useCreateRecipe() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateRecipeInput) =>
      apiClient.post<{ recipe: Recipe }>('/recipes', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: recipeKeys.lists() });
    },
  });
}

interface UpdateRecipeInput {
  name?: string;
  description?: string | null;
  default_type?: string;
  is_active?: boolean;
}

export function useUpdateRecipe() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateRecipeInput }) =>
      apiClient.patch<{ recipe: Recipe }>(`/recipes/${id}`, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: recipeKeys.lists() });
      queryClient.invalidateQueries({ queryKey: recipeKeys.detail(id) });
    },
  });
}

export function useDeleteRecipe() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/recipes/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: recipeKeys.lists() });
    },
  });
}

// Phase mutations
interface CreatePhaseInput {
  name: string;
  icon?: string | null;
  sort_order?: number;
}

export function useCreatePhase() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ recipeId, data }: { recipeId: string; data: CreatePhaseInput }) =>
      apiClient.post<{ phase: RecipePhase }>(`/recipes/${recipeId}/phases`, data),
    onSuccess: (_, { recipeId }) => {
      queryClient.invalidateQueries({ queryKey: recipeKeys.detail(recipeId) });
      queryClient.invalidateQueries({ queryKey: recipeKeys.lists() });
    },
  });
}

export function useUpdatePhase() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      recipeId,
      phaseId,
      data,
    }: {
      recipeId: string;
      phaseId: string;
      data: Partial<CreatePhaseInput>;
    }) =>
      apiClient.patch<{ phase: RecipePhase }>(`/recipes/${recipeId}/phases`, {
        phase_id: phaseId,
        ...data,
      }),
    onSuccess: (_, { recipeId }) => {
      queryClient.invalidateQueries({ queryKey: recipeKeys.detail(recipeId) });
    },
  });
}

export function useReorderPhases() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ recipeId, phaseIds }: { recipeId: string; phaseIds: string[] }) =>
      apiClient.patch(`/recipes/${recipeId}/phases`, { phase_ids: phaseIds }),
    onSuccess: (_, { recipeId }) => {
      queryClient.invalidateQueries({ queryKey: recipeKeys.detail(recipeId) });
    },
  });
}

export function useDeletePhase() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ recipeId, phaseId }: { recipeId: string; phaseId: string }) =>
      apiClient.delete(`/recipes/${recipeId}/phases?phase_id=${phaseId}`),
    onSuccess: (_, { recipeId }) => {
      queryClient.invalidateQueries({ queryKey: recipeKeys.detail(recipeId) });
      queryClient.invalidateQueries({ queryKey: recipeKeys.lists() });
    },
  });
}

// Task mutations - SOP is source of truth for task attributes
interface CreateTaskInput {
  sop_id: string; // Required - SOP is source of truth
  title?: string | null; // Optional override (e.g., "Design {page}")
  is_variable?: boolean;
  variable_source?: string | null; // 'sitemap_page' | null
  sort_order?: number;
  depends_on_ids?: string[];
}

export function useCreateTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      recipeId,
      phaseId,
      data,
    }: {
      recipeId: string;
      phaseId: string;
      data: CreateTaskInput;
    }) =>
      apiClient.post<{ task: RecipeTask }>(
        `/recipes/${recipeId}/phases/${phaseId}/tasks`,
        data
      ),
    onSuccess: (_, { recipeId }) => {
      queryClient.invalidateQueries({ queryKey: recipeKeys.detail(recipeId) });
      queryClient.invalidateQueries({ queryKey: recipeKeys.lists() });
    },
  });
}

export function useUpdateTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      recipeId,
      phaseId,
      taskId,
      data,
    }: {
      recipeId: string;
      phaseId: string;
      taskId: string;
      data: Partial<CreateTaskInput>;
    }) =>
      apiClient.patch<{ task: RecipeTask }>(
        `/recipes/${recipeId}/phases/${phaseId}/tasks`,
        { task_id: taskId, ...data }
      ),
    onSuccess: (_, { recipeId }) => {
      queryClient.invalidateQueries({ queryKey: recipeKeys.detail(recipeId) });
    },
  });
}

export function useReorderTasks() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      recipeId,
      phaseId,
      taskIds,
    }: {
      recipeId: string;
      phaseId: string;
      taskIds: string[];
    }) =>
      apiClient.patch(`/recipes/${recipeId}/phases/${phaseId}/tasks`, {
        task_ids: taskIds,
      }),
    onSuccess: (_, { recipeId }) => {
      queryClient.invalidateQueries({ queryKey: recipeKeys.detail(recipeId) });
    },
  });
}

export function useDeleteTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      recipeId,
      phaseId,
      taskId,
    }: {
      recipeId: string;
      phaseId: string;
      taskId: string;
    }) =>
      apiClient.delete(
        `/recipes/${recipeId}/phases/${phaseId}/tasks?task_id=${taskId}`
      ),
    onSuccess: (_, { recipeId }) => {
      queryClient.invalidateQueries({ queryKey: recipeKeys.detail(recipeId) });
      queryClient.invalidateQueries({ queryKey: recipeKeys.lists() });
    },
  });
}

// Move task between phases
export function useMoveTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      recipeId,
      taskId,
      targetPhaseId,
      sortOrder,
    }: {
      recipeId: string;
      taskId: string;
      targetPhaseId: string;
      sortOrder: number;
    }) =>
      apiClient.patch<{ task: RecipeTask }>(
        `/recipes/${recipeId}/tasks/${taskId}/move`,
        { target_phase_id: targetPhaseId, sort_order: sortOrder }
      ),
    onSuccess: (_, { recipeId }) => {
      queryClient.invalidateQueries({ queryKey: recipeKeys.detail(recipeId) });
    },
  });
}
