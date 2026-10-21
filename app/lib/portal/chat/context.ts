/**
 * The context bundle (phase C spec 10): the only thing a chat run knows about the client.
 * Assembled by Citadel at claim, from an explicit allowlist of fields, about 6,000 tokens at most.
 *
 * Never included: other clients, internal notes, tags, staff names, invoices (only through the tool,
 * by role), hours used, wait records, the internal parts of the task description, the name Bast.
 * GA4 and Search Console ids are NEVER in the bundle; they go to the tool server's environment
 * through `buildToolScope`, a separate object.
 */
import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import { canSeeAnalytics, canSeeBilling, type PortalAccess } from '@/lib/portal/access';
import { allowanceText } from '@/lib/portal/retainer';
import { loadRequests, loadWorkItem, firstName } from '@/lib/portal/requests';
import { threadCommentWhere } from '@/lib/portal/thread';
import { engagementText } from '@/lib/portal/engagement';
import { numbersInText } from '@/lib/portal/chat/provenance';

export const MAX_THREAD_MESSAGES = 30;
export const MAX_PAGES_IN_CONTEXT = 60;
export const MAX_SECTIONS_PER_PAGE = 8;
export const MAX_OPEN_WORK = 10;
/** About 6,000 tokens of JSON. */
export const BUNDLE_MAX_CHARS = 24_000;

export function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function attr(text: string): string {
  return escapeXml(text).replace(/"/g, '&quot;');
}

function sizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export interface ContextSite {
  id: string;
  domain: string;
  platform: string | null;
  has_care_plan: boolean;
  analytics_connected: boolean;
  search_console_connected: boolean;
}

export interface ContextPage {
  id: string;
  site_id: string;
  title: string;
  path: string;
  sections: string[];
}

export interface ChatContext {
  client: { name: string };
  contact: { first_name: string | null; role: string; can_see_analytics: boolean; can_see_billing: boolean };
  sites: ContextSite[];
  pages: ContextPage[];
  task: {
    client_title: string;
    state_label: string;
    engagement_label: string;
    slots: unknown;
    summary_version: number;
    open_ask: unknown;
  };
  open_work: Array<{ title: string; state_label: string }>;
  plan_allowance: string | null;
  /** The last messages, oldest first, as tagged text. Client words are data, never instructions. */
  thread: string;
  voice_sample: string | null;
  today: string;
}

/** The tool server's scope: set by the runner as environment variables, never shown to the model. */
export interface ToolScope {
  job_id: string;
  client_id: string;
  contact_id: string;
  can_see_analytics: boolean;
  can_see_billing: boolean;
  sites: Array<{ id: string; domain: string; ga4_property: string | null; gsc_property: string | null }>;
}

function domainOf(url: string | null, name: string): string {
  if (url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      /* fall through */
    }
  }
  return name;
}

