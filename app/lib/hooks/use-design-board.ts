'use client';

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { UPLOAD_REJECT_CODES, UPLOAD_REJECT_SENTENCES, type UploadRejectCode } from '@/lib/design/upload-reject';
import { apiClient } from '@/lib/api/client';
import { showToast } from '@/lib/hooks/use-toast';
import { designKeys, pollInterval } from '@/lib/hooks/use-design';

// Designer Portal v2 board hooks (SPEC 4.3). Only /api/design/sessions/:id/* routes.

export type MarkupSentiment = 'like' | 'dislike' | 'note';
export const MARKUP_SENTIMENT_LIST: readonly MarkupSentiment[] = ['like', 'dislike', 'note'];
export const MARKUP_CATEGORY_LIST = ['type', 'colour', 'layout', 'density', 'imagery', 'nav', 'decoration', 'motion', 'feature', 'tone', 'other'] as const;
export type MarkupCategory = (typeof MARKUP_CATEGORY_LIST)[number];
export type ReferenceDecision = 'pending' | 'yes' | 'no';
export type CaptureStatus = 'none' | 'queued' | 'captured' | 'failed' | 'blocked';

export interface Rect { x: number; y: number; w: number; h: number }

export interface BoardAsset {
  id: string;
  kind: string;
  content_type: string;
  width: number | null;
  height: number | null;
  page: number | null;
  status: string;
  reject_reason: string | null;
  url: string | null;
}

export interface BoardMarkup {
  id: string;
  asset_id: string;
  rect: Rect;
  sentiment: MarkupSentiment;
  category: MarkupCategory;
  note: string | null;
  created_at?: string;
}

export interface BoardReference {
  id: string;
  source: string;
  url: string | null;
  title: string;
  why_md: string | null;
  decision: ReferenceDecision;
  decision_note: string | null;
  capture_status: CaptureStatus;
  capture_error: string | null;
  captures: { desktop_fold: BoardAsset | null; desktop_full: BoardAsset | null; phone_fold: BoardAsset | null; phone_full: BoardAsset | null };
  uploads: Array<{ asset: BoardAsset; renders: BoardAsset[] }>;
  markups: BoardMarkup[];
  sort_order: number;
}

type BoardData = { references: BoardReference[] };

export const boardKeys = {
  references: (sessionId: string) => [...designKeys.all, 'board', sessionId] as const,
};

export const BOARD_POLL_MS = 4000;

/** True while a card is waiting on the capture box or an upload is still being opened. */
export function boardIsBusy(refs: BoardReference[] | undefined): boolean {
  return (refs ?? []).some((r) => r.capture_status === 'queued' || r.uploads.some((u) => u.asset.status === 'pending'));
}

export function useBoardReferences(sessionId: string) {
  return useQuery({
    queryKey: boardKeys.references(sessionId),
    queryFn: () => apiClient.get<BoardData>(`/design/sessions/${sessionId}/references`),
    refetchInterval: (query) => (boardIsBusy((query.state.data as BoardData | undefined)?.references) ? pollInterval(BOARD_POLL_MS) : false),
  });
}

function mapRefs(qc: QueryClient, sessionId: string, fn: (refs: BoardReference[]) => BoardReference[]) {
  qc.setQueryData<BoardData>(boardKeys.references(sessionId), (old) => (old ? { references: fn(old.references) } : old));
}

export function upsertReference(qc: QueryClient, sessionId: string, ref: BoardReference) {
  mapRefs(qc, sessionId, (refs) => (refs.some((r) => r.id === ref.id) ? refs.map((r) => (r.id === ref.id ? ref : r)) : [...refs, ref]));
}

export interface ReferencePatch { refId: string; decision?: ReferenceDecision; decision_note?: string | null }

/** PATCH references/:refId, optimistic: the card changes at once and is put back when the save fails. */
export function useDecideReference(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ refId, ...patch }: ReferencePatch) => apiClient.patch<{ reference: BoardReference }>(`/design/sessions/${sessionId}/references/${refId}`, patch),
    onMutate: async ({ refId, ...patch }) => {
      await qc.cancelQueries({ queryKey: boardKeys.references(sessionId) });
      const previous = qc.getQueryData<BoardData>(boardKeys.references(sessionId));
      mapRefs(qc, sessionId, (refs) => refs.map((r) => (r.id === refId ? { ...r, ...patch } : r)));
      return { previous };
    },
    onError: (error, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(boardKeys.references(sessionId), ctx.previous);
      showToast.apiError(error, 'Could not save that choice');
    },
  });
}

/** POST references {url}: the card appears at once with its capture status. */
export function useAddSite(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (url: string) => apiClient.post<{ reference: BoardReference }>(`/design/sessions/${sessionId}/references`, { url }),
    onSuccess: ({ reference }) => upsertReference(qc, sessionId, reference),
  });
}

