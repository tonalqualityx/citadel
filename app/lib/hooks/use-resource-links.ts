import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { showToast } from '@/lib/hooks/use-toast';

export interface ResourceLink {
  id: string;
  project_id: string;
  name: string;
  url: string;
  icon: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ResourceLinksResponse {
  resource_links: ResourceLink[];
  count: number;
}

export interface CreateResourceLinkInput {
  name: string;
  url: string;
  icon?: string | null;
}

export interface UpdateResourceLinkInput {
  name?: string;
  url?: string;
  icon?: string | null;
  sort_order?: number;
}

// Query keys for resource links
export const resourceLinkKeys = {
  all: ['resource-links'] as const,
  project: (projectId: string) => [...resourceLinkKeys.all, projectId] as const,
  detail: (id: string) => ['resource-link', id] as const,
};

/**
 * Fetch resource links for a project
 */
export function useResourceLinks(projectId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: resourceLinkKeys.project(projectId),
    queryFn: () => apiClient.get<ResourceLinksResponse>(`/projects/${projectId}/resource-links`),
    enabled: options?.enabled ?? !!projectId,
  });
}

/**
 * Fetch a single resource link by ID
 */
export function useResourceLink(id: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: resourceLinkKeys.detail(id),
    queryFn: () => apiClient.get<ResourceLink>(`/resource-links/${id}`),
    enabled: options?.enabled ?? !!id,
  });
}

/**
 * Create a new resource link for a project
 */
export function useCreateResourceLink(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateResourceLinkInput) =>
      apiClient.post<ResourceLink>(`/projects/${projectId}/resource-links`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: resourceLinkKeys.project(projectId) });
      showToast.success('Resource link added');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to add resource link');
    },
  });
}

/**
 * Update an existing resource link
 */
export function useUpdateResourceLink(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateResourceLinkInput }) =>
      apiClient.patch<ResourceLink>(`/resource-links/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: resourceLinkKeys.project(projectId) });
      showToast.success('Resource link updated');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to update resource link');
    },
  });
}

/**
 * Delete a resource link
 */
export function useDeleteResourceLink(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/resource-links/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: resourceLinkKeys.project(projectId) });
      showToast.success('Resource link removed');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to remove resource link');
    },
  });
}
