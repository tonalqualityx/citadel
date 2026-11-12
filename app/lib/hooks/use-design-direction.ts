'use client';

import { useQuery } from '@tanstack/react-query';
import { feedInterval } from '@/lib/hooks/use-design';

// Designer Portal v2: the art direction record of a tracked session (SPEC 4.4, 2.5, 4.11 rows 10 to 13).
// The record's zod schema lives next to Prisma on the server and cannot be imported into client code, so the form
// mirrors the shape below and the server stays the judge of what is valid.

export interface DirectionLink { label?: string; url?: string }
export interface DirectionFontPick { family?: string; source?: string; why?: string }
export interface DirectionFeature {
  id: string; name?: string; what?: string; pages?: string[]; build_as?: string; references?: string[]; a11y?: string;
}
export interface DirectionFlair {
  id: string; kind?: string; where?: string; intensity?: string; phone?: string; references?: string[]; detail?: string;
}
export interface DirectionBody {
  summary?: string;
  feel?: { words?: string[]; register?: string; detail?: string };
  type?: { display?: DirectionFontPick; body?: DirectionFontPick; detail?: string };
  colour?: { brand_tokens_kept?: string[]; accent_job?: string; grounds?: string[]; avoid?: string[] };
  imagery?: { kind?: string; treatment?: string; subjects?: string; avoid?: string };
  layout?: { density?: string; detail?: string };
  nav?: {
    desktop?: { pattern?: string; items?: DirectionLink[]; cta?: DirectionLink; utility?: string[]; sticky?: boolean };
    mobile?: { pattern?: string; trigger?: string; always_visible?: string[]; cta_in_drawer?: boolean; sticky?: boolean };
  };
  container?: {
    max_content_px?: number; method?: string; wide_px?: number; full_bleed?: string[];
    gutters_px?: { phone?: number; tablet?: number; desktop?: number }; measure_px?: number; why?: string;
  };
  features?: DirectionFeature[];
  flair?: DirectionFlair[];
  motion?: { level?: string; detail?: string };
  taken_from_references?: Array<{ reference_id: string; property: string; markup_ids?: string[] }>;
  client_requests?: Array<{ design_note_id: string; how_honoured: string }>;
  avoid?: string[];
  open_questions?: string[];
}

export interface DirectionVersion {
  id: string;
  version: number;
  status: 'draft' | 'signed' | 'superseded' | string;
  /** Opaque: moves on every save by anyone. Send it back as-is; never parse or compare it except for equality. */
  revision: string;
  body: DirectionBody;
  drafted_by: string;
  signed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MissingClientRequest {
  id: string;
  quote: string;
  speaker_name?: string | null;
  speaker_role?: string | null;
  polarity?: string | null;
  subject?: string | null;
  [key: string]: unknown;
}

export interface DirectionResponse {
  direction: DirectionVersion | null;
  signed: { id: string; version: number; signed_at: string | null } | null;
  missing_client_requests: MissingClientRequest[];
  sign_gaps: string[];
}

export const directionKey = (sessionId: string) => ['design', 'direction', sessionId] as const;

/** A refused request, carrying the server's status, code and plain message (the shared client drops the code). */
export class DirectionError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly details?: unknown) {
    super(message);
    this.name = 'DirectionError';
  }
}

async function request<T>(method: 'GET' | 'PATCH' | 'POST', sessionId: string, suffix: string, payload?: unknown): Promise<T> {
  const response = await fetch(`/api/design/sessions/${sessionId}/art-direction${suffix}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new DirectionError(
      typeof data.error === 'string' ? data.error : 'The request failed',
      response.status,
      typeof data.code === 'string' ? data.code : undefined,
      data.details,
    );
  }
  return data as T;
}

export const fetchDirection = (sessionId: string) => request<DirectionResponse>('GET', sessionId, '');

/**
 * PATCH a JSON merge patch onto the open draft. `baseVersion` is 0 when there is no draft yet. `baseRevision` is the
 * `revision` of the direction the caller holds (leave it out only when there is no draft yet): with it, a save made on
 * top of someone else's newer edit is refused with `version_moved` instead of overwriting it. Take the new revision
 * from the response before the next save.
 */
export const patchDirection = (sessionId: string, patch: Record<string, unknown>, baseVersion: number, baseRevision?: string) =>
  request<{ direction: DirectionVersion }>('PATCH', sessionId, '', { patch, base_version: baseVersion, ...(baseRevision ? { base_revision: baseRevision } : {}) });

/** Sign the draft. `baseRevision` is the revision on screen; the server signs only that revision (else `version_moved`). */
export const signDirection = (sessionId: string, baseVersion: number, mode?: 'refinements' | 'rebuild', baseRevision?: string) =>
  request<{ direction: DirectionVersion; stage: string }>('POST', sessionId, '/sign', {
    base_version: baseVersion, ...(mode ? { mode } : {}), ...(baseRevision ? { base_revision: baseRevision } : {}),
  });

export const reviseDirection = (sessionId: string) => request<{ direction: DirectionVersion }>('POST', sessionId, '/revise', {});

/** GET art-direction, polled on the feed's cadence (visible tab: next_poll_ms, hidden: 30 s). */
export function useDirection(sessionId: string, nextPollMs?: number | null) {
  return useQuery({
    queryKey: directionKey(sessionId),
    queryFn: () => fetchDirection(sessionId),
    refetchInterval: () => feedInterval(nextPollMs),
    refetchIntervalInBackground: true,
  });
}
