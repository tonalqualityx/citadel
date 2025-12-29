import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { showToast } from '@/lib/hooks/use-toast';

export interface Comment {
  id: string;
  task_id: string;
  user_id: string;
  user: {
    id: string;
    name: string;
    email: string;
    avatar_url: string | null;
  } | null;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface CommentsResponse {
  comments: Comment[];
  count: number;
}

export interface CreateCommentInput {
  content: string;
}

export interface UpdateCommentInput {
  content: string;
}

// Query keys for comments
export const commentKeys = {
  all: ['comments'] as const,
  task: (taskId: string) => [...commentKeys.all, 'task', taskId] as const,
  detail: (id: string) => [...commentKeys.all, 'detail', id] as const,
};

/**
 * Fetch comments for a task
 */
export function useComments(taskId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: commentKeys.task(taskId),
    queryFn: () => apiClient.get<CommentsResponse>(`/tasks/${taskId}/comments`),
    enabled: options?.enabled ?? !!taskId,
  });
}

/**
 * Create a new comment on a task
 */
export function useCreateComment(taskId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateCommentInput) =>
      apiClient.post<Comment>(`/tasks/${taskId}/comments`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: commentKeys.task(taskId) });
      showToast.success('Comment added');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to add comment');
    },
  });
}

/**
 * Update an existing comment
 */
export function useUpdateComment(taskId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateCommentInput }) =>
      apiClient.patch<Comment>(`/comments/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: commentKeys.task(taskId) });
      showToast.success('Comment updated');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to update comment');
    },
  });
}

/**
 * Delete a comment
 */
export function useDeleteComment(taskId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/comments/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: commentKeys.task(taskId) });
      showToast.success('Comment deleted');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to delete comment');
    },
  });
}
