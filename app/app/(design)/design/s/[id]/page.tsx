'use client';

import { use } from 'react';
import Link from 'next/link';
import { Spinner } from '@/components/ui/spinner';
import { Workspace, type UseWorkspaceSlots } from '@/components/domain/design/Workspace';
import { ChatPanel } from '@/components/domain/design/ChatPanel';
import { PublishButton } from '@/components/domain/design/PublishButton';
import { useWorkspaceTabSlots } from '@/components/domain/design/WorkspaceTabs';
import { useDesignFeedHistory, useDesignSession, type DesignFeedResponse, type DesignSessionResponse } from '@/lib/hooks/use-design';

export default function DesignSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const session = useDesignSession(id);
  // One poll: ChatPanel reads the same query (same key); the header, publish button and tabs use its latest response.
  const history = useDesignFeedHistory(id, { enabled: !!session.data });
  const feed = history.data?.latest;
  const events = history.data?.state.events;

  if (session.isLoading) return <Spinner />;
  if (session.error || !session.data) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-text-sub">This session could not be found.</p>
        <Link href="/design" className="text-sm text-primary underline">Back to your quests</Link>
      </div>
    );
  }
  return (
    <SessionWorkspace id={id} data={session.data} feed={feed} events={events} />
  );
}

function SessionWorkspace({ id, data, feed, events }: { id: string; data: DesignSessionResponse; feed: DesignFeedResponse | undefined; events: DesignFeedResponse['events'] | undefined }) {
  // The tabs share the bridge Workspace owns, so a pin draft from the frame reaches the tray.
  const useSlots: UseWorkspaceSlots = ({ bridge }) =>
    useWorkspaceTabSlots({ sessionId: id, data, feed, events, bridge });
  return (
    <Workspace
      data={data}
      feed={feed}
      useSlots={useSlots}
      slots={{
        chat: (
          <ChatPanel
            sessionId={id}
            initialStatus={data.session.status}
            initialCost={data.session.cost_usd}
            initialBudget={data.session.budget_usd}
            createdAt={typeof data.session.created_at === 'string' ? data.session.created_at : null}
          />
        ),
        publishButton: <PublishButton sessionId={id} feed={feed} />,
      }}
    />
  );
}
