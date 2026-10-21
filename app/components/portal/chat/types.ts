import type { loadChatView, ViewMessage } from '@/lib/portal/chat/view';

// The payload GET /api/portal/chat/:id returns (a type-only import: nothing server-side ships).
export type ChatPayload = Awaited<ReturnType<typeof loadChatView>>;
export type ChatMessage = ViewMessage;

export interface AskPending {
  kind: 'ask';
  slot: string;
  question: string;
  choices: Array<{ id: string; label: string }>;
  allow_free_text: boolean;
  allow_upload: boolean;
  search_pages: boolean;
}

export interface SummaryPending {
  kind: 'summary';
  version: number;
  text: string | null;
  rows: Array<{ label: string; value: string }>;
  files: Array<{ id: string; name: string; type: string; url: string }>;
  destination: string | null;
  quote_line: string | null;
  urgent_line: string | null;
  choose_project: Array<{ id: string; name: string }> | null;
  buttons: { send: string; change: string };
}

export interface UrgentPending {
  prompt: string;
  choices: Array<{ id: string; label: string }>;
}

/** A file in the composer: uploading, ready (has an id) or failed. */
export interface Draft {
  key: string;
  name: string;
  size: number;
  type: string;
  /** Local preview for images the browser can show. */
  preview: string | null;
  progress: number;
  id: string | null;
  error: string | null;
}

export const MAX_FILES = 10;
// Mirrors lib/services/uploads (20 MB); the server is the real check.
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function canPreview(type: string): boolean {
  return /^image\/(jpeg|png|webp|gif)$/.test(type);
}
