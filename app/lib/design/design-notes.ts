/**
 * Designer Portal v2: design notes, the intake's write path (SPEC 8.1, 3.1; PLAN W1.4).
 *
 * Three operations behind the `design-notes` lane routes: a batch create that is idempotent on
 * (client_id, source_ref, quote_sha), a read for dedupe and backfill dry runs, and a status change.
 * `quote_sha` is always computed here (sha256 of the quote with whitespace collapsed), so two posts of the same
 * statement can never differ by a client-side hashing mistake. Design notes are internal records that trigger
 * nothing, so they write in shadow mode as well as live.
 */
import crypto from 'crypto';
import { z } from 'zod';
import type { DesignNote } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';

export const MAX_NOTES_PER_BATCH = 100;
/** 100 notes of 600-character quotes plus the other fields is well under 1 MB even in 4-byte characters. */
export const NOTES_BODY_BYTES = 1024 * 1024;

export const SOURCE_KINDS = ['meeting', 'email', 'call_notes', 'document', 'portal', 'backfill'] as const;
export const SPEAKER_ROLES = ['client', 'mike', 'indelible', 'other'] as const;
export const CATEGORIES = [
  'brand', 'colour', 'type', 'imagery', 'layout', 'nav', 'feature', 'likes_site', 'dislikes_site', 'feel',
  'accessibility', 'content_placement', 'other',
] as const;
export const POLARITIES = ['like', 'dislike', 'require', 'avoid', 'idea', 'neutral'] as const;

/** sha256 hex of the quote with every run of whitespace collapsed to one space and the ends trimmed. */
export function quoteSha(quote: string): string {
  return crypto.createHash('sha256').update(quote.replace(/\s+/g, ' ').trim(), 'utf8').digest('hex');
}

const noteSchema = z.object({
  project_id: z.string().uuid().optional(),
  site_id: z.string().uuid().optional(),
  source_kind: z.enum(SOURCE_KINDS),
  source_ref: z.string().min(1).max(300),
  source_date: z.string().datetime({ offset: true }),
  speaker_name: z.string().min(1).max(200),
  speaker_role: z.enum(SPEAKER_ROLES),
  quote: z.string().refine((q) => q.trim().length > 0, 'quote is empty').refine((q) => q.length <= 600, 'quote is over 600 characters'),
  quote_sha: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  is_paraphrase: z.boolean().optional(),
  category: z.enum(CATEGORIES),
  polarity: z.enum(POLARITIES),
  subject: z.string().min(1).max(200),
  reference_url: z.string().url().max(500).refine((u) => /^https?:\/\//i.test(u), 'reference_url must be http or https').optional(),
  confidence: z.number().min(0).max(1),
  extracted_by: z.string().min(1).max(60),
}).strict();

export const createNotesSchema = z.object({
  notes: z.array(noteSchema).min(1).max(MAX_NOTES_PER_BATCH),
}).strict();

export const patchNoteSchema = z.object({
  status: z.enum(['superseded', 'withdrawn']),
  superseded_by_id: z.string().uuid().optional(),
}).strict();

export type NewNote = z.infer<typeof noteSchema>;

export function noteView(n: DesignNote) {
  return {
    id: n.id,
    client_id: n.client_id,
    project_id: n.project_id,
    site_id: n.site_id,
    source_kind: n.source_kind,
    source_ref: n.source_ref,
    source_date: n.source_date.toISOString(),
    speaker_name: n.speaker_name,
    speaker_role: n.speaker_role,
    quote: n.quote,
    quote_sha: n.quote_sha,
    is_paraphrase: n.is_paraphrase,
    category: n.category,
    polarity: n.polarity,
    subject: n.subject,
    reference_url: n.reference_url,
    status: n.status,
    superseded_by_id: n.superseded_by_id,
    confidence: n.confidence,
    extracted_by: n.extracted_by,
    created_at: n.created_at.toISOString(),
    updated_at: n.updated_at.toISOString(),
  };
}

async function requireClient(clientId: string) {
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } });
  if (!client) throw new ApiError('Client not found', 404, 'not_found');
}

export interface CreateResult {
  created: Array<{ index: number; id: string; source_ref: string; quote_sha: string }>;
  skipped: Array<{ index: number; id: string; source_ref: string; quote_sha: string }>;
}

/**
 * One INSERT ... ON CONFLICT DO NOTHING for the whole batch (createManyAndReturn + skipDuplicates), so a batch is
 * atomic and two concurrent identical posts create one row between them. Duplicates inside one batch are skipped
 * after the first. A skipped entry carries the id of the row that already holds that statement.
 */
