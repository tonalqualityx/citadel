/**
 * Home screen Slice 10a: the meeting drawer's contents, pure over the Candidates selectHome
 * already built (read only, as 8a does) and the context context.ts read. Nothing here scores,
 * ranks or changes an item. Event text is untrusted: it comes out as plain text, and links
 * only when they are https.
 */

import type { Candidate } from '../select';
import type { RawHomeInputs, HomeRef } from '../types';
import { threadKey, sessionKey } from '../item-key';
import { dayWithWeekday, dayShort } from '../projects/copy';
import { drawerCompare, whereOf } from '../projects/drawer';
import type { HomeProjectItem } from '../projects/types';
import { CAL, REPORT_NAME_PATTERN } from './rules';
import { clockLabel, weekdayName } from './clock';
import type { CalEvent, EventKind } from './classify';
import type { EventMatch } from './match';
import { meetingLinksIn, parseHttps, pickJoin } from './join';
import type { HomeCalendarEventResponse, HomeCalendarLink } from './types';
import * as C from './copy';

export interface DrawerContext {
  /** The primary client's projects: live ones, and ones done in the last 180 days. */
  projects: { id: string; name: string; live: boolean; updated_at: Date; drive_folder_id: string | null }[];
  resourceLinks: { project_id: string; name: string; url: string; created_at: Date }[];
  latestReport: { period: string; url: string; published_at: Date | null } | null;
  lastAsk: { from_name: string | null; from_email: string; subject: string; deep_link: string; received_at: Date } | null;
  accord: { id: string; name: string } | null;
  meeting: { id: string; meeting_date: Date } | null;
  clientDriveId: string | null;
  /** thread_key of the 4d block this event is, when it is one. */
  answerThreadKey: string | null;
}

export const EMPTY_CONTEXT: DrawerContext = {
  projects: [], resourceLinks: [], latestReport: null, lastAsk: null, accord: null, meeting: null, clientDriveId: null, answerThreadKey: null,
};

