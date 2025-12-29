'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';

export interface TemplateRequirement {
  id: string;
  text: string;
  sort_order: number;
}

export interface Sop {
  id: string;
  title: string;
  content?: unknown;
  function?: { id: string; name: string } | null;
  tags: string[];
  template_requirements?: TemplateRequirement[] | null;
  setup_requirements?: TemplateRequirement[] | null; // PM/Admin-only - task prep checklist
  review_requirements?: TemplateRequirement[] | null; // PM/Admin-only - task review checklist
  is_active: boolean;
  // Task template fields
  default_priority: number;
  energy_estimate: number | null;
  mystery_factor: string;
  battery_impact: string;
  estimated_minutes: number | null;
  // Stats
  task_count?: number;
  recipe_task_count?: number;
  last_reviewed_at: string | null;
  next_review_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SopDetail extends Sop {
  recent_tasks?: Array<{
    id: string;
    title: string;
    status: string;
    project: { id: string; name: string } | null;
  }>;
  recipe_tasks?: Array<{
    id: string;
    title: string;
    phase: {
      id: string;
      name: string;
      recipe: { id: string; name: string };
    };
  }>;
}

interface SopsResponse {
  sops: Sop[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}

interface SopFilters {
  page?: number;
  limit?: number;
  function_id?: string;
  tag?: string;
  search?: string;
  include_inactive?: boolean;
}

export function useSops(filters: SopFilters = {}) {
  const params = new URLSearchParams();

  if (filters.page) params.set('page', filters.page.toString());
  if (filters.limit) params.set('limit', filters.limit.toString());
  if (filters.function_id) params.set('function_id', filters.function_id);
  if (filters.tag) params.set('tag', filters.tag);
  if (filters.search) params.set('search', filters.search);
  if (filters.include_inactive) params.set('include_inactive', 'true');

  const queryString = params.toString();

  return useQuery({
    queryKey: ['sops', filters],
    queryFn: () =>
      apiClient.get<SopsResponse>(`/sops${queryString ? `?${queryString}` : ''}`),
  });
}

export function useSop(id: string | null) {
  return useQuery({
    queryKey: ['sops', id],
    queryFn: () => apiClient.get<{ sop: SopDetail }>(`/sops/${id}`),
    enabled: !!id,
  });
}

interface CreateSopInput {
  title: string;
  content?: unknown;
  function_id?: string | null;
  tags?: string[];
  template_requirements?: TemplateRequirement[] | null;
  setup_requirements?: TemplateRequirement[] | null;
  review_requirements?: TemplateRequirement[] | null;
  next_review_at?: string | null;
  // Task template fields
  default_priority?: number;
  energy_estimate?: number | null;
  mystery_factor?: string;
  battery_impact?: string;
}

export function useCreateSop() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateSopInput) =>
      apiClient.post<{ sop: Sop }>('/sops', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sops'] });
    },
  });
}

interface UpdateSopInput {
  title?: string;
  content?: unknown;
  function_id?: string | null;
  tags?: string[];
  template_requirements?: TemplateRequirement[] | null;
  setup_requirements?: TemplateRequirement[] | null;
  review_requirements?: TemplateRequirement[] | null;
  is_active?: boolean;
  next_review_at?: string | null;
  mark_reviewed?: boolean;
  // Task template fields
  default_priority?: number;
  energy_estimate?: number | null;
  mystery_factor?: string;
  battery_impact?: string;
}

export function useUpdateSop(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: UpdateSopInput) =>
      apiClient.patch<{ sop: Sop }>(`/sops/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sops'] });
      queryClient.invalidateQueries({ queryKey: ['sops', id] });
    },
  });
}

export function useDeleteSop() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/sops/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sops'] });
    },
  });
}

// Hook to get SOPs for a specific function
export function useSopsByFunction(functionId: string | null) {
  return useQuery({
    queryKey: ['sops', 'by-function', functionId],
    queryFn: () =>
      apiClient.get<SopsResponse>(`/sops?function_id=${functionId}&limit=100`),
    enabled: !!functionId,
  });
}
