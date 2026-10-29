'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Send, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/lib/api/client';
import { showToast } from '@/lib/hooks/use-toast';
import { designKeys } from '@/lib/hooks/use-design';

export function newClientRef(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const h = () => Math.floor(Math.random() * 16).toString(16);
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => (c === 'x' ? h() : ((Math.floor(Math.random() * 4) + 8).toString(16))));
}

export const isClosedStatus = (status: string) => status === 'closed' || status === 'abandoned';

export interface SteeringInputProps {
  sessionId: string;
  status: string;
}

// Steer or chat (POST /messages, a fresh client_ref per send) and Stop (POST /stop). The worker picks a message up
// within a poll (D6), so a sent message shows in the feed as soon as the next page lands.
export function SteeringInput({ sessionId, status }: SteeringInputProps) {
  const queryClient = useQueryClient();
  const [text, setText] = React.useState('');
  const closed = isClosedStatus(status);

  const send = useMutation({
    mutationFn: (message: string) => apiClient.post(`/design/sessions/${sessionId}/messages`, { client_ref: newClientRef(), text: message }),
    onSuccess: () => {
      setText('');
      queryClient.invalidateQueries({ queryKey: designKeys.feedHistory(sessionId) });
    },
    onError: (e) => showToast.apiError(e, 'Could not send your message'),
  });

  const stop = useMutation({
    mutationFn: () => apiClient.post(`/design/sessions/${sessionId}/stop`, {}),
    onSuccess: () => {
      showToast.info('Stopping. Your files stay as they are.');
      queryClient.invalidateQueries({ queryKey: designKeys.feedHistory(sessionId) });
    },
    onError: (e) => showToast.apiError(e, 'Could not stop the worker'),
  });

  const submit = (ev?: React.FormEvent) => {
    ev?.preventDefault();
    const message = text.trim();
    if (!message || closed || send.isPending) return;
    send.mutate(message);
  };

  return (
    <form onSubmit={submit} className="space-y-2">
      <label htmlFor="design-steering" className="sr-only">Message to the design worker</label>
      <textarea
        id="design-steering"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        disabled={closed}
        rows={3}
        maxLength={8000}
        placeholder={closed ? 'This session is closed.' : 'Tell the worker what to change, or steer it mid-task...'}
        className="block w-full resize-y rounded-lg border border-border-warm bg-surface px-3 py-2 text-sm text-text-main placeholder:text-text-sub focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60"
      />
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="secondary" size="sm" disabled={status !== 'active' || stop.isPending} onClick={() => stop.mutate()}>
          <Square className="mr-1 h-3 w-3" aria-hidden="true" />
          Stop
        </Button>
        <Button type="submit" size="sm" disabled={closed || send.isPending || text.trim().length === 0}>
          <Send className="mr-1 h-3 w-3" aria-hidden="true" />
          Send
        </Button>
      </div>
    </form>
  );
}
