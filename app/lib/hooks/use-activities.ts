import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';

export interface Activity {
  id: string;
  user_id: string;
  user: {
    id: string;
    name: string;
    email: string;
    avatar_url: string | null;
  } | null;
  action: string;
  entity_type: string;
  entity_id: string;
  entity_name: string | null;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  created_at: string;
}

export interface ActivitiesResponse {
  activities: Activity[];
  total: number;
  limit: number;
  offset: number;
}

export interface ActivityFilters {
  entity_type?: string;
  entity_id?: string;
  user_id?: string;
  limit?: number;
  offset?: number;
}

// Query keys for activities
export const activityKeys = {
  all: ['activities'] as const,
  list: (filters: ActivityFilters) => [...activityKeys.all, filters] as const,
  entity: (entityType: string, entityId: string) =>
    [...activityKeys.all, 'entity', entityType, entityId] as const,
};

/**
 * Fetch activities with optional filters
 */
export function useActivities(filters: ActivityFilters = {}) {
  return useQuery({
    queryKey: activityKeys.list(filters),
    queryFn: () => {
      const params = new URLSearchParams();
      if (filters.entity_type) params.set('entity_type', filters.entity_type);
      if (filters.entity_id) params.set('entity_id', filters.entity_id);
      if (filters.user_id) params.set('user_id', filters.user_id);
      if (filters.limit) params.set('limit', filters.limit.toString());
      if (filters.offset) params.set('offset', filters.offset.toString());

      const url = `/activities${params.toString() ? `?${params.toString()}` : ''}`;
      return apiClient.get<ActivitiesResponse>(url);
    },
  });
}

/**
 * Fetch activities for a specific entity
 */
export function useEntityActivities(
  entityType: string,
  entityId: string,
  options?: { enabled?: boolean; limit?: number }
) {
  return useQuery({
    queryKey: activityKeys.entity(entityType, entityId),
    queryFn: () => {
      const params = new URLSearchParams();
      params.set('entity_type', entityType);
      params.set('entity_id', entityId);
      if (options?.limit) params.set('limit', options.limit.toString());

      return apiClient.get<ActivitiesResponse>(`/activities?${params.toString()}`);
    },
    enabled: options?.enabled ?? (!!entityType && !!entityId),
  });
}

/**
 * Get a human-readable description of an activity
 */
export function getActivityDescription(activity: Activity): string {
  const userName = activity.user?.name || 'Someone';
  const entityName = activity.entity_name || activity.entity_type;

  switch (activity.action) {
    case 'created':
      return `${userName} created ${entityName}`;
    case 'updated':
      return `${userName} updated ${entityName}`;
    case 'deleted':
      return `${userName} deleted ${entityName}`;
    case 'status_changed':
      const statusChange = activity.changes?.status;
      if (statusChange) {
        return `${userName} changed status from "${statusChange.from}" to "${statusChange.to}"`;
      }
      return `${userName} changed status`;
    case 'assigned':
      return `${userName} assigned ${entityName}`;
    case 'unassigned':
      return `${userName} unassigned ${entityName}`;
    case 'completed':
      return `${userName} completed ${entityName}`;
    case 'commented':
      return `${userName} commented on ${entityName}`;
    default:
      return `${userName} ${activity.action} ${entityName}`;
  }
}
