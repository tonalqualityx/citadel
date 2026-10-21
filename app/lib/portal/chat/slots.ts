/**
 * The conversation's slots and open ask (phase C spec 2.2, 4.5), plus the choice lists. Choice
 * ids come from the model or the browser; labels always come from the database, so a page or a
 * site can never be invented, and an id that is not this client's is dropped.
 */
import { prisma } from '@/lib/db/prisma';
import { INTAKE_TYPES, OPENING_CHOICES, type IntakeType } from '@/lib/portal/intake/tree';
import { CHOICE_LABELS, RESERVED_CHOICES } from '@/lib/portal/chat/copy';

export interface SummarySnap {
  request_type: IntakeType;
  site_id: string | null;
  page_id?: string | null;
  page_text?: string | null;
  section?: string | null;
  change: string;
  attachment_ids: string[];
  text: string | null;
}

export interface Slots {
  site_id?: string | null;
  page_id?: string | null;
  page_text?: string | null;
  section_key?: string | null;
  section_text?: string | null;
  change?: string | null;
  attachment_ids?: string[];
  request_type?: IntakeType | null;
  asset_none?: boolean;
  urgent_offered?: boolean;
  urgent_answered?: string | null;
  asked?: string[];
  summary?: SummarySnap | null;
  question_closed_at?: string | null;
}

export type AskSlot = 'site' | 'page' | 'section' | 'change' | 'asset' | 'other';

export interface OpenAsk {
  slot: AskSlot;
  question: string;
  choice_ids: string[];
  allow_free_text: boolean;
  allow_upload: boolean;
  comment_id?: string | null;
  fallback?: boolean;
}

export const readSlots = (v: unknown): Slots => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Slots) : {});
export const readAsk = (v: unknown): OpenAsk | null => (v && typeof v === 'object' && !Array.isArray(v) && 'slot' in (v as object) ? (v as OpenAsk) : null);

export interface Choice {
  id: string;
  label: string;
}

export const isIntakeTypeId = (id: string): id is IntakeType => (INTAKE_TYPES as readonly string[]).includes(id);

export async function clientSites(clientId: string) {
  return prisma.site.findMany({ where: { client_id: clientId, is_deleted: false }, select: { id: true, name: true, url: true }, orderBy: { name: 'asc' } });
}

export function siteLabel(s: { name: string; url: string | null }): string {
  if (s.url) {
    try {
      return new URL(s.url).hostname.replace(/^www\./, '');
    } catch {
      /* fall through */
    }
  }
  return s.name;
}

/** Pages the conversation may point at: its site, or all of the client's sites before one is chosen. */
export async function conversationPages(clientId: string, siteId: string | null | undefined) {
  return prisma.sitePage.findMany({
    where: { missing_since: null, site: { client_id: clientId, is_deleted: false, ...(siteId ? { id: siteId } : {}) } },
    orderBy: [{ depth: 'asc' }, { path: 'asc' }],
    select: { id: true, site_id: true, title: true, path: true, sections: true },
    take: 300,
  });
}

export function sectionsOf(page: { sections: unknown } | null | undefined): Array<{ key: string; heading: string }> {
  if (!page || !Array.isArray(page.sections)) return [];
  return (page.sections as Array<{ key?: unknown; heading?: unknown }>)
    .filter((s) => typeof s?.heading === 'string' && s.heading)
    .map((s) => ({ key: typeof s.key === 'string' && s.key ? s.key : String(s.heading), heading: String(s.heading) }));
}

export function pageLabel(p: { title: string; path: string }): string {
  return p.title.trim() || p.path;
}

/**
 * Resolve the ids of an ask into labelled choices, dropping every id that is not real for this
 * client and conversation. Reserved choices (not sure, another page, no file) are always allowed
 * where they make sense. Returns the dropped ids too, for the job's action_errors.
 */
export async function resolveChoices(
  conv: { client_id: string; site_id: string | null; id: string },
  slots: Slots,
  slot: AskSlot,
  ids: string[]
): Promise<{ choices: Choice[]; dropped: string[] }> {
  const choices: Choice[] = [];
  const dropped: string[] = [];
  const seen = new Set<string>();
  const add = (id: string, label: string) => {
    if (!seen.has(id)) {
      seen.add(id);
      choices.push({ id, label });
    }
  };
  if (slot === 'site') {
    const sites = await clientSites(conv.client_id);
    for (const id of ids) {
      const s = sites.find((x) => x.id === id);
      if (s) add(id, siteLabel(s));
      else dropped.push(id);
    }
  } else if (slot === 'page') {
    const pages = await conversationPages(conv.client_id, conv.site_id ?? slots.site_id);
    for (const id of ids) {
      if (id === 'not_sure') continue;
      if (id === 'another_page') continue;
      const p = pages.find((x) => x.id === id);
      if (p) add(id, pageLabel(p));
      else dropped.push(id);
    }
  } else if (slot === 'section') {
    const page = slots.page_id ? (await conversationPages(conv.client_id, conv.site_id ?? slots.site_id)).find((p) => p.id === slots.page_id) : null;
    const secs = sectionsOf(page);
    for (const id of ids) {
      if (id === 'not_sure') continue;
      const s = secs.find((x) => x.key === id);
      if (s) add(id, s.heading);
      else dropped.push(id);
    }
  } else if (slot === 'asset') {
    const atts = await prisma.portalAttachment.findMany({
      where: { client_id: conv.client_id, is_deleted: false, OR: [{ conversation_id: conv.id }, { conversation_id: null }] },
      select: { id: true, filename: true },
    });
    for (const id of ids) {
      if (id === 'no_file') continue;
      const a = atts.find((x) => x.id === id);
      if (a) add(id, a.filename);
      else dropped.push(id);
    }
  } else if (slot === 'other') {
    for (const id of ids) {
      const o = OPENING_CHOICES.find((x) => x.key === id);
      if (o) add(id, o.label);
      else dropped.push(id);
    }
  } else {
    dropped.push(...ids);
  }
  // Reserved closers last.
  if (slot === 'page') {
    add('another_page', CHOICE_LABELS.another_page);
    add('not_sure', CHOICE_LABELS.not_sure);
  } else if (slot === 'section') {
    add('not_sure', CHOICE_LABELS.not_sure);
  } else if (slot === 'asset') {
    add('no_file', CHOICE_LABELS.no_file);
  }
  return { choices, dropped };
}

export function isReservedChoice(id: string): boolean {
  return (RESERVED_CHOICES as readonly string[]).includes(id);
}

/** Pages ranked for a message: title or path words that appear in the text first, then depth. */
export function rankPages<T extends { title: string; path: string; depth?: number }>(pages: T[], text: string): T[] {
  const words = new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3));
  const score = (p: T) => {
    const hay = `${p.title} ${p.path}`.toLowerCase();
    let s = 0;
    for (const w of words) if (hay.includes(w)) s += 2;
    return s;
  };
  return [...pages].sort((a, b) => score(b) - score(a) || (a.depth ?? 0) - (b.depth ?? 0));
}
