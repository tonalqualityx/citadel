'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { showToast } from '@/lib/hooks/use-toast';

// Oracle Projects Tab Phase 1 — the project notes log. `note` is a free-form log entry;
// `parked_until` is a snooze note that also stamps Project.stale_muted_until (see
// prisma/schema.prisma's ProjectNote/ProjectNoteKind doc comments for the full contract).

export type ProjectNoteKind = 'note' | 'parked_until';

export interface ProjectNote {
  id: string;
  project_id: string;
  user_id: string;
  user: { id: string; name: string } | null;
  kind: ProjectNoteKind;
  body: string;
  until_date: string | null;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProjectNotesResponse {
  notes: ProjectNote[];
  count: number;
}

export interface CreateProjectNoteInput {
  kind?: ProjectNoteKind;
  body: string;
  // Required when kind is 'parked_until'.
  until_date?: string | null;
}

// Query keys for project notes
export const projectNoteKeys = {
  all: ['project-notes'] as const,
  project: (projectId: string) => [...projectNoteKeys.all, projectId] as const,
};

/**
 * Fetch a project's notes log (non-deleted, newest first).
 */
export function useProjectNotes(projectId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: projectNoteKeys.project(projectId),
    queryFn: () => apiClient.get<ProjectNotesResponse>(`/projects/${projectId}/notes`),
    enabled: options?.enabled ?? !!projectId,
  });
}

/**
 * Add a note (or a parked_until snooze) to a project.
 */
export function useCreateProjectNote(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateProjectNoteInput) =>
      apiClient.post<ProjectNote>(`/projects/${projectId}/notes`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectNoteKeys.project(projectId) });
      showToast.created('Note');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to add note');
    },
  });
}

/**
 * Soft delete a project note.
 */
export function useDeleteProjectNote(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (noteId: string) => apiClient.delete(`/projects/${projectId}/notes/${noteId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectNoteKeys.project(projectId) });
      showToast.deleted('Note');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to delete note');
    },
  });
}
