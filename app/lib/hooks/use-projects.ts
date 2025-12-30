import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { projectKeys, ProjectFilters } from '@/lib/api/query-keys';
import { showToast } from '@/lib/hooks/use-toast';

export interface ProjectCalculated {
  estimated_hours_min: number;
  estimated_hours_max: number;
  estimated_range: string;
  time_spent_minutes: number;
  task_count: number;
  completed_task_count: number;
  total_energy_minutes: number;
  completed_energy_minutes: number;
  progress_percent: number;
}

export interface ProjectHealth {
  overallScore: number;
  status: 'healthy' | 'at-risk' | 'critical';
  alerts: string[];
  indicators: {
    tasksOnTrack: number;
    estimateAccuracy: number;
    velocityTrend: number;
    blockageLevel: number;
  };
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  status: string;
  type: string;
  client_id: string;
  client: { id: string; name: string; status: string } | null;
  site_id: string | null;
  site: { id: string; name: string; url: string } | null;
  start_date: string | null;
  target_date: string | null;
  completed_date: string | null;
  // Budget & Billing
  billing_type: string | null;
  budget_hours: number | null;
  hourly_rate: number | null;
  budget_amount: number | null;
  budget_locked: boolean;
  budget_locked_at: string | null;
  is_retainer: boolean;
  // Calculated from tasks
  calculated: ProjectCalculated;
  // Health (only for active projects)
  health: ProjectHealth | null;
  // Legacy fields
  estimated_hours: number | null;
  completed_hours: number | null;
  notes: string | null;
  created_by_id: string | null;
  created_by: { id: string; name: string } | null;
  tasks_count: number;
  completed_tasks_count: number;
  tasks?: any[];
  team_assignments?: any[];
  milestones?: any[];
  time_entries?: any[];
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProjectListResponse {
  projects: Project[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  status?: string;
  type?: string;
  billing_type?: string | null;
  client_id: string;
  site_id?: string | null;
  start_date?: string | null;
  target_date?: string | null;
  budget_amount?: number | null;
  is_retainer?: boolean;
  notes?: string | null;
}

export interface UpdateProjectInput extends Partial<CreateProjectInput> {}

export function useProjects(filters: ProjectFilters = {}) {
  return useQuery({
    queryKey: projectKeys.list(filters),
    queryFn: () =>
      apiClient.get<ProjectListResponse>('/projects', {
        params: filters as Record<string, any>,
      }),
  });
}

export function useProject(id: string) {
  return useQuery({
    queryKey: projectKeys.detail(id),
    queryFn: () => apiClient.get<Project>(`/projects/${id}`),
    enabled: !!id,
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateProjectInput) =>
      apiClient.post<Project>('/projects', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
      showToast.created('Project');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to create project');
    },
  });
}

export function useUpdateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateProjectInput }) =>
      apiClient.patch<Project>(`/projects/${id}`, data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
      queryClient.setQueryData(projectKeys.detail(data.id), data);
      showToast.updated('Project');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to update project');
    },
  });
}

export function useUpdateProjectStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiClient.patch<Project>(`/projects/${id}`, { status }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
      queryClient.setQueryData(projectKeys.detail(data.id), data);
    },
  });
}

export function useDeleteProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/projects/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
      showToast.deleted('Project');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to delete project');
    },
  });
}

export interface LockBudgetInput {
  budget_hours: number;
  hourly_rate?: number;
  budget_amount?: number;
}

export function useLockProjectBudget() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: LockBudgetInput }) =>
      apiClient.patch<Project>(`/projects/${id}`, { lock_budget: true, ...data }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
      queryClient.setQueryData(projectKeys.detail(data.id), data);
    },
  });
}

// Team assignment hooks
export interface TeamAssignment {
  id: string;
  project_id: string;
  user_id: string;
  user: { id: string; name: string; email: string } | null;
  function_id: string | null;
  function: { id: string; name: string } | null;
  is_lead: boolean;
  created_at: string;
}

export function useProjectTeam(projectId: string) {
  return useQuery({
    queryKey: projectKeys.team(projectId),
    queryFn: () =>
      apiClient.get<{ team: TeamAssignment[] }>(`/projects/${projectId}/team`),
    enabled: !!projectId,
  });
}

export function useAddTeamMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      projectId,
      data,
    }: {
      projectId: string;
      data: { user_id: string; function_id?: string | null; is_lead?: boolean };
    }) => apiClient.post<TeamAssignment>(`/projects/${projectId}/team`, data),
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: projectKeys.team(projectId) });
      queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) });
    },
  });
}

export function useRemoveTeamMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ projectId, userId }: { projectId: string; userId: string }) =>
      apiClient.delete(`/projects/${projectId}/team?user_id=${userId}`),
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: projectKeys.team(projectId) });
      queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) });
    },
  });
}

// Project Phase hooks
export interface ProjectPhase {
  id: string;
  project_id: string;
  name: string;
  icon: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  tasks?: any[];
}

interface CreatePhaseInput {
  name: string;
  icon?: string | null;
  sort_order?: number;
}

interface UpdatePhaseInput {
  name?: string;
  icon?: string | null;
  sort_order?: number;
}

export function useCreateProjectPhase() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ projectId, data }: { projectId: string; data: CreatePhaseInput }) =>
      apiClient.post<{ phase: ProjectPhase }>(`/projects/${projectId}/phases`, data),
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) });
    },
  });
}

export function useUpdateProjectPhase() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      projectId,
      phaseId,
      data,
    }: {
      projectId: string;
      phaseId: string;
      data: UpdatePhaseInput;
    }) =>
      apiClient.patch<{ phase: ProjectPhase }>(`/projects/${projectId}/phases`, {
        phase_id: phaseId,
        ...data,
      }),
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) });
    },
  });
}

export function useDeleteProjectPhase() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ projectId, phaseId }: { projectId: string; phaseId: string }) =>
      apiClient.delete(`/projects/${projectId}/phases?phase_id=${phaseId}`),
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) });
    },
  });
}

export function useReorderProjectPhases() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ projectId, phaseIds }: { projectId: string; phaseIds: string[] }) =>
      apiClient.patch(`/projects/${projectId}/phases`, { phase_ids: phaseIds }),
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) });
    },
  });
}
