import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { taskKeys, TaskFilters, projectKeys } from '@/lib/api/query-keys';
import { showToast } from '@/lib/hooks/use-toast';

export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: number;
  is_focus: boolean;
  project_id: string | null;
  project: {
    id: string;
    name: string;
    status: string;
    client: { id: string; name: string } | null;
    site: { id: string; name: string } | null;
  } | null;
  // Direct client relationship (for ad-hoc tasks without a project)
  client_id: string | null;
  client: { id: string; name: string } | null;
  // Direct site relationship (for ad-hoc tasks without a project)
  site_id: string | null;
  site: { id: string; name: string } | null;
  phase: string | null;
  sort_order: number;
  assignee_id: string | null;
  assignee: { id: string; name: string; email: string; avatar_url: string | null } | null;
  function_id: string | null;
  function: { id: string; name: string } | null;
  sop_id: string | null;
  sop: {
    id: string;
    title: string;
    estimated_minutes: number | null;
    content: unknown;
  } | null;
  energy_estimate: number | null;
  mystery_factor: string;
  estimated_minutes: number | null;
  battery_impact: string;
  time_spent_minutes: number | null;
  due_date: string | null;
  started_at: string | null;
  completed_at: string | null;
  requirements: Requirement[] | null;
  review_requirements: Requirement[] | null; // PM/Admin-only Quality Gate
  // Review workflow
  needs_review: boolean;
  reviewer_id: string | null;
  reviewer: { id: string; name: string; email: string; avatar_url: string | null } | null;
  approved: boolean;
  approved_at: string | null;
  approved_by_id: string | null;
  approved_by: { id: string; name: string } | null;
  // Billing
  is_billable: boolean;
  billing_target: number | null;
  is_retainer_work: boolean;
  is_support: boolean;
  invoiced: boolean;
  invoiced_at: string | null;
  invoiced_by_id: string | null;
  notes: string | null;
  created_by_id: string | null;
  created_by: { id: string; name: string } | null;
  blocked_by?: { id: string; title: string; status: string }[];
  blocking?: { id: string; title: string; status: string }[];
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface Requirement {
  id: string;
  text: string;
  completed: boolean;
  completed_at: string | null;
  completed_by: string | null;
  sort_order: number;
}

export interface TaskListResponse {
  tasks: Task[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface CreateTaskInput {
  title: string;
  description?: string | null;
  status?: string;
  priority?: number;
  project_id?: string | null;
  client_id?: string | null; // For ad-hoc tasks without a project
  site_id?: string | null; // For ad-hoc tasks without a project
  phase_id?: string | null;
  phase?: string | null; // Legacy field
  sort_order?: number;
  assignee_id?: string | null;
  function_id?: string | null;
  sop_id?: string | null;
  energy_estimate?: number | null;
  mystery_factor?: string;
  battery_impact?: string;
  due_date?: string | null;
  notes?: string | null;
}

export interface UpdateTaskInput extends Partial<CreateTaskInput> {
  is_focus?: boolean;
  requirements?: Requirement[] | null;
  // Review workflow fields
  needs_review?: boolean;
  reviewer_id?: string | null;
  approved?: boolean;
  // Billing fields
  is_support?: boolean;
}

export function useTasks(filters: TaskFilters = {}) {
  return useQuery({
    queryKey: taskKeys.list(filters),
    queryFn: () => {
      // Convert statuses array to comma-separated string for API
      const { statuses, ...rest } = filters;
      const params: Record<string, any> = { ...rest };
      if (statuses && statuses.length > 0) {
        params.statuses = statuses.join(',');
      }
      return apiClient.get<TaskListResponse>('/tasks', { params });
    },
  });
}

export function useTask(id: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: taskKeys.detail(id),
    queryFn: () => apiClient.get<Task>(`/tasks/${id}`),
    enabled: options?.enabled ?? !!id,
  });
}

export function useCreateTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateTaskInput) => apiClient.post<Task>('/tasks', data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
      if (data.project_id) {
        queryClient.invalidateQueries({
          queryKey: projectKeys.detail(data.project_id),
        });
      }
      showToast.created('Task');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to create task');
    },
  });
}

export function useUpdateTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateTaskInput }) =>
      apiClient.patch<Task>(`/tasks/${id}`, data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.setQueryData(taskKeys.detail(data.id), data);
      if (data.project_id) {
        queryClient.invalidateQueries({
          queryKey: projectKeys.detail(data.project_id),
        });
      }
    },
  });
}

