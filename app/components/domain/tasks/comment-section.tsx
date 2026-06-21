'use client';

import * as React from 'react';
import { MessageSquare, ChevronDown, Send, Pencil, Trash2, X, Check, Eye, EyeOff } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useAuth } from '@/lib/hooks/use-auth';
import {
  useComments,
  useCreateComment,
  useUpdateComment,
  useDeleteComment,
  Comment,
} from '@/lib/hooks/use-comments';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { MentionInput, MentionCandidate } from '@/components/ui/mention-input';
import { useMentionSuggestions } from '@/lib/hooks/use-mention-suggestions';
import { findMentionedUserIds, renderMentionSegments } from '@/lib/utils/mentions';

interface CommentSectionProps {
  taskId: string;
  defaultExpanded?: boolean;
  variant?: 'full' | 'compact';
}

export function CommentSection({ taskId, defaultExpanded = true, variant = 'full' }: CommentSectionProps) {
  const [isExpanded, setIsExpanded] = React.useState(defaultExpanded);
  const [showAllComments, setShowAllComments] = React.useState(false);
  const [newComment, setNewComment] = React.useState('');
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editContent, setEditContent] = React.useState('');

  const { user } = useAuth();
  const isPmOrAdmin = user?.role === 'pm' || user?.role === 'admin';

  const { data, isLoading } = useComments(taskId);
  const { data: suggestions } = useMentionSuggestions(taskId);
  const createComment = useCreateComment(taskId);
  const updateComment = useUpdateComment(taskId);
  const deleteComment = useDeleteComment(taskId);

  // Intelligent scoping: suggestions = all active team members PLUS only this task's client's
  // contacts. Team members drive notify-on-tag (mentioning a user notifies them); contacts are
  // taggable and rendered, but not auto-notified (no in-app channel; client email is draft-only).
  const teamCandidates = React.useMemo<MentionCandidate[]>(
    () =>
      (suggestions?.users ?? [])
        .filter((u) => u.id !== user?.id)
        .map((u) => ({ id: u.id, name: u.name, avatar_url: u.avatar_url })),
    [suggestions, user?.id]
  );
  const contactCandidates = React.useMemo<MentionCandidate[]>(
    () => (suggestions?.contacts ?? []).map((c) => ({ id: c.id, name: c.name, avatar_url: null })),
    [suggestions]
  );
  // Combined set for the autocomplete dropdown and for highlighting mentions on render.
  const allCandidates = React.useMemo<MentionCandidate[]>(
    () => [...teamCandidates, ...contactCandidates],
    [teamCandidates, contactCandidates]
  );

  const submitComment = async () => {
    const content = newComment.trim();
    if (!content) return;

    // Only team users are persisted as mentioned_user_ids / notified; contacts are not.
    const mentioned_user_ids = findMentionedUserIds(content, teamCandidates);
    await createComment.mutateAsync({ content, mentioned_user_ids });
    setNewComment('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitComment();
  };

  const handleStartEdit = (comment: Comment) => {
    setEditingId(comment.id);
    setEditContent(comment.content);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditContent('');
  };

  const handleSaveEdit = async (id: string) => {
    if (!editContent.trim()) return;
    await updateComment.mutateAsync({ id, data: { content: editContent.trim() } });
    setEditingId(null);
    setEditContent('');
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this comment?')) return;
    await deleteComment.mutateAsync(id);
  };

  // Team-only: toggle whether a comment is an internal note (hidden from clients).
  const handleToggleInternal = async (comment: Comment) => {
    await updateComment.mutateAsync({
      id: comment.id,
      data: { is_internal: !comment.is_internal },
    });
  };

  const canEditComment = (comment: Comment) => {
    return comment.user_id === user?.id || isPmOrAdmin;
  };

  // For compact mode, get the most recent comment (last in array since sorted asc)
  const comments = data?.comments || [];
  const totalCount = comments.length;
  const mostRecentComment = comments.length > 0 ? comments[comments.length - 1] : null;
  const hiddenCount = totalCount > 1 ? totalCount - 1 : 0;

  // Decide which comments to show based on mode
  const commentsToShow = variant === 'compact' && !showAllComments
    ? (mostRecentComment ? [mostRecentComment] : [])
    : comments;

  const renderComment = (comment: Comment) => (
    <div key={comment.id} className="flex gap-3">
      <Avatar
        src={comment.user?.avatar_url}
        name={comment.user?.name || 'Unknown'}
        size="sm"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-medium text-text-main">
            {comment.user?.name || 'Unknown'}
          </span>
          <span className="text-xs text-text-sub">
            {formatDistanceToNow(new Date(comment.created_at), {
              addSuffix: true,
            })}
          </span>
          {comment.updated_at !== comment.created_at && (
            <span className="text-xs text-text-sub italic">(edited)</span>
          )}
          {comment.is_internal && (
            <span
              className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 bg-amber-50 dark:bg-amber-500/10 px-1.5 py-0.5 rounded"
              title="Internal note — hidden from clients"
            >
              <EyeOff className="h-3 w-3" />
              Internal
            </span>
          )}
        </div>

        {editingId === comment.id ? (
          /* Edit Mode */
          <div className="space-y-2">
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary resize-none"
              rows={2}
              autoFocus
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => handleSaveEdit(comment.id)}
                disabled={updateComment.isPending || !editContent.trim()}
              >
                <Check className="h-3 w-3 mr-1" />
                Save
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleCancelEdit}
                disabled={updateComment.isPending}
              >
                <X className="h-3 w-3 mr-1" />
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          /* View Mode */
          <div className="group">
            <p className="text-sm text-text-main whitespace-pre-wrap break-words">
              {renderMentionSegments(comment.content, allCandidates).map((seg, i) =>
                seg.isMention ? (
                  <span key={i} className="font-medium text-primary">
                    {seg.text}
                  </span>
                ) : (
                  <React.Fragment key={i}>{seg.text}</React.Fragment>
                )
              )}
            </p>
            {canEditComment(comment) && (
              <div className="flex gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {isPmOrAdmin && (
                  <button
                    onClick={() => handleToggleInternal(comment)}
                    className="p-1 text-text-sub hover:text-primary rounded"
                    title={
                      comment.is_internal
                        ? 'Make client-visible'
                        : 'Mark internal (hide from clients)'
                    }
                    disabled={updateComment.isPending}
                  >
                    {comment.is_internal ? (
                      <Eye className="h-3 w-3" />
                    ) : (
                      <EyeOff className="h-3 w-3" />
                    )}
                  </button>
                )}
                <button
                  onClick={() => handleStartEdit(comment)}
                  className="p-1 text-text-sub hover:text-primary rounded"
                  title="Edit"
                >
                  <Pencil className="h-3 w-3" />
                </button>
                <button
                  onClick={() => handleDelete(comment.id)}
                  className="p-1 text-text-sub hover:text-red-500 rounded"
                  title="Delete"
                  disabled={deleteComment.isPending}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* Header */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-3 bg-surface-alt hover:bg-surface-2 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-text-sub" />
          <span className="text-sm font-medium text-text-main">
            Comments {totalCount > 0 && `(${totalCount})`}
          </span>
        </div>
        <ChevronDown
          className={`h-4 w-4 text-text-sub transition-transform ${
            isExpanded ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Content */}
      {isExpanded && (
        <div className="border-t border-border">
          {/* Comments List */}
          <div className="p-3 space-y-3 max-h-80 overflow-y-auto custom-scrollbar">
            {isLoading ? (
              <div className="flex justify-center py-4">
                <Spinner size="sm" />
              </div>
            ) : commentsToShow.length > 0 ? (
              <>
                {/* Show hidden count button in compact mode */}
                {variant === 'compact' && hiddenCount > 0 && !showAllComments && (
                  <button
                    onClick={() => setShowAllComments(true)}
                    className="text-xs text-primary hover:text-primary/80 mb-2"
                  >
                    Show {hiddenCount} earlier comment{hiddenCount > 1 ? 's' : ''}
                  </button>
                )}

                {/* Show all comments when expanded in compact mode */}
                {showAllComments && variant === 'compact' && (
                  <button
                    onClick={() => setShowAllComments(false)}
                    className="text-xs text-text-sub hover:text-text-main mb-2"
                  >
                    Hide earlier comments
                  </button>
                )}

                {commentsToShow.map(renderComment)}
              </>
            ) : (
              <p className="text-sm text-text-sub text-center py-4">
                No comments yet
              </p>
            )}
          </div>

          {/* Add Comment Form */}
          <form onSubmit={handleSubmit} className="p-3 border-t border-border bg-surface-alt">
            <div className="flex gap-2">
              <MentionInput
                value={newComment}
                onChange={setNewComment}
                users={allCandidates}
                onSubmit={submitComment}
                placeholder="Add a comment... (@ to mention)"
              />
              <Button
                type="submit"
                size="sm"
                disabled={!newComment.trim() || createComment.isPending}
              >
                {createComment.isPending ? (
                  <Spinner size="sm" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
