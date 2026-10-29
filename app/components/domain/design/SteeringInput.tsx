'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Send, Square, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/lib/api/client';
import { showToast } from '@/lib/hooks/use-toast';
import { designKeys } from '@/lib/hooks/use-design';
import { pinBodyFromDraft, postApply, type ClientFileRef, type TrayPin } from '@/lib/hooks/use-design-tray';
import type { BridgeDraft } from '@/lib/hooks/use-design-bridge';

export function newClientRef(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const h = () => Math.floor(Math.random() * 16).toString(16);
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => (c === 'x' ? h() : ((Math.floor(Math.random() * 4) + 8).toString(16))));
}

export const isClosedStatus = (status: string) => status === 'closed' || status === 'abandoned';

export interface SteeringInputProps {
  sessionId: string;
  status: string;
  /** The one element selected on the preview (a new click replaces it). Shown as a chip; sending applies it as a pin. */
  selection?: BridgeDraft | null;
  onClearSelection?: (id: string) => void;
  /** Client files attached in the Client files tab; they travel with a message that has a selection. */
  attachedFiles?: ClientFileRef[];
  onDetachFile?: (id: string) => void;
  onSent?: () => void;
}

export const APPLY_NOTE_MAX = 4000;

export function draftChipLabel(d: BridgeDraft): string {
  const x = d.draft;
  return `${x.data_lib || x.tag} on ${x.path} at ${x.viewport.w}`;
}

// Steer or chat (POST /messages, a fresh client_ref per send) and Stop (POST /stop). The worker picks a message up
// within a poll (D6), so a sent message shows in the feed as soon as the next page lands.
export function SteeringInput({ sessionId, status, selection = null, onClearSelection, attachedFiles = [], onDetachFile, onSent }: SteeringInputProps) {
  const queryClient = useQueryClient();
  const [text, setText] = React.useState('');
  const closed = isClosedStatus(status);

  // The selection rides with the message: the pin is created and the text becomes the Apply note, so the worker gets
  // the ApplyPayload (one pin + crop). The pin carries the text too, because the worker reads each pin's note. No selection = a plain steering message.
  const send = useMutation({
    mutationFn: async (message: string) => {
      if (!selection) return apiClient.post(`/design/sessions/${sessionId}/messages`, { client_ref: newClientRef(), text: message });
      const { pin } = await apiClient.post<{ pin: TrayPin }>(`/design/sessions/${sessionId}/pins`, pinBodyFromDraft(selection.draft, message));
      onClearSelection?.(selection.id);
      return postApply(sessionId, {
        client_ref: newClientRef(),
        pin_ids: [pin.id],
        note: message,
        ...(attachedFiles.length > 0 ? { files: attachedFiles } : {}),
      });
    },
    onSuccess: () => {
      setText('');
      onSent?.();
      queryClient.invalidateQueries({ queryKey: designKeys.feedHistory(sessionId) });
      queryClient.invalidateQueries({ queryKey: designKeys.session(sessionId) });
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
    if (selection && message.length > APPLY_NOTE_MAX) {
      showToast.error(`With a selection, a message can be ${APPLY_NOTE_MAX} characters at most.`);
      return;
    }
    send.mutate(message);
  };

  return (
    <form onSubmit={submit} className="space-y-2">
      {selection && (
        <div className="flex flex-wrap items-center gap-2" data-testid="selection-chips">
          <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-border-warm bg-primary/10 py-1 pl-3 pr-1 text-xs text-text-main" data-testid="selection-chip">
            <span className="truncate">{draftChipLabel(selection)}</span>
            <button
              type="button"
              onClick={() => onClearSelection?.(selection.id)}
              aria-label={`Remove selection ${draftChipLabel(selection)}`}
              className="inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-background-light"
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          </span>
          {attachedFiles.map((f) => (
            <span key={f.id} className="inline-flex max-w-full items-center gap-1 rounded-full border border-border-warm py-1 pl-3 pr-1 text-xs text-text-main" data-testid="file-chip">
              <span className="truncate">{f.name}</span>
              <button type="button" onClick={() => onDetachFile?.(f.id)} aria-label={`Detach ${f.name}`} className="inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-background-light">
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}
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
        placeholder={closed ? 'This session is closed.' : selection ? 'What should change on the selection?' : 'Tell the worker what to change, or steer it mid-task...'}
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