/**
 * Optimistic update hook for updating tasks within a project context.
 * Updates appear instantly in the UI before server confirmation.
 */
export function useUpdateTaskInProject(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateTaskInput }) =>
      apiClient.patch<Task>(`/tasks/${id}`, data),
    onMutate: async ({ id, data }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: projectKeys.detail(projectId) });

      // Snapshot the previous value
      const previousProject = queryClient.getQueryData(projectKeys.detail(projectId));

      // Optimistically update the task within the project
      queryClient.setQueryData(projectKeys.detail(projectId), (old: any) => {
        if (!old || !old.tasks) return old;
        return {
          ...old,
          tasks: old.tasks.map((task: any) =>
            task.id === id ? { ...task, ...data } : task
          ),
        };
      });

      return { previousProject };
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previousProject) {
        queryClient.setQueryData(projectKeys.detail(projectId), context.previousProject);
      }
    },
    onSettled: () => {
      // Always refetch after error or success to ensure cache is in sync
      queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) });
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
    },
  });
}

export function useUpdateTaskStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiClient.patch<Task>(`/tasks/${id}`, { status }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
      queryClient.setQueryData(taskKeys.detail(data.id), data);
      if (data.project_id) {
        queryClient.invalidateQueries({
          queryKey: projectKeys.detail(data.project_id),
        });
      }
    },
  });
}

export function useDeleteTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/tasks/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
      showToast.deleted('Task');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to delete task');
    },
  });
}

// Dependency management hooks
export function useAddDependency() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ taskId, blockerId }: { taskId: string; blockerId: string }) =>
      apiClient.post(`/tasks/${taskId}/dependencies`, { blocker_id: blockerId }),
    onSuccess: (_, { taskId }) => {
      queryClient.invalidateQueries({ queryKey: taskKeys.detail(taskId) });
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
    },
  });
}

export function useRemoveDependency() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ taskId, blockerId }: { taskId: string; blockerId: string }) =>
      apiClient.delete(`/tasks/${taskId}/dependencies?blocker_id=${blockerId}`),
    onSuccess: (_, { taskId }) => {
      queryClient.invalidateQueries({ queryKey: taskKeys.detail(taskId) });
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
    },
  });
}

// Helper hook for toggling is_focus
export function useToggleFocus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, is_focus }: { id: string; is_focus: boolean }) =>
      apiClient.patch<Task>(`/tasks/${id}`, { is_focus }),
    onSuccess: () => {
      // Invalidate dashboard and task lists to reflect focus changes
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
    },
  });
}

// Helper hook for toggling requirements
export function useToggleRequirement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      taskId,
      requirementId,
      completed,
      userId,
    }: {
      taskId: string;
      requirementId: string;
      completed: boolean;
      userId: string;
    }) => {
      // Get current task
      const task = queryClient.getQueryData<Task>(taskKeys.detail(taskId));
      if (!task || !task.requirements) {
        throw new Error('Task or requirements not found');
      }

      // Update the requirement
      const updatedRequirements = task.requirements.map((req) =>
        req.id === requirementId
          ? {
              ...req,
              completed,
              completed_at: completed ? new Date().toISOString() : null,
              completed_by: completed ? userId : null,
            }
          : req
      );

      return apiClient.patch<Task>(`/tasks/${taskId}`, {
        requirements: updatedRequirements,
      });
    },
    onMutate: async ({ taskId, requirementId, completed, userId }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: taskKeys.detail(taskId) });

      // Snapshot previous value
      const previousTask = queryClient.getQueryData<Task>(taskKeys.detail(taskId));

      // Optimistically update
      if (previousTask?.requirements) {
        queryClient.setQueryData<Task>(taskKeys.detail(taskId), {
          ...previousTask,
          requirements: previousTask.requirements.map((req) =>
            req.id === requirementId
              ? {
                  ...req,
                  completed,
                  completed_at: completed ? new Date().toISOString() : null,
                  completed_by: completed ? userId : null,
                }
              : req
          ),
        });
      }

      return { previousTask };
    },
    onError: (err, { taskId }, context) => {
      // Rollback on error
      if (context?.previousTask) {
        queryClient.setQueryData(taskKeys.detail(taskId), context.previousTask);
      }
    },
    onSettled: (_, __, { taskId }) => {
      queryClient.invalidateQueries({ queryKey: taskKeys.detail(taskId) });
    },
  });
}

