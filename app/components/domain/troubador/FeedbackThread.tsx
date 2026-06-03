'use client';

import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useAddArticleComment } from '@/lib/hooks/use-troubador';
import type { ArticleComment } from '@/lib/types/troubador';

function formatDate(value: string): string {
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function FeedbackThread({
  articleId,
  comments,
}: {
  articleId: string;
  comments: ArticleComment[];
}) {
  const [content, setContent] = React.useState('');
  const addComment = useAddArticleComment();

  // Newest first
  const sorted = React.useMemo(
    () =>
      [...(comments ?? [])].sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      ),
    [comments]
  );

  const handleSubmit = async () => {
    const trimmed = content.trim();
    if (!trimmed) return;
    await addComment.mutateAsync({ id: articleId, content: trimmed });
    setContent('');
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Textarea
          label="Add feedback"
          placeholder="Leave feedback — this flips the article to Needs Revision."
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={3}
        />
        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!content.trim() || addComment.isPending}
          >
            {addComment.isPending ? 'Sending…' : 'Send feedback'}
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        {sorted.length === 0 ? (
          <p className="text-sm text-text-sub">No feedback yet.</p>
        ) : (
          sorted.map((c) => (
            <div
              key={c.id}
              className="rounded-lg border border-border-warm bg-background-light p-3 text-sm"
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="font-medium text-text-main">
                  {c.user?.name ?? 'Unknown'}
                </span>
                <div className="flex items-center gap-2">
                  {c.is_feedback && (
                    <Badge variant="warning" size="sm">
                      Feedback
                    </Badge>
                  )}
                  <span className="text-xs text-text-sub">
                    {formatDate(c.created_at)}
                  </span>
                </div>
              </div>
              <p className="whitespace-pre-wrap text-text-main">{c.content}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
