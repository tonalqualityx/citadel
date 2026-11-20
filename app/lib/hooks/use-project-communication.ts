'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { projectKeys } from '@/lib/api/query-keys';
import type { CommunicationTimeline } from '@/lib/projects/communication';

/** The project's emails, logged questions and meetings, newest first (GET /api/projects/:id/communication). */
export function useProjectCommunication(projectId: string, enabled = true) {
  return useQuery({
    queryKey: projectKeys.communication(projectId),
    queryFn: () => apiClient.get<CommunicationTimeline>(`/projects/${projectId}/communication`),
    enabled: enabled && !!projectId,
  });
}