// Reorder tasks within a phase (or unphased tasks)
export function useReorderProjectTasks(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ taskIds, phaseId }: { taskIds: string[]; phaseId: string | null }) =>
      apiClient.patch(`/projects/${projectId}/tasks/reorder`, {
        task_ids: taskIds,
        phase_id: phaseId,
      }),
    onMutate: async ({ taskIds, phaseId }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: projectKeys.detail(projectId) });

      // Snapshot the previous value
      const previousProject = queryClient.getQueryData(projectKeys.detail(projectId));

      // Optimistically update task order within the project
      queryClient.setQueryData(projectKeys.detail(projectId), (old: any) => {
        if (!old || !old.tasks) return old;
        return {
          ...old,
          tasks: old.tasks.map((task: any) => {
            // Check phase match using project_phase relationship
            const taskPhaseId = task.project_phase?.id || null;
            const newIndex = taskIds.indexOf(task.id);
            if (newIndex !== -1 && taskPhaseId === phaseId) {
              return { ...task, sort_order: newIndex };
            }
            return task;
          }),
        };
      });

      return { previousProject };
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previousProject) {
        queryClient.setQueryData(projectKeys.detail(projectId), context.previousProject);
      }
    },
    // Don't invalidate on success - optimistic update is sufficient
    // Only invalidate on error (handled above via rollback)
  });
}


// Move a task to a different phase (or to unphased)
export function useMoveTask(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      taskId,
      targetPhaseId,
      sortOrder,
    }: {
      taskId: string;
      targetPhaseId: string | null;
      sortOrder: number;
    }) =>
      apiClient.patch(`/tasks/${taskId}/move`, {
        target_phase_id: targetPhaseId,
        sort_order: sortOrder,
      }),
    onMutate: async ({ taskId, targetPhaseId, sortOrder }) => {
      await queryClient.cancelQueries({ queryKey: projectKeys.detail(projectId) });

      const previousProject = queryClient.getQueryData(projectKeys.detail(projectId));

      queryClient.setQueryData(projectKeys.detail(projectId), (old: any) => {
        if (!old || !old.tasks) return old;

        // Find the task being moved
        const movingTask = old.tasks.find((t: any) => t.id === taskId);
        if (!movingTask) return old;

        const sourcePhaseId = movingTask.project_phase?.id || null;

        // Find the target phase object (if moving to a phase)
        const targetPhase = targetPhaseId
          ? old.phases?.find((p: any) => p.id === targetPhaseId)
          : null;

        // Build updated tasks array with proper sort order adjustments
        const updatedTasks = old.tasks.map((task: any) => {
          const taskPhaseId = task.project_phase?.id || null;

          if (task.id === taskId) {
            // The task being moved - update phase and sort order
            return {
              ...task,
              project_phase: targetPhase ? { id: targetPhase.id, name: targetPhase.name, icon: targetPhase.icon } : null,
              phase_id: targetPhaseId,
              sort_order: sortOrder,
            };
          }

          // Adjust sort orders for tasks in source phase (close the gap)
          if (taskPhaseId === sourcePhaseId && task.sort_order > movingTask.sort_order) {
            return { ...task, sort_order: task.sort_order - 1 };
          }

          // Adjust sort orders for tasks in target phase (make room)
          if (taskPhaseId === targetPhaseId && task.sort_order >= sortOrder) {
            return { ...task, sort_order: task.sort_order + 1 };
          }

          return task;
        });

        return { ...old, tasks: updatedTasks };
      });

      return { previousProject };
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previousProject) {
        queryClient.setQueryData(projectKeys.detail(projectId), context.previousProject);
      }
    },
    // Don't invalidate on success - optimistic update handles it
  });
}

// Bulk operations
export interface BulkUpdateTasksInput {
  due_date?: string | null;
  assignee_id?: string | null;
}

export function useBulkUpdateTasks() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      task_ids,
      data,
    }: {
      task_ids: string[];
      data: BulkUpdateTasksInput;
    }): Promise<{ success: boolean; updated: number }> => {
      return apiClient.patch('/tasks/bulk', { task_ids, data });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
      queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
      // Invalidate all project details since tasks could be from any project
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}

export function useBulkDeleteTasks() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (task_ids: string[]): Promise<{ success: boolean; deleted: number }> => {
      return apiClient.delete('/tasks/bulk', { task_ids });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
      queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
      // Invalidate all project details since tasks could be from any project
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}
