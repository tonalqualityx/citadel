'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { showToast } from '@/lib/hooks/use-toast';
import { designKeys } from '@/lib/hooks/use-design';
import type { PinDraft } from '@/lib/design/bridge';

// Designer Portal tray hooks (design 7.1: pins, apply, changes, restore, client-files/refresh).
// Every mutation refreshes the session load, which carries pins and changes.

export interface TrayPin {
  id: string;
  status: string;
  note: string;
  page_path: string;
  data_lib: string | null;
  lib_stack: string[];
  data_shape: string | null;
  selector: string;
  tag: string | null;
  classes: string[];
  text_quote: string | null;
  viewport_width: number;
  preview_sha: string | null;
  followup_task_id: string | null;
  /** Present only when the server projection carries it (lib_index blast radius). */
  blast_radius?: unknown;
  [key: string]: unknown;
}

export interface ClientFileRef {
  id: string;
  name: string;
  mime: string;
}

export interface ApplyInput {
  client_ref: string;
  pin_ids: string[];
  note?: string;
  files?: ClientFileRef[];
}

/** A non-2xx apply answer with its JSON body kept (apiClient drops everything but the message). */
export class ApplyError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string | undefined,
    public body: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApplyError';
  }
  get stalePinIds(): string[] {
    const ids = this.body.stale_pin_ids;
    return Array.isArray(ids) ? ids.filter((i): i is string => typeof i === 'string') : [];
  }
}

export function newClientRef(): string {
  return globalThis.crypto.randomUUID();
}

export function pinBodyFromDraft(draft: PinDraft, note: string) {
  return { ...draft, ...(note.trim() ? { note: note.trim() } : {}) };
}

function useRefreshSession(sessionId: string) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: designKeys.session(sessionId) });
}

export function useCreatePin(sessionId: string) {
  const refresh = useRefreshSession(sessionId);
  return useMutation({
    mutationFn: (v: { draft: PinDraft; note: string }) =>
      apiClient.post<{ pin: TrayPin }>(`/design/sessions/${sessionId}/pins`, pinBodyFromDraft(v.draft, v.note)),
    onSuccess: () => refresh(),
    onError: (error) => showToast.apiError(error, 'Could not add the pin'),
  });
}

export function usePatchPin(sessionId: string) {
  const refresh = useRefreshSession(sessionId);
  return useMutation({
    mutationFn: (v: { id: string; note?: string; status?: 'pending' | 'discarded' | 'followup'; followup_assign_to_me?: boolean }) => {
      const { id, ...body } = v;
      return apiClient.patch<{ pin: TrayPin }>(`/design/pins/${id}`, body);
    },
    onSuccess: () => refresh(),
    onError: (error) => showToast.apiError(error, 'Could not update the pin'),
  });
}

/** POST apply. Uses fetch directly so a 409 `stale_pins` / `budget_reached` body reaches the caller. */
export async function postApply(sessionId: string, input: ApplyInput & { allow_stale?: boolean }): Promise<{ seq: number }> {
  const response = await fetch(`/api/design/sessions/${sessionId}/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(input),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new ApplyError(typeof body.error === 'string' ? body.error : 'Apply failed', response.status, typeof body.code === 'string' ? body.code : undefined, body);
  }
  return body as { seq: number };
}

export function useApplyPins(sessionId: string) {
  const refresh = useRefreshSession(sessionId);
  return useMutation({
    mutationFn: (input: ApplyInput & { allow_stale?: boolean }) => postApply(sessionId, input),
    onSuccess: () => refresh(),
    // stale_pins is handled by the tray's dialog, so it never toasts here.
    onError: (error) => {
      if (error instanceof ApplyError && error.code === 'stale_pins') return;
      showToast.apiError(error, 'Could not apply');
    },
  });
}

export function useDecideChange(sessionId: string) {
  const refresh = useRefreshSession(sessionId);
  return useMutation({
    mutationFn: (v: { id: string; decision: 'accepted' | 'denied'; note?: string }) =>
      apiClient.patch(`/design/changes/${v.id}`, { decision: v.decision, ...(v.note?.trim() ? { note: v.note.trim() } : {}) }),
    onSuccess: () => refresh(),
    onError: (error) => showToast.apiError(error, 'Could not save the decision'),
  });
}

export function useRestoreVersion(sessionId: string) {
  const refresh = useRefreshSession(sessionId);
  return useMutation({
    mutationFn: (toSha: string) => apiClient.post(`/design/sessions/${sessionId}/restore`, { to_sha: toSha }),
    onSuccess: () => {
      showToast.success('Restore requested');
      refresh();
    },
    onError: (error) => showToast.apiError(error, 'Could not restore that version'),
  });
}

export function useRefreshClientFiles(sessionId: string) {
  return useMutation({
    mutationFn: () => apiClient.post(`/design/sessions/${sessionId}/client-files/refresh`, {}),
    onError: (error) => showToast.apiError(error, 'Could not refresh the client files'),
  });
}
