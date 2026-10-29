'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { BeforeAfter, pairAssetsByWidth } from './BeforeAfter';
import { useDecideChange } from '@/lib/hooks/use-design-tray';

export interface ChangeView {
  id: string;
  commit_sha: string;
  parent_sha?: string | null;
  summary: string;
  files: string[];
  data_libs: string[];
  pages: string[];
  before_asset_ids: string[];
  after_asset_ids: string[];
  is_restore?: boolean;
  restored_from?: string | null;
  decision: string;
  designer_note?: string | null;
  created_at: string;
}

export interface FeedEventLike {
  seq: number;
  kind: string;
  payload: unknown;
  created_at: string;
}

function ChangeCard({ sessionId, change, events }: { sessionId: string; change: ChangeView; events: FeedEventLike[] }) {
  const decide = useDecideChange(sessionId);
  const [note, setNote] = React.useState(change.designer_note ?? '');
  const pairs = React.useMemo(() => pairAssetsByWidth(change, events), [change, events]);

  return (
    <li className="rounded-lg border border-border-warm bg-surface p-3" data-testid="change-card">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-sm font-medium text-text-main">{change.summary}</p>
        <Badge variant={change.decision === 'accepted' ? 'success' : change.decision === 'denied' ? 'error' : 'default'}>
          {change.decision === 'accepted' ? 'Accepted' : change.decision === 'denied' ? 'Denied' : 'To review'}
        </Badge>
      </div>
      <p className="mt-1 text-xs text-text-sub">
        {change.pages.length > 0 ? `${change.pages.join(', ')} - ` : ''}
        {change.files.length} {change.files.length === 1 ? 'file' : 'files'}
        {change.data_libs.length > 0 ? ` - ${change.data_libs.join(', ')}` : ''}
      </p>

      <div className="mt-3">
        <BeforeAfter sessionId={sessionId} pairs={pairs} />
      </div>

      <Textarea
        aria-label="Note on this change"
        className="mt-3 min-h-[56px]"
        placeholder="Note (optional). A denial note goes to the worker."
        value={note}
        maxLength={4000}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="mt-2 flex gap-2">
        <Button type="button" size="sm" disabled={decide.isPending} onClick={() => decide.mutate({ id: change.id, decision: 'accepted', note })}>
          Accept
        </Button>
        <Button type="button" size="sm" variant="secondary" disabled={decide.isPending} onClick={() => decide.mutate({ id: change.id, decision: 'denied', note })}>
          Deny
        </Button>
      </div>
    </li>
  );
}

export interface ChangesTabProps {
  sessionId: string;
  changes: ChangeView[];
  events: FeedEventLike[];
}

export function ChangesTab({ sessionId, changes, events }: ChangesTabProps) {
  if (changes.length === 0) {
    return <p className="p-4 text-sm text-text-sub">No changes yet. They show up here after you press Apply.</p>;
  }
  const ordered = [...changes].sort((a, b) => b.created_at.localeCompare(a.created_at));
  return (
    <ul className="flex flex-col gap-3 p-1" aria-label="Changes">
      {ordered.map((c) => (
        <ChangeCard key={c.id} sessionId={sessionId} change={c} events={events} />
      ))}
    </ul>
  );
}
