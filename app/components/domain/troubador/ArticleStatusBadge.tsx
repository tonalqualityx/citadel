import { Badge } from '@/components/ui/badge';
import type { ArticleStatus } from '@/lib/types/troubador';

const STATUS_LABELS: Record<ArticleStatus, string> = {
  pending_research: 'Pending Research',
  researched: 'Researched',
  drafting: 'Drafting',
  in_review: 'In Review',
  needs_revision: 'Needs Revision',
  approved: 'Approved',
  scheduled: 'Scheduled',
  published: 'Published',
  postponed: 'Postponed',
  dropped: 'Dropped',
};

const STATUS_VARIANTS: Record<
  ArticleStatus,
  'default' | 'info' | 'warning' | 'success' | 'error' | 'purple'
> = {
  pending_research: 'default',
  researched: 'default',
  drafting: 'info',
  in_review: 'warning',
  needs_revision: 'error',
  approved: 'success',
  scheduled: 'purple',
  published: 'success',
  postponed: 'default',
  dropped: 'error',
};

export function articleStatusLabel(status: ArticleStatus): string {
  return STATUS_LABELS[status] ?? status;
}

export function ArticleStatusBadge({ status }: { status: ArticleStatus }) {
  return (
    <Badge variant={STATUS_VARIANTS[status] ?? 'default'} size="sm">
      {articleStatusLabel(status)}
    </Badge>
  );
}
