'use client';

import * as React from 'react';
import { MessageSquare } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { usePageBastChat, useBastChatShell } from '@/components/domain/bast-chat/BastChatProvider';
import { openTriageConversation } from '@/components/domain/home/triage-talk';

interface CardConversation {
  id: string;
  status: string;
  last_message_at: string | null;
}

/**
 * Operating model S4: the card carries its discussion. When Mike has talked with Bast about this task, the card page says
 * so and links back into that conversation (the home screen opens it); a card still in Triage offers to start one.
 * It asks the chat's own route, which answers only the chat owner: for anyone else (or with the chat off) it shows nothing.
 * The button opens the chat in place (beside the card in the split view, full screen on a phone); it no longer navigates.
 * This page also offers the Ask Bast button, and a Triage card here switches an open split chat to its own conversation.
 */
export function TaskBastChat({ taskId, title, status }: { taskId: string; title: string; status: string }) {
  const [conv, setConv] = React.useState<CardConversation | null | undefined>(undefined);
  const shell = useBastChatShell();
  const pageCard = React.useMemo(
    () => ({ key: `task:${taskId}`, title: title.slice(0, 120) || 'This card', type: 'task', task_id: taskId, tile: 'triage', ...(status === 'triage' ? { own_conversation: true } : {}) }),
    [taskId, title, status],
  );
  usePageBastChat(pageCard);
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
  const last = conv?.last_message_at ? new Date(conv.last_message_at).toLocaleString() : null;
  return (
    <Card data-testid="task-bast-chat">
      <CardContent className="flex items-center justify-between gap-3 py-3">
        <p className="text-sm text-muted-foreground">
          <MessageSquare className="mr-2 inline h-4 w-4" aria-hidden="true" />
          {conv ? `You and Dox have talked about this${last ? `, last on ${last}` : ''}.` : 'Talk this one over with Dox.'}
        </p>
        <button
          type="button"
          className="text-sm font-medium underline"
          onClick={() => openTriageConversation(pageCard, (c) => shell.talkAbout(c, { bindToPage: true }))}
        >
          {conv ? 'Reopen the conversation' : 'Talk to Dox'}
        </button>
      </CardContent>
    </Card>
  );
}