export async function createNotes(clientId: string, input: z.infer<typeof createNotesSchema>): Promise<CreateResult> {
  await requireClient(clientId);

  const rows = input.notes.map((n, index) => {
    const sha = quoteSha(n.quote);
    if (n.quote_sha && n.quote_sha !== sha) {
      throw new ApiError(`notes.${index}.quote_sha does not match the quote`, 400, 'quote_sha_mismatch');
    }
    return { index, sha, n };
  });

  const projectIds = [...new Set(rows.map((r) => r.n.project_id).filter((x): x is string => !!x))];
  const siteIds = [...new Set(rows.map((r) => r.n.site_id).filter((x): x is string => !!x))];
  if (projectIds.length) {
    const found = await prisma.project.count({ where: { id: { in: projectIds }, client_id: clientId } });
    if (found !== projectIds.length) throw new ApiError("project_id is not one of this client's projects", 400, 'invalid_project');
  }
  if (siteIds.length) {
    const found = await prisma.site.count({ where: { id: { in: siteIds }, client_id: clientId } });
    if (found !== siteIds.length) throw new ApiError("site_id is not one of this client's sites", 400, 'invalid_site');
  }

  const inserted = await prisma.designNote.createManyAndReturn({
    data: rows.map(({ sha, n }) => ({
      client_id: clientId,
      project_id: n.project_id ?? null,
      site_id: n.site_id ?? null,
      source_kind: n.source_kind,
      source_ref: n.source_ref,
      source_date: new Date(n.source_date),
      speaker_name: n.speaker_name,
      speaker_role: n.speaker_role,
      quote: n.quote,
      quote_sha: sha,
      is_paraphrase: n.is_paraphrase ?? false,
      category: n.category,
      polarity: n.polarity,
      subject: n.subject,
      reference_url: n.reference_url ?? null,
      confidence: n.confidence,
      extracted_by: n.extracted_by,
    })),
    skipDuplicates: true,
    select: { id: true, source_ref: true, quote_sha: true },
  });

  const key = (ref: string, sha: string) => `${sha}\u0000${ref}`;
  const createdByKey = new Map(inserted.map((r) => [key(r.source_ref, r.quote_sha), r.id]));

  // the first batch entry holding a created key is the created one; every other entry for that key (and every key
  // that was not inserted) is a skipped duplicate
  const result: CreateResult = { created: [], skipped: [] };
  const claimed = new Set<string>();
  const needExisting: typeof rows = [];
  for (const r of rows) {
    const k = key(r.n.source_ref, r.sha);
    const id = createdByKey.get(k);
    if (id && !claimed.has(k)) {
      claimed.add(k);
      result.created.push({ index: r.index, id, source_ref: r.n.source_ref, quote_sha: r.sha });
    } else {
      needExisting.push(r);
    }
  }
  if (needExisting.length) {
    const existing = await prisma.designNote.findMany({
      where: { client_id: clientId, OR: needExisting.map((r) => ({ source_ref: r.n.source_ref, quote_sha: r.sha })) },
      select: { id: true, source_ref: true, quote_sha: true },
    });
    const existingByKey = new Map(existing.map((e) => [key(e.source_ref, e.quote_sha), e.id]));
    for (const r of needExisting) {
      const id = existingByKey.get(key(r.n.source_ref, r.sha));
      if (id) result.skipped.push({ index: r.index, id, source_ref: r.n.source_ref, quote_sha: r.sha });
    }
  }
  return result;
}

export interface ListFilter {
  source_ref?: string;
  since?: Date;
}

/** Every status, oldest first: dedupe and backfill dry runs need superseded and withdrawn notes too. `since` filters on created_at. */
export async function listNotes(clientId: string, filter: ListFilter) {
  await requireClient(clientId);
  const rows = await prisma.designNote.findMany({
    where: {
      client_id: clientId,
      ...(filter.source_ref !== undefined ? { source_ref: filter.source_ref } : {}),
      ...(filter.since ? { created_at: { gte: filter.since } } : {}),
    },
    orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
  });
  return rows.map(noteView);
}

/**
 * superseded or withdrawn, never back to active. `superseded_by_id` is allowed only with `superseded`, must be a
 * different, still active note of the same client, and cannot be a note that this one already replaced.
 */
export async function setNoteStatus(id: string, input: z.infer<typeof patchNoteSchema>) {
  const note = await prisma.designNote.findUnique({ where: { id } });
  if (!note) throw new ApiError('Design note not found', 404, 'not_found');

  if (input.status === 'withdrawn' && input.superseded_by_id !== undefined) {
    throw new ApiError('superseded_by_id belongs to status superseded', 400, 'invalid_superseded_by');
  }
  let supersededBy: string | null = null;
  if (input.status === 'superseded' && input.superseded_by_id !== undefined) {
    if (input.superseded_by_id === id) throw new ApiError('A note cannot supersede itself', 400, 'invalid_superseded_by');
    const target = await prisma.designNote.findUnique({ where: { id: input.superseded_by_id }, select: { id: true, client_id: true, status: true, superseded_by_id: true } });
    if (!target || target.client_id !== note.client_id) {
      throw new ApiError("superseded_by_id must be a note of the same client", 400, 'invalid_superseded_by');
    }
    if (target.status !== 'active') throw new ApiError('superseded_by_id must be an active note', 400, 'invalid_superseded_by');
    supersededBy = target.id;
  }
  const updated = await prisma.designNote.update({ where: { id }, data: { status: input.status, superseded_by_id: supersededBy } });
  return noteView(updated);
}
