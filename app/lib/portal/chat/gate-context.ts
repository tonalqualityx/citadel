/**
 * Builds the GateContext for one job (phase C spec 9.2): who the staff are, who the other clients
 * are, which links are allowed, and the provenance of this job's numbers. The gate itself is pure
 * (gate.ts); everything it needs from the database is loaded here.
 */
import { prisma } from '@/lib/db/prisma';
import { loadJobProvenance } from '@/lib/engine/tool-calls';
import { portalBaseUrl } from '@/lib/portal/notices';
import { contextClientTexts, contextNumbers, loadPageNames, type ChatContext } from '@/lib/portal/chat/context';
import type { GateContext } from '@/lib/portal/chat/gate';

/** First names that are also plain English words: staff with these names are not matched as names. */
const ENGLISH_NAMES = new Set(['will', 'mark', 'grant', 'art', 'bill', 'rob', 'hope', 'grace', 'joy', 'may', 'june', 'april', 'august', 'summer', 'dawn', 'faith', 'rose', 'lily', 'ivy', 'amber', 'sky', 'bob', 'pat', 'rich', 'sue', 'jack', 'drew', 'case', 'major', 'frank', 'chase', 'guy', 'sandy']);
const TTL_MS = 5 * 60_000;
let cache: { at: number; staff: string[]; clients: Array<{ id: string; name: string }> } | null = null;

async function lists(now: number) {
  if (cache && now - cache.at < TTL_MS) return cache;
  const [users, clients] = await Promise.all([
    prisma.user.findMany({ where: { is_active: true }, select: { name: true } }),
    prisma.client.findMany({ where: { is_deleted: false }, select: { id: true, name: true } }),
  ]);
  const staff = [...new Set(users.map((u) => (u.name ?? '').trim().split(/\s+/)[0]).filter((n) => n.length >= 3 && !ENGLISH_NAMES.has(n.toLowerCase())))];
  cache = { at: now, staff, clients };
  return cache;
}

/** Test hook: forget the cached name lists. */
export function resetGateListsCache(): void {
  cache = null;
}

function domainOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

export async function loadGateContext(input: {
  jobId: string;
  clientId: string;
  contactId: string;
  context: ChatContext;
  now?: Date;
}): Promise<GateContext> {
  const now = (input.now ?? new Date()).getTime();
  const [l, sites, contact, provenance, reportCalls] = await Promise.all([
    lists(now),
    prisma.site.findMany({ where: { client_id: input.clientId, is_deleted: false }, select: { id: true, url: true } }),
    prisma.clientContact.findFirst({ where: { id: input.contactId }, select: { email: true, name: true } }),
    loadJobProvenance(input.jobId, contextNumbers(input.context), contextClientTexts(input.context)),
    prisma.engineToolCall.findMany({ where: { job_id: input.jobId, tool: 'citadel_read', error: null }, select: { args: true, result: true } }),
  ]);
  const own = (contact?.name ?? '').trim().split(/\s+/)[0].toLowerCase();
  const reportUrls: string[] = [];
  for (const c of reportCalls) {
    if ((c.args as { kind?: string } | null)?.kind !== 'reports') continue;
    const reports = ((c.result as { data?: { reports?: Array<{ url?: string }> }; reports?: Array<{ url?: string }> } | null) ?? {});
    for (const r of reports.data?.reports ?? reports.reports ?? []) if (typeof r.url === 'string') reportUrls.push(r.url);
  }
  return {
    provenance,
    staffNames: l.staff.filter((n) => n.toLowerCase() !== own),
    otherClientNames: l.clients.filter((c) => c.id !== input.clientId && c.name.trim().length >= 4).map((c) => c.name.trim()),
    pageNames: await loadPageNames(sites.map((s) => s.id)),
    clientDomains: sites.map((s) => domainOf(s.url)).filter((d): d is string => Boolean(d)),
    portalOrigins: [portalBaseUrl()],
    reportUrls,
    contactEmail: contact?.email ?? null,
  };
}
