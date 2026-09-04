'use client';

import { useCreateComment, type CreateCommentInput } from '@/lib/hooks/use-comments';

// Oracle Projects Tab — HIGH-1 guard. The client portal (lib/services/portal.ts's
// validateTaskToken) only ever loads comments where `is_internal: false`, so any comment
// posted here without `is_internal: true` would leak straight into a client's task
// approval view the moment that task carries an active portal token. Every comment write
// from the Projects tab MUST go through this helper, which hardcodes `is_internal: true`
// so a future control point can never forget the flag — nothing in the tab should import
// useCreateComment directly.
export function usePostInternalComment(taskId: string) {
  const createComment = useCreateComment(taskId, { silent: true });

  return {
    isPending: createComment.isPending,
    postInternalComment: (input: Omit<CreateCommentInput, 'is_internal'>) =>
      createComment.mutateAsync({ ...input, is_internal: true }),
  };
}