export interface DrawerInput {
  now: Date;
  timeZone: string;
  event: CalEvent;
  kind: EventKind;
  match: EventMatch;
  raw: Pick<RawHomeInputs, 'threads' | 'session_asks'>;
  candidates: Candidate[];
  ctx: DrawerContext;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function liveProjectIds(ctx: DrawerContext): Set<string> {
  return new Set(ctx.projects.filter((p) => p.live).map((p) => p.id));
}

/** The newest-first asks of each thread candidate, by item key. */
function threadAsks(raw: DrawerInput['raw']): Map<string, DrawerInput['raw']['threads'][number]['asks']> {
  return new Map(raw.threads.map((t) => [threadKey(t.account, t.thread_id), t.asks]));
}

function attendeeSet(match: EventMatch): Set<string> {
  return new Set(match.people.map((p) => p.email.toLowerCase()));
}

function firstOf(match: EventMatch, email: string, fallback: string | null): string {
  const p = match.people.find((x) => x.email.toLowerCase() === email.toLowerCase());
  return C.safeText(p?.first || (fallback ?? '').split(' ')[0] || email.split('@')[0]);
}

const live = (c: Candidate): boolean => c.inView && !c.parked;

/** Which of his candidates belong to this meeting, before the cap. Excludes hands, step and review pieces as 8a does. */
function belonging(inp: DrawerInput): Candidate[] {
  const asks = threadAsks(inp.raw);
  const att = attendeeSet(inp.match);
  const projects = liveProjectIds(inp.ctx);
  const clientId = inp.match.client?.id ?? null;
  return inp.candidates
    .filter(live)
    .filter((c) => c.kind !== 'hands' && c.kind !== 'step' && c.restGroup !== 'review_pieces')
    .filter((c) => {
      if (inp.ctx.answerThreadKey && c.key === inp.ctx.answerThreadKey) return true;
      if (clientId && c.item.client?.id === clientId) return true;
      if (c.item.project && projects.has(c.item.project.id)) return true;
      if (c.kind === 'thread') return (asks.get(c.key) ?? []).some((a) => att.has(a.from_email.toLowerCase()));
      return false;
    })
    .sort(drawerCompare);
}

export function drawerItems(inp: DrawerInput): { items: HomeProjectItem[]; more_items: number; more_project_id: string | null } {
  const all = belonging(inp);
  const shown = all.slice(0, CAL.items).map((c) => ({ item: c.item, where: whereOf(c, inp.timeZone) }));
  const more = Math.max(0, all.length - CAL.items);
  const projectIds = new Set(all.map((c) => c.item.project?.id ?? null));
  const only = projectIds.size === 1 ? [...projectIds][0] : null;
  return { items: shown, more_items: more, more_project_id: more > 0 && only ? only : null };
}

export function drawerHints(inp: DrawerInput): { text: string; muted: boolean }[] {
  const out: { text: string; muted: boolean }[] = [];
  const asks = threadAsks(inp.raw);
  const att = attendeeSet(inp.match);
  const projects = liveProjectIds(inp.ctx);
  const clientId = inp.match.client?.id ?? null;

  for (const c of inp.candidates) {
    if (c.kind !== 'thread' || !live(c)) continue;
    const a = (asks.get(c.key) ?? []).find((x) => att.has(x.from_email.toLowerCase()));
    if (a) out.push({ text: C.holdsReply(firstOf(inp.match, a.from_email, a.from_name), C.safeText(asks.get(c.key)?.[0]?.subject ?? a.subject)), muted: false });
  }

  if (clientId) {
    const titles = new Map<string, number>();
    const byKey = new Map(inp.raw.session_asks.map((s) => [sessionKey(s.external_id), s.title]));
    for (const c of inp.candidates) {
      if (c.kind !== 'session' || !live(c) || c.item.client?.id !== clientId) continue;
      const t = C.safeText(byKey.get(c.key) ?? '');
      titles.set(t, (titles.get(t) ?? 0) + 1);
    }
    for (const [t, n] of titles) out.push({ text: C.sessionQuestions(n, t || null), muted: false });

    for (const c of inp.candidates) {
      if (c.kind === 'review' && live(c) && c.item.project && projects.has(c.item.project.id)) {
        out.push({ text: C.signOffWaits(C.safeText(c.item.project.name)), muted: false });
      }
    }
    for (const c of inp.candidates) {
      if (c.rule && live(c) && c.item.client?.id === clientId) out.push({ text: C.needsYouNow(C.safeText(c.item.title)), muted: false });
    }
  }

  for (const c of inp.candidates) {
    if (c.kind !== 'thread' || !c.parked) continue;
    const a = (asks.get(c.key) ?? []).find((x) => att.has(x.from_email.toLowerCase()));
    if (!a) continue;
    const until = c.state?.view_at ? weekdayName(c.state.view_at, inp.timeZone) : null;
    out.push({ text: C.setAsideReply(firstOf(inp.match, a.from_email, a.from_name), until), muted: true });
  }
  return out.slice(0, CAL.hints);
}

function httpsOrNull(raw: string | null | undefined): string | null {
  return parseHttps(raw)?.href ?? null;
}

const MONTH_NAME = (period: string): string => {
  const m = /^\d{4}-(\d{2})$/.exec(period);
  return m ? MONTHS[Math.max(0, Math.min(11, Number(m[1]) - 1))] : period;
};

export function reportLinks(inp: Pick<DrawerInput, 'now' | 'ctx'>): HomeCalendarLink[] {
  const cutoff = inp.now.getTime() - CAL.reportDoneDays * 86_400_000;
  const eligible = new Set(inp.ctx.projects.filter((p) => p.live || p.updated_at.getTime() >= cutoff).map((p) => p.id));
  const out: HomeCalendarLink[] = [];
  const found = inp.ctx.resourceLinks
    .filter((r) => eligible.has(r.project_id) && REPORT_NAME_PATTERN.test(r.name) && httpsOrNull(r.url))
    .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
    .slice(0, CAL.reportLinks);
  for (const r of found) out.push({ label: C.safeText(r.name) || 'Report', href: httpsOrNull(r.url), project_id: null });
  const rep = inp.ctx.latestReport;
  if (rep && httpsOrNull(rep.url)) out.push({ label: C.monthlyReportLabel(MONTH_NAME(rep.period)), href: httpsOrNull(rep.url), project_id: null });
  const projectDrive = inp.ctx.projects.find((p) => p.live && p.drive_folder_id)?.drive_folder_id ?? null;
  const folder = projectDrive ?? inp.ctx.clientDriveId;
  if (folder && /^[A-Za-z0-9_-]{5,128}$/.test(folder)) {
    out.push({ label: C.DRIVE_LABEL, href: `https://drive.google.com/drive/folders/${folder}`, project_id: null });
  }
  return out;
}

export function drawerLinks(inp: DrawerInput): HomeCalendarLink[] {
  const head: HomeCalendarLink[] = [];
  const tail: HomeCalendarLink[] = [];
  const liveOnes = inp.ctx.projects.filter((p) => p.live).sort((a, b) => b.updated_at.getTime() - a.updated_at.getTime()).slice(0, 2);
  for (const p of liveOnes) head.push({ label: C.safeText(p.name), href: null, project_id: p.id });

  const ask = inp.ctx.lastAsk;
  if (ask && httpsOrNull(ask.deep_link)) {
    const from = C.safeText((ask.from_name ?? '').split(' ')[0] || ask.from_email.split('@')[0]);
    head.push({ label: C.lastEmailLabel(dayWithWeekday(ask.received_at, inp.timeZone), from, C.safeText(ask.subject)), href: httpsOrNull(ask.deep_link), project_id: null });
  }
  if (inp.kind === 'answer') {
    const asks = threadAsks(inp.raw);
    const href = httpsOrNull(asks.get(inp.ctx.answerThreadKey ?? '')?.[0]?.deep_link);
    if (href) head.push({ label: C.OPEN_THREAD_LABEL, href, project_id: null });
  }
  head.push(...reportLinks(inp));
  if (inp.ctx.meeting) head.push({ label: C.notesLabel(dayShort(inp.ctx.meeting.meeting_date, inp.timeZone)), href: `/meetings/${inp.ctx.meeting.id}`, project_id: null });

  if (inp.match.lead && inp.ctx.accord) tail.push({ label: C.dealLabel(C.safeText(inp.ctx.accord.name)), href: `/deals/${inp.ctx.accord.id}`, project_id: null });
  if (inp.match.client) tail.push({ label: C.openClientLabel(C.safeText(inp.match.client.name)), href: `/clients/${inp.match.client.id}`, project_id: null });
  return [...head.slice(0, Math.max(0, CAL.links - tail.length)), ...tail].slice(0, CAL.links);
}

function eventBlock(inp: DrawerInput): HomeCalendarEventResponse['event'] {
  const { event, timeZone } = inp;
  const loc = event.location && !/https?:/i.test(event.location) ? C.safeText(event.location).slice(0, 200) : '';
  return {
    id: event.id,
    title: C.safeText(event.title) || 'Meeting',
    when: `${weekdayName(event.starts_at, timeZone)} ${clockLabel(event.starts_at, timeZone)} to ${clockLabel(event.ends_at, timeZone)}`,
    location: loc || null,
    join: pickJoin(event),
    invite_text: C.inviteText(event.description),
    invite_links: meetingLinksIn(event.description).slice(0, CAL.inviteLinks),
  };
}

const REPLY_WORDS: Record<string, string> = { needsAction: 'has not replied', declined: 'declined', tentative: 'might come' };

export function buildDrawer(inp: DrawerInput): HomeCalendarEventResponse {
  const client: HomeRef | null = inp.match.client ? { id: inp.match.client.id, name: C.safeText(inp.match.client.name) } : null;
  const items = drawerItems(inp);
  return {
    event: eventBlock(inp),
    client,
    also_with: inp.match.also_with.map((n) => C.safeText(n)).filter(Boolean),
    people: inp.match.people.map((p) => ({
      name: C.safeText(p.name) || p.email,
      detail: p.kind === 'team' ? 'team' : p.client_name ? C.safeText(p.client_name) : p.kind === 'lead' ? 'lead' : null,
      reply: p.response_status ? (REPLY_WORDS[p.response_status] ?? null) : null,
    })),
    matched_by: inp.match.matched_by,
    hints: drawerHints(inp),
    ...items,
    links: drawerLinks(inp),
  };
}
