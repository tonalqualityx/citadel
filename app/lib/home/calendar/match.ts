/**
 * Home screen Slice 10a: who a meeting is with. Pure over tables load.ts read. Checked in
 * this order for each other attendee: team, contact, lead, company web address; an email
 * thread that set the meeting up beats all of them, and a title match is the last resort.
 * A wrong match changes one label and a few links, and the drawer always says how it matched.
 */

import { isFreeMailDomain, isOwnDomain, normalizeHost } from '../emergency/rule';
import { CAL, TITLE_STOPLIST } from './rules';
import { others, type Attendee, type CalEvent } from './classify';
import { matchedByAsk, matchedByContact, matchedByDomain, matchedByLead, matchedByTitle, nameList, NO_MATCH_TEXT, safeText } from './copy';

export interface MatchTables {
  users: { email: string; name: string }[];
  contacts: { email: string; name: string | null; client_id: string; client_name: string }[];
  /** Accords already limited to the lead statuses and not deleted. */
  accords: { id: string; lead_email: string | null; lead_name: string | null; lead_business_name: string | null; updated_at: Date }[];
  domains: { name: string; client_id: string | null }[];
  sites: { url: string | null; client_id: string | null }[];
  /** Clients with a live project. */
  liveClientIds: ReadonlySet<string>;
  /** Live projects, for the title match. */
  projects: { id: string; name: string; client_id: string; client_name: string }[];
  /** Active clients, for the title match. */
  clients: { id: string; name: string }[];
  /** Asks that point at an event (EmailAsk.calendar_event_id). */
  eventAsks: { calendar_event_id: string; client_id: string | null; client_name: string | null; received_at: Date }[];
  /** Recent asks from these addresses, newest first, with the client each was filed under. */
  addressAsks: { from_email: string; client_id: string; received_at: Date }[];
}

export type PersonKind = 'team' | 'contact' | 'lead' | 'domain' | 'none';

export interface PersonMatch {
  email: string;
  /** Display name, else the user's or contact's name, else null. */
  name: string | null;
  first: string;
  kind: PersonKind;
  client_id: string | null;
  client_name: string | null;
  accord_id: string | null;
  response_status: string | null;
}

export type MatchHow = 'ask' | 'contact' | 'lead' | 'domain' | 'title' | 'none';

export interface EventMatch {
  /** The row's who for a meeting. Never contains an address. */
  label: string;
  /** A client, a lead or the title matched. */
  matched: boolean;
  how: MatchHow;
  client: { id: string; name: string } | null;
  lead: { id: string; name: string; business: string | null } | null;
  also_with: string[];
  people: PersonMatch[];
  matched_by: string;
}

export const EMPTY_TABLES: MatchTables = {
  users: [], contacts: [], accords: [], domains: [], sites: [], liveClientIds: new Set(), projects: [], clients: [], eventAsks: [], addressAsks: [],
};

function domainOf(email: string): string {
  return email.split('@')[1] ?? '';
}

function localOf(email: string): string {
  return email.split('@')[0] ?? '';
}

function firstWord(name: string | null | undefined): string {
  const w = safeText(name).split(' ')[0] ?? '';
  return w;
}

/** First name for a label: the first word of the display name, else the part before the @ (and the domain unless free mail). */
function unmatchedLabel(a: Attendee): string {
  const w = firstWord(a.display_name);
  if (w) return w;
  const local = safeText(localOf(a.email));
  const dom = domainOf(a.email);
  return isFreeMailDomain(dom) || !dom ? local : `${local}, ${dom}`;
}

function firstFor(a: Attendee, known: string | null): string {
  return firstWord(known) || firstWord(a.display_name) || safeText(localOf(a.email));
}

