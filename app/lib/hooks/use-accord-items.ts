'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { accordKeys, accordCharterItemKeys, accordCommissionItemKeys, accordKeepItemKeys } from '@/lib/api/query-keys';
import { showToast } from '@/lib/hooks/use-toast';
import type { AccordCharterItem, AccordCommissionItem, AccordKeepItem } from '@/types/entities';

// ============================================
// CHARTER ITEMS
// ============================================

export function useAccordCharterItems(accordId: string | undefined) {
  return useQuery({
    queryKey: accordCharterItemKeys.byAccord(accordId!),
    queryFn: async (): Promise<AccordCharterItem[]> => {
      return apiClient.get<AccordCharterItem[]>(`/accords/${accordId}/charter-items`);
    },
    enabled: !!accordId,
  });
}

export function useAddAccordCharterItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      accordId,
      data,
    }: {
      accordId: string;
      data: {
        ware_id: string;
        base_price: number;
        billing_period: 'monthly' | 'annually';
        duration_months: number;
        name_override?: string;
        price_tier?: string;
        discount_type?: 'percent' | 'flat' | null;
        discount_value?: number | null;
        contract_language_override?: string | null;
        sort_order?: number;
      };
    }): Promise<AccordCharterItem> => {
      return apiClient.post<AccordCharterItem>(`/accords/${accordId}/charter-items`, data);
    },
    onSuccess: (_, { accordId }) => {
      queryClient.invalidateQueries({ queryKey: accordCharterItemKeys.byAccord(accordId) });
      queryClient.invalidateQueries({ queryKey: accordKeys.detail(accordId) });
      showToast.created('Charter item');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to add charter item');
    },
  });
}

export function useUpdateAccordCharterItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      accordId,
      itemId,
      data,
    }: {
      accordId: string;
      itemId: string;
      data: Partial<{
        name_override: string | null;
        price_tier: string | null;
        base_price: number;
        discount_type: 'percent' | 'flat' | null;
        discount_value: number | null;
        billing_period: 'monthly' | 'annually';
        duration_months: number;
        contract_language_override: string | null;
        sort_order: number;
      }>;
    }): Promise<AccordCharterItem> => {
      return apiClient.patch<AccordCharterItem>(`/accords/${accordId}/charter-items/${itemId}`, data);
    },
    onSuccess: (_, { accordId }) => {
      queryClient.invalidateQueries({ queryKey: accordCharterItemKeys.byAccord(accordId) });
      queryClient.invalidateQueries({ queryKey: accordKeys.detail(accordId) });
      showToast.updated('Charter item');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to update charter item');
    },
  });
}

export function useDeleteAccordCharterItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      accordId,
      itemId,
    }: {
      accordId: string;
      itemId: string;
    }): Promise<void> => {
      await apiClient.delete(`/accords/${accordId}/charter-items/${itemId}`);
    },
    onSuccess: (_, { accordId }) => {
      queryClient.invalidateQueries({ queryKey: accordCharterItemKeys.byAccord(accordId) });
      queryClient.invalidateQueries({ queryKey: accordKeys.detail(accordId) });
      showToast.deleted('Charter item');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to delete charter item');
    },
  });
}

// ============================================
// COMMISSION ITEMS
// ============================================

export function useAccordCommissionItems(accordId: string | undefined) {
  return useQuery({
    queryKey: accordCommissionItemKeys.byAccord(accordId!),
    queryFn: async (): Promise<AccordCommissionItem[]> => {
      return apiClient.get<AccordCommissionItem[]>(`/accords/${accordId}/commission-items`);
    },
    enabled: !!accordId,
  });
}

export function useAddAccordCommissionItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      accordId,
      data,
    }: {
      accordId: string;
      data: {
        ware_id: string;
        name_override?: string;
        estimated_price?: number | null;
        project_id?: string | null;
        discount_type?: 'percent' | 'flat' | null;
        discount_value?: number | null;
        contract_language_override?: string | null;
        sort_order?: number;
      };
    }): Promise<AccordCommissionItem> => {
      return apiClient.post<AccordCommissionItem>(`/accords/${accordId}/commission-items`, data);
    },
    onSuccess: (_, { accordId }) => {
      queryClient.invalidateQueries({ queryKey: accordCommissionItemKeys.byAccord(accordId) });
      queryClient.invalidateQueries({ queryKey: accordKeys.detail(accordId) });
      showToast.created('Commission item');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to add commission item');
    },
  });
}

export function useUpdateAccordCommissionItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      accordId,
      itemId,
      data,
    }: {
      accordId: string;
      itemId: string;
      data: Partial<{
        name_override: string | null;
        estimated_price: number | null;
        project_id: string | null;
        discount_type: 'percent' | 'flat' | null;
        discount_value: number | null;
        contract_language_override: string | null;
        sort_order: number;
      }>;
    }): Promise<AccordCommissionItem> => {
      return apiClient.patch<AccordCommissionItem>(`/accords/${accordId}/commission-items/${itemId}`, data);
    },
    onSuccess: (_, { accordId }) => {
      queryClient.invalidateQueries({ queryKey: accordCommissionItemKeys.byAccord(accordId) });
      queryClient.invalidateQueries({ queryKey: accordKeys.detail(accordId) });
      showToast.updated('Commission item');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to update commission item');
    },
  });
}

export function useDeleteAccordCommissionItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      accordId,
      itemId,
    }: {
      accordId: string;
      itemId: string;
    }): Promise<void> => {
      await apiClient.delete(`/accords/${accordId}/commission-items/${itemId}`);
    },
    onSuccess: (_, { accordId }) => {
      queryClient.invalidateQueries({ queryKey: accordCommissionItemKeys.byAccord(accordId) });
      queryClient.invalidateQueries({ queryKey: accordKeys.detail(accordId) });
      showToast.deleted('Commission item');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to delete commission item');
    },
  });
}

// ============================================
// KEEP ITEMS
// ============================================

export function useAccordKeepItems(accordId: string | undefined) {
  return useQuery({
    queryKey: accordKeepItemKeys.byAccord(accordId!),
    queryFn: async (): Promise<AccordKeepItem[]> => {
      return apiClient.get<AccordKeepItem[]>(`/accords/${accordId}/keep-items`);
    },
    enabled: !!accordId,
  });
}

export function useAddAccordKeepItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      accordId,
      data,
    }: {
      accordId: string;
      data: {
        maintenance_plan_id: string;
        maintenance_price: number;
        site_id?: string | null;
        site_name_placeholder?: string | null;
        domain_name?: string | null;
        hosting_plan_id?: string | null;
        hosting_price?: number | null;
        hosting_discount_type?: 'percent' | 'flat' | null;
        hosting_discount_value?: number | null;
        maintenance_discount_type?: 'percent' | 'flat' | null;
        maintenance_discount_value?: number | null;
        is_client_hosted?: boolean;
        contract_language_override?: string | null;
        sort_order?: number;
      };
    }): Promise<AccordKeepItem> => {
      return apiClient.post<AccordKeepItem>(`/accords/${accordId}/keep-items`, data);
    },
    onSuccess: (_, { accordId }) => {
      queryClient.invalidateQueries({ queryKey: accordKeepItemKeys.byAccord(accordId) });
      queryClient.invalidateQueries({ queryKey: accordKeys.detail(accordId) });
      showToast.created('Keep item');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to add keep item');
    },
  });
}

export function useUpdateAccordKeepItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      accordId,
      itemId,
      data,
    }: {
      accordId: string;
      itemId: string;
      data: Partial<{
        site_id: string | null;
        site_name_placeholder: string | null;
        domain_name: string | null;
        hosting_plan_id: string | null;
        maintenance_plan_id: string;
        hosting_price: number | null;
        hosting_discount_type: 'percent' | 'flat' | null;
        hosting_discount_value: number | null;
        maintenance_price: number;
        maintenance_discount_type: 'percent' | 'flat' | null;
        maintenance_discount_value: number | null;
        is_client_hosted: boolean;
        contract_language_override: string | null;
        sort_order: number;
      }>;
    }): Promise<AccordKeepItem> => {
      return apiClient.patch<AccordKeepItem>(`/accords/${accordId}/keep-items/${itemId}`, data);
    },
    onSuccess: (_, { accordId }) => {
      queryClient.invalidateQueries({ queryKey: accordKeepItemKeys.byAccord(accordId) });
      queryClient.invalidateQueries({ queryKey: accordKeys.detail(accordId) });
      showToast.updated('Keep item');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to update keep item');
    },
  });
}

export function useDeleteAccordKeepItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      accordId,
      itemId,
    }: {
      accordId: string;
      itemId: string;
    }): Promise<void> => {
      await apiClient.delete(`/accords/${accordId}/keep-items/${itemId}`);
    },
    onSuccess: (_, { accordId }) => {
      queryClient.invalidateQueries({ queryKey: accordKeepItemKeys.byAccord(accordId) });
      queryClient.invalidateQueries({ queryKey: accordKeys.detail(accordId) });
      showToast.deleted('Keep item');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to delete keep item');
    },
  });
}
