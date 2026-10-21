'use client';

import { ChatView } from './chat-view';
import type { ChatMessage } from './types';
import type { ChatSource, StartResult } from './use-chat';

// The Conversation section of a work page when chat is available: the earlier thread (if the
// conversation is not open yet), then the same chat as the request page. Sending the first message
// opens the conversation (POST /api/portal/work/:id/messages), then the page asks for its id.
export function WorkChat({
  taskId, conversationId, onAuthLost, reloadConversationId,
}: {
  taskId: string;
  conversationId: string | null;
  onAuthLost: () => void;
  /** Re-reads the work item and returns the conversation id it now has. */
  reloadConversationId: () => Promise<string | null>;
}) {
  const source: ChatSource = {
    conversationId,
    onAuthLost,
    history: async (): Promise<ChatMessage[]> => {
      const res = await fetch(`/api/portal/work/${taskId}/messages`);
      if (!res.ok) return [];
      const body = (await res.json()) as {
        messages: Array<{ id: string; author: { kind: 'client' | 'staff'; name: string }; mine: boolean; text: string; created_at: string }>;
      };
      return body.messages.map((m) => ({
        id: m.id,
        who: m.author.kind === 'client' ? 'client' : 'team',
        mine: m.mine,
        name: m.author.name,
        text: m.text,
        created_at: m.created_at,
        sources: [],
        attachments: [],
      }));
    },
    start: async ({ text, clientRef }): Promise<StartResult> => {
      const res = await fetch(`/api/portal/work/${taskId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_ref: clientRef, text }),
      });
      if (res.status === 401) {
        onAuthLost();
        throw new Error('auth');
      }
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(res.status === 429 && b.error ? b.error : 'Your message was not sent. Please try again.');
      }
      const id = await reloadConversationId();
      if (!id) throw new Error('Your message was sent. Refresh the page to see the reply.');
      return { conversation_id: id, route: 'queued' };
    },
  };
  return (
    <section aria-labelledby="conversation-heading">
      <div className="sec-h">
        <h2 id="conversation-heading">Conversation</h2>
      </div>
      <ChatView
        source={source}
        composerLabel="Add a message"
        hint="Your message goes to the team working on this. It is saved as soon as you send it."
        emptyLine="No messages yet. Add details, links or questions here and the team will see them on this request."
        noFiles={!conversationId}
      />
    </section>
  );
}
