'use client';

import { use } from 'react';
import Link from 'next/link';
import { Spinner } from '@/components/ui/spinner';
import { Workspace } from '@/components/domain/design/Workspace';
import { ChatPanel } from '@/components/domain/design/ChatPanel';
import { useDesignFeed, useDesignSession } from '@/lib/hooks/use-design';

export default function DesignSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const session = useDesignSession(id);
  // after = the session's last_seq: the header needs status, shas and timer, not the event history (W6.4 owns that).
  const feed = useDesignFeed(id, { after: session.data?.session.last_seq ?? 0, limit: 1, enabled: !!session.data });

  if (session.isLoading) return <Spinner />;
  if (session.error || !session.data) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-text-sub">This session could not be found.</p>
        <Link href="/design" className="text-sm text-primary underline">Back to your quests</Link>
      </div>
    );
  }
  return <Workspace
      data={session.data}
      feed={feed.data}
      slots={{
        chat: (
          <ChatPanel
            sessionId={id}
            initialStatus={session.data.session.status}
            initialCost={session.data.session.cost_usd}
            initialBudget={session.data.session.budget_usd}
            createdAt={typeof session.data.session.created_at === 'string' ? session.data.session.created_at : null}
          />
        ),
      }}
    />;
}
