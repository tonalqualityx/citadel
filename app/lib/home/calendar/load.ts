/**
 * Home screen Slice 10a: the strip's reads. Read only. One window of events (today and
 * tomorrow), his booked event ids, and the tables the match needs for the addresses, domains
 * and titles in those events. The drawer's own reads live in context.ts.
 */

import type { PrismaClient } from '@prisma/client';
import { isFreeMailDomain, isOwnDomain } from '../emergency/rule';
import { LEAD_ACCORD_STATUSES, LIVE_PROJECT_STATUSES } from './rules';
import { eventsInView, daysFor } from './strip';
import { others, type CalEvent } from './classify';
import { EMPTY_TABLES, matchEvent, type EventMatch, type MatchTables } from './match';
import type { EventWho } from './strip';

type Db = Pick<PrismaClient, 'calendarEvent' | 'homeOwedThread' | 'user' | 'clientContact' | 'accord' | 'domain' | 'site' | 'project' | 'client' | 'emailAsk'>;

const EVENT_SELECT = {
  id: true,
  event_id: true,
  title: true,
  starts_at: true,
  ends_at: true,
  all_day: true,
  description: true,
  meet_url: true,
  location: true,
  attendees: true,
} as const;

/** Events that may sit on today or tomorrow in his zone. The strip and the drawer filter further. */
export async function loadCalendarDays(db: Pick<PrismaClient, 'calendarEvent'>, now: Date, timeZone: string): Promise<CalEvent[]> {
  const { today, tomorrow } = daysFor(now, timeZone);
  const rows = await db.calendarEvent.findMany({
    where: { starts_at: { lt: tomorrow.end }, ends_at: { gt: today.start } },
    select: EVENT_SELECT,
    orderBy: { starts_at: 'asc' },
  });
  return rows;
}

/** One event by its row id (the drawer), or null. */
export async function loadCalendarEvent(db: Pick<PrismaClient, 'calendarEvent'>, id: string): Promise<CalEvent | null> {
  return db.calendarEvent.findUnique({ where: { id }, select: EVENT_SELECT });
}

/** The Google event ids of his 4d "Answer" blocks. */
export async function loadBookedEventIds(db: Pick<PrismaClient, 'homeOwedThread'>, userId: string): Promise<Set<string>> {
  const rows = await db.homeOwedThread.findMany({
    where: { user_id: userId, booked_event_id: { not: null } },
    select: { booked_event_id: true },
  });
  return new Set(rows.map((r) => r.booked_event_id).filter((x): x is string => !!x));
}

const ci = (field: string, values: string[]) => values.map((v) => ({ [field]: { equals: v, mode: 'insensitive' as const } }));

export async function loadMatchTables(db: Db, events: CalEvent[]): Promise<MatchTables> {
  if (events.length === 0) return EMPTY_TABLES;
  const addrs = new Set<string>();
  for (const e of events) for (const a of others(e)) addrs.add(a.email);
  const addresses = [...addrs];
  const domains = [...new Set(addresses.map((a) => a.split('@')[1] ?? '').filter((d) => d && !isFreeMailDomain(d) && !isOwnDomain(d)))];
  const eventIds = events.map((e) => e.event_id);

  const [users, contacts, accords, domainRows, siteRows, projects, clients, eventAsks, addressAsks] = await Promise.all([
    addresses.length
      ? db.user.findMany({ where: { is_active: true, OR: ci('email', addresses) }, select: { email: true, name: true } })
      : Promise.resolve([]),
    addresses.length
      ? db.clientContact.findMany({
          where: {
            is_deleted: false,
            client: { is_deleted: false },
            OR: [...ci('email', addresses), ...domains.map((d) => ({ email: { endsWith: `@${d}`, mode: 'insensitive' as const } }))],
          },
          select: { email: true, name: true, client_id: true, client: { select: { name: true } } },
        })
      : Promise.resolve([]),
    addresses.length
      ? db.accord.findMany({
          where: { is_deleted: false, status: { in: [...LEAD_ACCORD_STATUSES] }, OR: ci('lead_email', addresses) },
          select: { id: true, lead_email: true, lead_name: true, lead_business_name: true, updated_at: true },
        })
      : Promise.resolve([]),
    domains.length
      ? db.domain.findMany({
          where: { is_deleted: false, OR: domains.flatMap((d) => ci('name', [d, `www.${d}`])) },
          select: { name: true, site: { select: { client_id: true } } },
        })
      : Promise.resolve([]),
    domains.length
      ? db.site.findMany({
          where: { is_deleted: false, OR: domains.map((d) => ({ url: { contains: d, mode: 'insensitive' as const } })) },
          select: { url: true, client_id: true },
        })
      : Promise.resolve([]),
    db.project.findMany({
      where: { is_deleted: false, status: { in: [...LIVE_PROJECT_STATUSES] }, client: { is_deleted: false } },
      select: { id: true, name: true, client_id: true, client: { select: { name: true } } },
    }),
    db.client.findMany({ where: { is_deleted: false, status: 'active' }, select: { id: true, name: true } }),
    db.emailAsk.findMany({
      where: { calendar_event_id: { in: eventIds }, client_id: { not: null } },
      select: { calendar_event_id: true, client_id: true, client: { select: { name: true } }, received_at: true },
    }),
    addresses.length
      ? db.emailAsk.findMany({
          where: { client_id: { not: null }, OR: ci('from_email', addresses) },
          select: { from_email: true, client_id: true, received_at: true },
          orderBy: { received_at: 'desc' },
          take: 100,
        })
      : Promise.resolve([]),
  ]);

  return {
    users,
    contacts: contacts.map((c) => ({ email: c.email, name: c.name, client_id: c.client_id, client_name: c.client.name })),
    accords,
    domains: domainRows.map((d) => ({ name: d.name, client_id: d.site?.client_id ?? null })),
    sites: siteRows,
    liveClientIds: new Set(projects.map((p) => p.client_id)),
    projects: projects.map((p) => ({ id: p.id, name: p.name, client_id: p.client_id, client_name: p.client.name })),
    clients,
    eventAsks: eventAsks.map((a) => ({
      calendar_event_id: a.calendar_event_id as string,
      client_id: a.client_id,
      client_name: a.client?.name ?? null,
      received_at: a.received_at,
    })),
    addressAsks: addressAsks.flatMap((a) => (a.client_id ? [{ from_email: a.from_email, client_id: a.client_id, received_at: a.received_at }] : [])),
  };
}

export interface CalendarView {
  /** Declined events are already gone; only events on today or tomorrow. */
  events: CalEvent[];
  bookedIds: Set<string>;
  tables: MatchTables;
  matches: Map<string, EventMatch>;
  who: Map<string, EventWho>;
}

/** Everything the strip and the chat shape need, read only. */
export async function loadCalendarView(db: Db, userId: string, now: Date, timeZone: string): Promise<CalendarView> {
  const [raw, bookedIds] = await Promise.all([loadCalendarDays(db, now, timeZone), loadBookedEventIds(db, userId)]);
  const events = eventsInView(raw, now, timeZone);
  const tables = await loadMatchTables(db, events);
  const matches = new Map<string, EventMatch>();
  const who = new Map<string, EventWho>();
  for (const e of events) {
    const m = matchEvent(e, tables);
    matches.set(e.id, m);
    who.set(e.id, { label: m.label, matched: m.matched });
  }
  return { events, bookedIds, tables, matches, who };
}