function wordBoundary(haystack: string, needle: string): boolean {
  const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${esc}($|[^\\p{L}\\p{N}])`, 'iu').test(haystack);
}

function titleHit(title: string, t: MatchTables): { id: string; name: string } | null {
  const usable = (name: string) => name.trim().length >= CAL.titleMin && !TITLE_STOPLIST.includes(name.trim().toLowerCase());
  const projectHits = t.projects.filter((p) => usable(p.name) && wordBoundary(title, p.name.trim()));
  if (projectHits.length === 1) return { id: projectHits[0].client_id, name: projectHits[0].client_name };
  if (projectHits.length > 1) return null;
  const clientHits = t.clients.filter((c) => usable(c.name) && wordBoundary(title, c.name.trim()));
  return clientHits.length === 1 ? { id: clientHits[0].id, name: clientHits[0].name } : null;
}

function pickContactClient(addr: string, t: MatchTables): { id: string; name: string; name_of_person: string | null } | null {
  const rows = t.contacts.filter((c) => c.email.toLowerCase() === addr);
  if (rows.length === 0) return null;
  const newest = new Map<string, number>();
  for (const a of t.addressAsks) if (a.from_email.toLowerCase() === addr) newest.set(a.client_id, Math.max(newest.get(a.client_id) ?? 0, a.received_at.getTime()));
  rows.sort((a, b) => {
    const la = t.liveClientIds.has(a.client_id) ? 1 : 0;
    const lb = t.liveClientIds.has(b.client_id) ? 1 : 0;
    if (la !== lb) return lb - la;
    const na = newest.get(a.client_id) ?? 0;
    const nb = newest.get(b.client_id) ?? 0;
    if (na !== nb) return nb - na;
    return a.client_name.localeCompare(b.client_name);
  });
  return { id: rows[0].client_id, name: rows[0].client_name, name_of_person: rows[0].name };
}

function domainClient(addr: string, t: MatchTables): { id: string; name: string } | null {
  const dom = domainOf(addr);
  if (!dom || isFreeMailDomain(dom) || isOwnDomain(dom)) return null;
  const ids = new Set<string>();
  for (const d of t.domains) if (d.client_id && normalizeHost(d.name) === dom) ids.add(d.client_id);
  for (const s of t.sites) if (s.client_id && normalizeHost(s.url) === dom) ids.add(s.client_id);
  const names = new Map<string, string>();
  for (const c of t.contacts) {
    if (domainOf(c.email.toLowerCase()) === dom) {
      ids.add(c.client_id);
      names.set(c.client_id, c.client_name);
    }
  }
  if (ids.size !== 1) return null;
  const id = [...ids][0];
  const name = names.get(id) ?? t.clients.find((c) => c.id === id)?.name ?? t.projects.find((p) => p.client_id === id)?.client_name ?? null;
  return name ? { id, name } : null;
}

function matchPerson(a: Attendee, t: MatchTables): PersonMatch {
  const base = { email: a.email, response_status: a.response_status, accord_id: null as string | null };
  const user = t.users.find((u) => u.email.toLowerCase() === a.email);
  if (user || isOwnDomain(domainOf(a.email))) {
    return { ...base, name: a.display_name ?? user?.name ?? null, first: firstFor(a, user?.name ?? null), kind: 'team', client_id: null, client_name: null };
  }
  const contact = pickContactClient(a.email, t);
  if (contact) {
    return { ...base, name: a.display_name ?? contact.name_of_person, first: firstFor(a, contact.name_of_person), kind: 'contact', client_id: contact.id, client_name: contact.name };
  }
  const lead = t.accords.filter((x) => (x.lead_email ?? '').toLowerCase() === a.email).sort((x, y) => y.updated_at.getTime() - x.updated_at.getTime())[0];
  if (lead) {
    return { ...base, accord_id: lead.id, name: a.display_name ?? lead.lead_name, first: firstFor(a, lead.lead_name), kind: 'lead', client_id: null, client_name: null };
  }
  const dc = domainClient(a.email, t);
  if (dc) return { ...base, name: a.display_name, first: firstFor(a, null), kind: 'domain', client_id: dc.id, client_name: dc.name };
  return { ...base, name: a.display_name, first: unmatchedLabel(a), kind: 'none', client_id: null, client_name: null };
}

export function matchEvent(event: CalEvent, t: MatchTables): EventMatch {
  const people = others(event).slice(0, 50).map((a) => matchPerson(a, t));
  const askRow = t.eventAsks
    .filter((a) => a.calendar_event_id === event.event_id && a.client_id && a.client_name)
    .sort((a, b) => b.received_at.getTime() - a.received_at.getTime())[0];

  // Primary client: the setup email, else most matched attendees, then a live project, then name.
  const counts = new Map<string, { id: string; name: string; n: number }>();
  for (const p of people) {
    if (!p.client_id || !p.client_name) continue;
    const c = counts.get(p.client_id) ?? { id: p.client_id, name: p.client_name, n: 0 };
    c.n += 1;
    counts.set(p.client_id, c);
  }
  const ranked = [...counts.values()].sort((a, b) => {
    if (a.n !== b.n) return b.n - a.n;
    const la = t.liveClientIds.has(a.id) ? 1 : 0;
    const lb = t.liveClientIds.has(b.id) ? 1 : 0;
    if (la !== lb) return lb - la;
    return a.name.localeCompare(b.name);
  });

  let client: { id: string; name: string } | null = null;
  let how: MatchHow = 'none';
  if (askRow) {
    client = { id: askRow.client_id as string, name: askRow.client_name as string };
    how = 'ask';
  } else if (ranked[0]) {
    client = { id: ranked[0].id, name: ranked[0].name };
    how = people.some((p) => p.client_id === client!.id && p.kind === 'contact') ? 'contact' : 'domain';
  }

  const leadPerson = people.find((p) => p.kind === 'lead');
  const leadRow = leadPerson ? t.accords.find((x) => x.id === leadPerson.accord_id) : undefined;
  let lead: EventMatch['lead'] = null;
  if (!client && leadPerson && leadRow) {
    lead = { id: leadRow.id, name: firstWord(leadRow.lead_name) || leadPerson.first, business: safeText(leadRow.lead_business_name) || null };
    how = 'lead';
  }
  if (!client && !lead) {
    const hit = titleHit(event.title, t);
    if (hit) {
      client = hit;
      how = 'title';
    }
  }

  const also: string[] = [];
  for (const c of ranked) if (!client || c.id !== client.id) also.push(safeText(c.name));
  if (client && leadRow && leadPerson) also.push(`${safeText(leadRow.lead_business_name) || firstWord(leadRow.lead_name)} (lead)`);

  const nonTeam = people.filter((p) => p.kind !== 'team');
  const teamOnly = people.length > 0 && nonTeam.length === 0;
  let label: string;
  if (client) {
    const mine = people.filter((p) => p.client_id === client!.id).map((p) => p.first);
    const names = mine.length > 0 ? mine : nonTeam.filter((p) => p.kind === 'none').map((p) => p.first);
    label = names.length > 0 ? `${nameList(names)}, ${safeText(client.name)}` : safeText(client.name);
  } else if (lead) {
    label = lead.business ? `${lead.name}, ${lead.business} (lead)` : `${lead.name} (lead)`;
  } else if (teamOnly) {
    label = nameList(people.map((p) => p.first));
  } else {
    label = nameList(nonTeam.map((p) => p.first));
  }
  label = safeText(label);

  const matchedNames = client ? nameList(people.filter((p) => p.client_id === client!.id).map((p) => p.first)) : '';
  let matched_by = NO_MATCH_TEXT;
  if (how === 'ask') matched_by = matchedByAsk;
  else if (how === 'contact' && matchedNames) matched_by = matchedByContact(matchedNames);
  else if (how === 'domain' && matchedNames) matched_by = matchedByDomain(matchedNames);
  else if (how === 'lead' && lead) matched_by = matchedByLead(lead.name);
  else if (how === 'title') matched_by = matchedByTitle;

  return {
    label,
    matched: client !== null || lead !== null,
    how,
    client,
    lead,
    also_with: also,
    people,
    matched_by,
  };
}
