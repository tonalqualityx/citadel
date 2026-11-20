'use client';

import * as React from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { Mail, HelpCircle, Calendar, ExternalLink, MessagesSquare } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Spinner } from '@/components/ui/spinner';
import { useProjectCommunication } from '@/lib/hooks/use-project-communication';
import type { CommunicationItem, CommunicationKind } from '@/lib/projects/communication';

interface ProjectCommunicationTabProps {
  projectId: string;
}

type Filter = 'all' | CommunicationKind;

const KIND_META: Record<CommunicationKind, { label: string; plural: string; icon: React.ReactNode; variant: 'info' | 'purple' | 'default' }> = {
  email: { label: 'Email', plural: 'Emails', icon: <Mail className="h-4 w-4" />, variant: 'info' },
  question: { label: 'Question', plural: 'Questions', icon: <HelpCircle className="h-4 w-4" />, variant: 'purple' },
  meeting: { label: 'Meeting', plural: 'Meetings', icon: <Calendar className="h-4 w-4" />, variant: 'default' },
};

const STATE_VARIANT: Record<string, 'warning' | 'success' | 'default'> = { open: 'warning', answered: 'success', defaulted: 'default' };

function ItemTitle({ item }: { item: CommunicationItem }) {
  const className = 'font-medium text-text-main hover:underline';
  if (item.external) {
    return (
      <a href={item.href} target="_blank" rel="noopener noreferrer" className={`${className} inline-flex items-center gap-1`}>
        {item.title}
        <ExternalLink className="h-3 w-3 text-text-sub" />
      </a>
    );
  }
  return (
    <Link href={item.href} className={className}>
      {item.title}
    </Link>
  );
}

export function ProjectCommunicationTab({ projectId }: ProjectCommunicationTabProps) {
  const { data, isLoading, isError } = useProjectCommunication(projectId);
  const [filter, setFilter] = React.useState<Filter>('all');

  const items = React.useMemo(
    () => (data?.items ?? []).filter((i) => filter === 'all' || i.kind === filter),
    [data, filter],
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  if (isError || !data) {
    return <EmptyState icon={<MessagesSquare className="h-10 w-10" />} title="Communication could not be loaded" description="Reload the page to try again." />;
  }

  const total = data.counts.email + data.counts.question + data.counts.meeting;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={filter === 'all' ? 'primary' : 'secondary'} onClick={() => setFilter('all')}>
          All ({total})
        </Button>
        {(Object.keys(KIND_META) as CommunicationKind[]).map((kind) => (
          <Button key={kind} size="sm" variant={filter === kind ? 'primary' : 'secondary'} onClick={() => setFilter(kind)}>
            {KIND_META[kind].plural} ({data.counts[kind]})
          </Button>
        ))}
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={<MessagesSquare className="h-10 w-10" />}
          title="No communication yet"
          description="Emails filed to this project or its cards, questions logged on its cards, and meetings linked to it show here."
        />
      ) : (
        <ul className="border border-border rounded-lg divide-y divide-border">
          {items.map((item) => (
            <li key={`${item.kind}-${item.id}`} className="flex gap-3 px-4 py-3">
              <div className="mt-0.5 text-text-sub">{KIND_META[item.kind].icon}</div>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge size="sm" variant={KIND_META[item.kind].variant}>
                    {KIND_META[item.kind].label}
                  </Badge>
                  {item.state && (
                    <Badge size="sm" variant={STATE_VARIANT[item.state] ?? 'default'}>
                      {item.state}
                    </Badge>
                  )}
                  <ItemTitle item={item} />
                </div>
                {item.detail && <p className="text-sm text-text-sub">{item.detail}</p>}
                <div className="flex flex-wrap gap-x-3 text-xs text-text-sub">
                  <span>{format(new Date(item.at), 'MMM d, yyyy h:mm a')}</span>
                  {item.from && <span>{item.from}</span>}
                  {item.card && (
                    <Link href={`/tasks/${item.card.id}`} className="hover:underline">
                      Card: {item.card.title}
                    </Link>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
