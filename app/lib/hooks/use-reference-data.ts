'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { referenceDataKeys } from '@/lib/api/query-keys';
import type {
  HostingPlan,
  HostingPlanListResponse,
  CreateHostingPlanInput,
  UpdateHostingPlanInput,
  MaintenancePlan,
  MaintenancePlanListResponse,
  CreateMaintenancePlanInput,
  UpdateMaintenancePlanInput,
  TeamFunction,
  FunctionListResponse,
  CreateFunctionInput,
  UpdateFunctionInput,
  Tool,
  ToolListResponse,
  CreateToolInput,
  UpdateToolInput,
} from '@/types/entities';

// ============================================
// HOSTING PLANS
// ============================================

export function useHostingPlans(includeInactive = false) {
  return useQuery({
    queryKey: [...referenceDataKeys.hostingPlans, { includeInactive }],
    queryFn: async (): Promise<HostingPlanListResponse> => {
      const params = includeInactive ? '?include_inactive=true' : '';
      return apiClient.get<HostingPlanListResponse>(`/hosting-plans${params}`);
    },
  });
}

export function useCreateHostingPlan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateHostingPlanInput): Promise<HostingPlan> => {
      return apiClient.post<HostingPlan>('/hosting-plans', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: referenceDataKeys.hostingPlans });
    },
  });
}

export function useUpdateHostingPlan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: UpdateHostingPlanInput;
    }): Promise<HostingPlan> => {
      return apiClient.patch<HostingPlan>(`/hosting-plans/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: referenceDataKeys.hostingPlans });
    },
  });
}

export function useDeleteHostingPlan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await apiClient.delete(`/hosting-plans/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: referenceDataKeys.hostingPlans });
    },
  });
}

// ============================================
// MAINTENANCE PLANS
// ============================================

export function useMaintenancePlans(includeInactive = false) {
  return useQuery({
    queryKey: [...referenceDataKeys.maintenancePlans, { includeInactive }],
    queryFn: async (): Promise<MaintenancePlanListResponse> => {
      const params = includeInactive ? '?include_inactive=true' : '';
      return apiClient.get<MaintenancePlanListResponse>(`/maintenance-plans${params}`);
    },
  });
}

export function useCreateMaintenancePlan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateMaintenancePlanInput): Promise<MaintenancePlan> => {
      return apiClient.post<MaintenancePlan>('/maintenance-plans', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: referenceDataKeys.maintenancePlans });
    },
  });
}

export function useUpdateMaintenancePlan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: UpdateMaintenancePlanInput;
    }): Promise<MaintenancePlan> => {
      return apiClient.patch<MaintenancePlan>(`/maintenance-plans/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: referenceDataKeys.maintenancePlans });
    },
  });
}

export function useDeleteMaintenancePlan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await apiClient.delete(`/maintenance-plans/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: referenceDataKeys.maintenancePlans });
    },
  });
}

interface MaintenancePlanSop {
  id: string;
  title: string;
  sort_order: number;
}

interface MaintenancePlanSopsResponse {
  sops: MaintenancePlanSop[];
}

export function useMaintenancePlanSops(planId: string | null) {
  return useQuery({
    queryKey: [...referenceDataKeys.maintenancePlans, planId, 'sops'],
    queryFn: async (): Promise<MaintenancePlanSopsResponse> => {
      return apiClient.get<MaintenancePlanSopsResponse>(`/maintenance-plans/${planId}/sops`);
    },
    enabled: !!planId,
  });
}

export function useUpdateMaintenancePlanSops() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      planId,
      sopIds,
    }: {
      planId: string;
      sopIds: string[];
    }): Promise<MaintenancePlanSopsResponse> => {
      return apiClient.put<MaintenancePlanSopsResponse>(`/maintenance-plans/${planId}/sops`, { sopIds });
    },
    onSuccess: (_, { planId }) => {
      queryClient.invalidateQueries({ queryKey: referenceDataKeys.maintenancePlans });
      queryClient.invalidateQueries({ queryKey: [...referenceDataKeys.maintenancePlans, planId, 'sops'] });
    },
  });
}

// ============================================
// FUNCTIONS
// ============================================

export function useFunctions(includeInactive = false) {
  return useQuery({
    queryKey: [...referenceDataKeys.functions, { includeInactive }],
    queryFn: async (): Promise<FunctionListResponse> => {
      const params = includeInactive ? '?include_inactive=true' : '';
      return apiClient.get<FunctionListResponse>(`/functions${params}`);
    },
  });
}

export function useCreateFunction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateFunctionInput): Promise<TeamFunction> => {
      return apiClient.post<TeamFunction>('/functions', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: referenceDataKeys.functions });
    },
  });
}

export function useUpdateFunction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: UpdateFunctionInput;
    }): Promise<TeamFunction> => {
      return apiClient.patch<TeamFunction>(`/functions/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: referenceDataKeys.functions });
    },
  });
}

export function useDeleteFunction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await apiClient.delete(`/functions/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: referenceDataKeys.functions });
    },
  });
}

// ============================================
// TOOLS
// ============================================

export function useTools(includeInactive = false, category?: string) {
  return useQuery({
    queryKey: [...referenceDataKeys.tools, { includeInactive, category }],
    queryFn: async (): Promise<ToolListResponse> => {
      const params = new URLSearchParams();
      if (includeInactive) params.set('include_inactive', 'true');
      if (category) params.set('category', category);
      const queryString = params.toString();
      return apiClient.get<ToolListResponse>(`/tools${queryString ? `?${queryString}` : ''}`);
    },
  });
}

export function useCreateTool() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateToolInput): Promise<Tool> => {
      return apiClient.post<Tool>('/tools', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: referenceDataKeys.tools });
    },
  });
}

export function useUpdateTool() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: UpdateToolInput;
    }): Promise<Tool> => {
      return apiClient.patch<Tool>(`/tools/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: referenceDataKeys.tools });
    },
  });
}

export function useDeleteTool() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await apiClient.delete(`/tools/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: referenceDataKeys.tools });
    },
  });
}

