'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { automationRuleKeys } from '@/lib/api/query-keys';
import { showToast } from '@/lib/hooks/use-toast';
import type {
  SalesAutomationRuleWithRelations,
  AutomationRuleListResponse,
  CreateAutomationRuleInput,
  UpdateAutomationRuleInput,
} from '@/types/entities';

export function useAutomationRules() {
  return useQuery({
    queryKey: automationRuleKeys.list(),
    queryFn: async (): Promise<AutomationRuleListResponse> => {
      return apiClient.get<AutomationRuleListResponse>('/sales-automation-rules');
    },
  });
}

export function useAutomationRule(id: string | undefined) {
  return useQuery({
    queryKey: automationRuleKeys.detail(id!),
    queryFn: async (): Promise<SalesAutomationRuleWithRelations> => {
      return apiClient.get<SalesAutomationRuleWithRelations>(`/sales-automation-rules/${id}`);
    },
    enabled: !!id,
  });
}

export function useCreateAutomationRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateAutomationRuleInput): Promise<SalesAutomationRuleWithRelations> => {
      return apiClient.post<SalesAutomationRuleWithRelations>('/sales-automation-rules', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: automationRuleKeys.lists() });
      showToast.created('Automation rule');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to create automation rule');
    },
  });
}

export function useUpdateAutomationRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: UpdateAutomationRuleInput;
    }): Promise<SalesAutomationRuleWithRelations> => {
      return apiClient.patch<SalesAutomationRuleWithRelations>(`/sales-automation-rules/${id}`, data);
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: automationRuleKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: automationRuleKeys.lists() });
      showToast.updated('Automation rule');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to update automation rule');
    },
  });
}

export function useDeleteAutomationRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await apiClient.delete(`/sales-automation-rules/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: automationRuleKeys.lists() });
      showToast.deleted('Automation rule');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to delete automation rule');
    },
  });
}

export function useToggleAutomationRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      is_active,
    }: {
      id: string;
      is_active: boolean;
    }): Promise<SalesAutomationRuleWithRelations> => {
      return apiClient.patch<SalesAutomationRuleWithRelations>(`/sales-automation-rules/${id}`, {
        is_active,
      });
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: automationRuleKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: automationRuleKeys.lists() });
      showToast.success('Automation rule toggled');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to toggle automation rule');
    },
  });
}