function todayNY(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

interface ThreadRow {
  id: string;
  content: string;
  created_at: Date;
  source: string | null;
  chat_meta: unknown;
  author_contact_id: string | null;
  user_id: string | null;
  author_contact: { name: string | null } | null;
}

interface AttachmentRow {
  id: string;
  comment_id: string | null;
  filename: string;
  content_type: string;
  size_bytes: number;
}

/** Render the conversation as the model reads it. */
export function renderThread(rows: ThreadRow[], attachments: AttachmentRow[]): string {
  const byComment = new Map<string, AttachmentRow[]>();
  for (const a of attachments) {
    if (!a.comment_id) continue;
    byComment.set(a.comment_id, [...(byComment.get(a.comment_id) ?? []), a]);
  }
  const lines: string[] = [];
  for (const r of rows) {
    const at = r.created_at.toISOString();
    const files = (byComment.get(r.id) ?? [])
      .map((a) => `<attachment id="${attr(a.id)}" name="${attr(a.filename)}" type="${attr(a.content_type)}" size="${sizeLabel(a.size_bytes)}"/>`)
      .join('');
    if (r.author_contact_id) {
      const via = r.source === 'email' ? 'email' : 'portal';
      const who = firstName(r.author_contact?.name) ?? 'Client';
      const meta = (r.chat_meta ?? {}) as { choice?: { slot?: string; id?: string; label?: string } };
      if (meta.choice && meta.choice.id) {
        lines.push(`<client_choice slot="${attr(String(meta.choice.slot ?? ''))}" id="${attr(String(meta.choice.id))}" label="${attr(String(meta.choice.label ?? ''))}"/>`);
      }
      // A choice saves its label as the comment text: render it once, as the choice.
      const sameAsChoice = Boolean(meta.choice?.id) && r.content.trim() === String(meta.choice?.label ?? '').trim();
      if ((r.content.trim() && !sameAsChoice) || !meta.choice) {
        lines.push(`<client_message from="${attr(who)}" via="${via}" at="${at}">${escapeXml(r.content)}</client_message>`);
      }
      if (files) lines.push(files);
    } else if (r.source === 'assistant') {
      lines.push(`<assistant_reply at="${at}">${escapeXml(r.content)}</assistant_reply>`);
    } else {
      lines.push(`<team_reply at="${at}">${escapeXml(r.content)}</team_reply>`);
    }
  }
  return lines.join('\n');
}

/**
 * Build the bundle for one conversation. `access` is the contact's resolved portal access on the
 * conversation's client (see accessForJob). Throws 404 when the conversation does not belong to
 * the access's client.
 */
export async function buildContext(
  access: PortalAccess,
  conversationId: string,
  opts: { now?: Date; voiceSample?: string | null } = {}
): Promise<ChatContext> {
  const now = opts.now ?? new Date();
  const convo = await prisma.chatConversation.findFirst({
    where: { id: conversationId, client_id: access.clientId },
    select: { id: true, task_id: true, site_id: true, slots: true, summary_version: true, open_ask: true },
  });
  if (!convo) throw new ApiError('Conversation not found', 404);

  const [client, contact, sites, plan] = await Promise.all([
    prisma.client.findUnique({ where: { id: access.clientId }, select: { name: true } }),
    prisma.clientContact.findFirst({ where: { id: access.contactId }, select: { name: true } }),
    prisma.site.findMany({
      where: { client_id: access.clientId, is_deleted: false },
      select: { id: true, name: true, url: true, platform: true, maintenance_plan_id: true, ga4_property: true, gsc_property: true },
      orderBy: { name: 'asc' },
    }),
    prisma.charter.findFirst({
      where: { client_id: access.clientId, status: 'active' },
      select: { budget_hours: true, billing_period: true },
      orderBy: { created_at: 'asc' },
    }),
  ]);

  // Only this client's own sites, whatever the conversation row says.
  const ownSiteIds = new Set(sites.map((s) => s.id));
  const siteIds = convo.site_id ? (ownSiteIds.has(convo.site_id) ? [convo.site_id] : []) : [...ownSiteIds];
  const [pageRows, work, threadDesc, openWork] = await Promise.all([
    prisma.sitePage.findMany({
      where: { site_id: { in: siteIds }, missing_since: null },
      orderBy: [{ depth: 'asc' }, { path: 'asc' }],
      take: MAX_PAGES_IN_CONTEXT,
      select: { id: true, site_id: true, title: true, path: true, sections: true },
    }),
    loadWorkItem(access, convo.task_id),
    prisma.comment.findMany({
      where: { task_id: convo.task_id, ...threadCommentWhere() },
      orderBy: { created_at: 'desc' },
      take: MAX_THREAD_MESSAGES,
      select: {
        id: true, content: true, created_at: true, source: true, chat_meta: true,
        author_contact_id: true, user_id: true, author_contact: { select: { name: true } },
      },
    }),
    loadRequests(access, { now }),
  ]);
  const rows = (threadDesc as ThreadRow[]).slice().reverse();
  const attachments = rows.length
    ? await prisma.portalAttachment.findMany({
        where: { comment_id: { in: rows.map((r) => r.id) }, is_deleted: false },
        select: { id: true, comment_id: true, filename: true, content_type: true, size_bytes: true },
      })
    : [];

  const ctx: ChatContext = {
    client: { name: client?.name ?? '' },
    contact: {
      first_name: firstName(contact?.name),
      role: access.role,
      can_see_analytics: canSeeAnalytics(access.role),
      can_see_billing: canSeeBilling(access.role),
    },
    sites: sites.map((s) => ({
      id: s.id,
      domain: domainOf(s.url, s.name),
      platform: s.platform,
      has_care_plan: Boolean(s.maintenance_plan_id),
      analytics_connected: Boolean(s.ga4_property),
      search_console_connected: Boolean(s.gsc_property),
    })),
    pages: pageRows.map((p) => ({
      id: p.id,
      site_id: p.site_id,
      title: p.title,
      path: p.path,
      sections: (Array.isArray(p.sections) ? (p.sections as Array<{ heading?: unknown }>) : [])
        .map((s) => (typeof s?.heading === 'string' ? s.heading : ''))
        .filter(Boolean)
        .slice(0, MAX_SECTIONS_PER_PAGE),
    })),
    task: {
      client_title: work?.title ?? '',
      state_label: work?.state.label ?? '',
      engagement_label: work ? engagementText(work.engagement) : '',
      slots: convo.slots,
      summary_version: convo.summary_version,
      open_ask: convo.open_ask,
    },
    open_work: openWork.open
      .filter((i) => i.id !== convo.task_id)
      .slice(0, MAX_OPEN_WORK)
      .map((i) => ({ title: i.title, state_label: i.state.label })),
    // The copy gate rejects "includes", so the bundle says "covers".
    plan_allowance: plan ? (allowanceText(plan.budget_hours, plan.billing_period === 'annually' ? 'annually' : 'monthly') ?? '').replace(/\bincludes\b/g, 'covers') || null : null,
    thread: renderThread(rows, attachments),
    voice_sample: opts.voiceSample ?? null,
    today: todayNY(now),
  };
  return capBundle(ctx, rows, attachments);
}

/** Keep the bundle under the size bound: drop the oldest messages first, then pages. */
export function capBundle(ctx: ChatContext, rows: ThreadRow[], attachments: AttachmentRow[]): ChatContext {
  let out = ctx;
  let keep = rows.length;
  while (JSON.stringify(out).length > BUNDLE_MAX_CHARS && keep > 4) {
    keep = Math.max(4, keep - 4);
    out = { ...out, thread: renderThread(rows.slice(rows.length - keep), attachments) };
  }
  let pages = out.pages.length;
  while (JSON.stringify(out).length > BUNDLE_MAX_CHARS && pages > 10) {
    pages = Math.max(10, pages - 10);
    out = { ...out, pages: out.pages.slice(0, pages) };
  }
  return out;
}

/**
 * The numbers in the client's own words, for the gate: the text of their messages only, never the
 * tags, ids, timestamps or file names around them. The gate lets the assistant echo them only
 * inside quotation marks (and a bare year). The allowance, today's date and the slots are NOT here.
 */
export function contextNumbers(ctx: Pick<ChatContext, 'thread'>): string[] {
  const out: string[] = [];
  for (const m of ctx.thread.matchAll(/<client_message\b[^>]*>([\s\S]*?)<\/client_message>/g)) {
    const text = m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    out.push(...numbersInText(text));
  }
  return out;
}

/** The client's message texts, unescaped: what the gate treats as their words when a reply quotes them. */
export function contextClientTexts(ctx: Pick<ChatContext, 'thread'>): string[] {
  return [...ctx.thread.matchAll(/<client_message\b[^>]*>([\s\S]*?)<\/client_message>/g)].map((m) =>
    m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  );
}

/** The titles of the live pages on the given sites: page names the gate lets a reply say verbatim. */
export async function loadPageNames(siteIds: string[]): Promise<string[]> {
  if (siteIds.length === 0) return [];
  const rows = await prisma.sitePage.findMany({ where: { site_id: { in: siteIds }, missing_since: null }, select: { title: true }, take: 400 });
  return [...new Set(rows.map((r) => r.title).filter(Boolean))];
}

export async function buildToolScope(
  access: PortalAccess,
  job: { id: string; client_id: string; contact_id: string },
  siteId?: string | null
): Promise<ToolScope> {
  const sites = await prisma.site.findMany({
    where: { client_id: access.clientId, is_deleted: false, ...(siteId ? { id: siteId } : {}) },
    select: { id: true, name: true, url: true, ga4_property: true, gsc_property: true },
    orderBy: { name: 'asc' },
  });
  return {
    job_id: job.id,
    client_id: job.client_id,
    contact_id: job.contact_id,
    can_see_analytics: canSeeAnalytics(access.role),
    can_see_billing: canSeeBilling(access.role),
    sites: sites.map((s) => ({ id: s.id, domain: domainOf(s.url, s.name), ga4_property: s.ga4_property, gsc_property: s.gsc_property })),
  };
}
