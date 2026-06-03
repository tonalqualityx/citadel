'use client';

import * as React from 'react';
import { Lock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Spinner } from '@/components/ui/spinner';
import { useArticle, useUpdateArticle } from '@/lib/hooks/use-troubador';
import { ArticleStatusBadge } from './ArticleStatusBadge';
import { FeedbackThread } from './FeedbackThread';

function approvedByName(
  approvedBy: { id: string; name: string } | string | null
): string | null {
  if (!approvedBy) return null;
  if (typeof approvedBy === 'string') return approvedBy;
  return approvedBy.name;
}

export function ArticleDetail({ articleId }: { articleId: string }) {
  const { data: article, isLoading, isError } = useArticle(articleId);
  const updateArticle = useUpdateArticle();

  const [title, setTitle] = React.useState('');
  const [body, setBody] = React.useState('');
  const [socialCopy, setSocialCopy] = React.useState('');
  const [scheduledDate, setScheduledDate] = React.useState('');
  const [dirty, setDirty] = React.useState(false);

  // Sync local state when article loads/changes
  React.useEffect(() => {
    if (article) {
      setTitle(article.title ?? '');
      setBody(article.body ?? '');
      setSocialCopy(article.social_copy ?? '');
      setScheduledDate(article.scheduled_date?.split('T')[0] ?? '');
      setDirty(false);
    }
  }, [article]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="md" />
      </div>
    );
  }

  if (isError || !article) {
    return (
      <div className="text-center py-12 text-text-sub text-sm">
        Failed to load article.
      </div>
    );
  }

  const locked = article.locked;

  const handleSave = async () => {
    await updateArticle.mutateAsync({
      id: article.id,
      data: { title, body, social_copy: socialCopy },
    });
    setDirty(false);
  };

  const handleAction = (action: 'approve' | 'drop' | 'postpone' | 'reactivate') => {
    updateArticle.mutate({ id: article.id, data: { action } });
  };

  const handleSchedule = () => {
    if (!scheduledDate) return;
    updateArticle.mutate({
      id: article.id,
      data: { scheduled_date: scheduledDate, action: 'schedule' },
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-text-main">{article.title}</h3>
          <p className="text-xs text-text-sub truncate">/{article.slug}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {locked && (
            <Badge variant="default" size="sm" className="gap-1">
              <Lock className="h-3 w-3" /> Locked
            </Badge>
          )}
          <ArticleStatusBadge status={article.status} />
        </div>
      </div>

      {article.check_state && (
        <p className="text-xs text-text-sub">
          Check state: <span className="text-text-main">{article.check_state}</span>
        </p>
      )}
      {approvedByName(article.approved_by) && (
        <p className="text-xs text-text-sub">
          Approved by:{' '}
          <span className="text-text-main">{approvedByName(article.approved_by)}</span>
        </p>
      )}

      {article.research_summary && (
        <div className="rounded-lg border border-border-warm bg-background-light p-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-text-sub mb-1">
            Research summary
          </h4>
          <p className="whitespace-pre-wrap text-sm text-text-main">
            {article.research_summary}
          </p>
        </div>
      )}

      {/* Edit form */}
      <div className="space-y-3">
        <Input
          label="Title"
          value={title}
          disabled={locked}
          onChange={(e) => {
            setTitle(e.target.value);
            setDirty(true);
          }}
        />
        <Textarea
          label="Body"
          value={body}
          rows={12}
          disabled={locked}
          onChange={(e) => {
            setBody(e.target.value);
            setDirty(true);
          }}
        />
        <Textarea
          label="Social copy"
          value={socialCopy}
          rows={3}
          disabled={locked}
          onChange={(e) => {
            setSocialCopy(e.target.value);
            setDirty(true);
          }}
        />
        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={handleSave}
            disabled={locked || !dirty || updateArticle.isPending}
          >
            Save changes
          </Button>
        </div>
      </div>

      {/* Scheduling */}
      <div className="rounded-lg border border-border-warm p-3 space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-text-sub">
          Schedule
        </h4>
        {article.suggested_date && (
          <p className="text-xs text-text-sub">
            Suggested: {article.suggested_date.split('T')[0]}
          </p>
        )}
        <div className="flex items-end gap-2">
          <Input
            type="date"
            label="Publish date"
            value={scheduledDate}
            onChange={(e) => setScheduledDate(e.target.value)}
          />
          <Button
            size="sm"
            variant="secondary"
            onClick={handleSchedule}
            disabled={!scheduledDate || updateArticle.isPending}
          >
            Schedule
          </Button>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={() => handleAction('approve')}
          disabled={updateArticle.isPending || article.status === 'approved'}
        >
          Approve
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => handleAction('postpone')}
          disabled={updateArticle.isPending}
        >
          Postpone
        </Button>
        {article.status === 'dropped' || article.status === 'postponed' ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => handleAction('reactivate')}
            disabled={updateArticle.isPending}
          >
            Reactivate
          </Button>
        ) : (
          <Button
            size="sm"
            variant="destructive"
            onClick={() => handleAction('drop')}
            disabled={updateArticle.isPending}
          >
            Drop
          </Button>
        )}
      </div>

      {/* Feedback */}
      <div className="border-t border-border-warm pt-4">
        <h4 className="text-sm font-semibold text-text-main mb-2">Feedback</h4>
        <FeedbackThread articleId={article.id} comments={article.comments ?? []} />
      </div>
    </div>
  );
}