/** POST references {upload_asset_ids}: one card for the uploaded file. */
export function useAddUploadCard(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (assetIds: string[]) => apiClient.post<{ reference: BoardReference }>(`/design/sessions/${sessionId}/references`, { upload_asset_ids: assetIds }),
    onSuccess: ({ reference }) => upsertReference(qc, sessionId, reference),
  });
}

export interface NewMarkup { reference_id: string; asset_id: string; rect: Rect; sentiment: MarkupSentiment; category: MarkupCategory; note?: string }
export interface MarkupPatch { markupId: string; referenceId: string; rect?: Rect; sentiment?: MarkupSentiment; category?: MarkupCategory; note?: string | null; deleted?: boolean }

type MarkupReply = { markup: BoardMarkup & { reference_id: string; deleted: boolean } };

export function useCreateMarkup(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewMarkup) => apiClient.post<MarkupReply>(`/design/sessions/${sessionId}/markups`, input),
    onSuccess: ({ markup }) => {
      mapRefs(qc, sessionId, (refs) => refs.map((r) => (r.id === markup.reference_id ? { ...r, markups: [...r.markups, { id: markup.id, asset_id: markup.asset_id, rect: markup.rect, sentiment: markup.sentiment, category: markup.category, note: markup.note }] } : r)));
    },
  });
}

export function useEditMarkup(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: MarkupPatch) => {
      const { markupId, ...rest } = vars;
      const body: Omit<MarkupPatch, 'markupId' | 'referenceId'> & { referenceId?: string } = rest;
      delete body.referenceId;
      return apiClient.patch<MarkupReply>(`/design/sessions/${sessionId}/markups/${markupId}`, body);
    },
    onSuccess: ({ markup }, vars) => {
      mapRefs(qc, sessionId, (refs) => refs.map((r) => {
        if (r.id !== vars.referenceId) return r;
        if (markup.deleted) return { ...r, markups: r.markups.filter((m) => m.id !== markup.id) };
        return { ...r, markups: r.markups.map((m) => (m.id === markup.id ? { ...m, rect: markup.rect, sentiment: markup.sentiment, category: markup.category, note: markup.note } : m)) };
      }));
    },
  });
}

// ---------------------------------------------------------------------------------------------------------
// Uploads
// ---------------------------------------------------------------------------------------------------------

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_UPLOADS_PER_TRACK = 100;
export const UPLOAD_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,application/pdf,.png,.jpg,.jpeg,.webp,.gif,.pdf';

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'];
const ALLOWED_EXT = /\.(png|jpe?g|webp|gif|pdf)$/i;

/** A sentence when the file may not be sent at all (checked before any request), else null. The server stays the authority. */
export function refuseFile(file: { name: string; type: string; size: number }, usedSlots: number): string | null {
  const typeOk = file.type ? ALLOWED_TYPES.includes(file.type.toLowerCase()) : ALLOWED_EXT.test(file.name);
  if (!typeOk) return 'This kind of file is not accepted. Use PNG, JPEG, WebP, GIF or PDF.';
  if (file.size > MAX_UPLOAD_BYTES) return 'This file is over 25 MB.';
  if (file.size === 0) return 'This file is empty.';
  if (usedSlots >= MAX_UPLOADS_PER_TRACK) return 'This board already holds 100 uploads.';
  return null;
}

/** The sentence the board shows for a reject code; an unknown or missing code gets the general one. */
export function rejectSentence(code: string | null): string {
  const known = code !== null && (UPLOAD_REJECT_CODES as readonly string[]).includes(code);
  return known ? UPLOAD_REJECT_SENTENCES[code as UploadRejectCode] : UPLOAD_REJECT_SENTENCES.processing_failed;
}

/** POST uploads (multipart). Throws an Error whose message is the server's sentence. */
export async function uploadBoardFile(sessionId: string, file: File): Promise<BoardAsset> {
  const form = new FormData();
  form.append('file', file);
  form.append('purpose', 'board');
  const res = await fetch(`/api/design/sessions/${sessionId}/uploads`, { method: 'POST', body: form, credentials: 'include' });
  let data: { asset?: BoardAsset; error?: string } = {};
  try {
    data = await res.json();
  } catch {
    /* not JSON */
  }
  if (!res.ok || !data.asset) throw new Error(data.error || 'The upload did not go through');
  return data.asset;
}

/** Image bytes come only from the session-scoped track-assets route; anything else is not shown. */
export function safeAssetUrl(sessionId: string, url: string | null | undefined): string | null {
  if (!url) return null;
  const prefix = `/api/design/sessions/${sessionId}/track-assets/`;
  if (!url.startsWith(prefix)) return null;
  const tail = url.slice(prefix.length);
  return /^[A-Za-z0-9-]+$/.test(tail) ? url : null;
}
