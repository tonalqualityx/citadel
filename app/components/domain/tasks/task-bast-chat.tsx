'use client';

import * as React from 'react';
import Link from 'next/link';
import { MessageSquare } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

interface CardConversation {
  id: string;
  status: string;
  last_message_at: string | null;
}

/**
 * Operating model S4: the card carries its discussion. When Mike has talked with Bast about this task, the card page says
 * so and links back into that conversation (the home screen opens it); a card still in Triage offers to start one.
 * It asks the chat's own route, which answers only the chat owner: for anyone else (or with the chat off) it shows nothing.
 */
export function TaskBastChat({ taskId, title, status }: { taskId: string; title: string; status: string }) {
  const [conv, setConv] = React.useState<CardConversation | null | undefined>(undefined);
  React.useEffect(() => {
    let alive = true;
    fetch(`/api/bast-chat/conversations?task_id=${encodeURIComponent(taskId)}`, { credentials: 'include' })
      .then(async (r) => {
        if (!r.ok) return null;
        const d = (await r.json()) as { conversations?: CardConversation[] };
        return d.conversations?.[0] ?? undefined;
      })
      .then((c) => alive && setConv(c === null ? null : (c ?? undefined)))
      .catch(() => alive && setConv(null));
    return () => {
      alive = false;
    };
  }, [taskId]);

  // null: not available to this person. undefined: available, no conversation yet.
  if (conv === null || (conv === undefined && status !== 'triage')) return null;
  const href = `/dashboard?talk=${encodeURIComponent(taskId)}&title=${encodeURIComponent(title.slice(0, 120))}`;
  const last = conv?.last_message_at ? new Date(conv.last_message_at).toLocaleString() : null;
  return (
    <Card data-testid="task-bast-chat">
      <CardContent className="flex items-center justify-between gap-3 py-3">
        <p className="text-sm text-muted-foreground">
          <MessageSquare className="mr-2 inline h-4 w-4" aria-hidden="true" />
          {conv ? `You and Bast have talked about this${last ? `, last on ${last}` : ''}.` : 'Talk this one over with Bast.'}
        </p>
        <Link href={href} className="text-sm font-medium underline">
          {conv ? 'Reopen the conversation' : 'Talk about this'}
        </Link>
      </CardContent>
    </Card>
  );
}
