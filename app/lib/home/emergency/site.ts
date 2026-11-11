/**
 * Home screen Slice 6a: site down signals, the pure part.
 *
 * Two sources reach a HomeSiteIncident: the watchdog's confirmed Kuma incidents, and an urgent uptime mail that names
 * the host of one of our sites plus Bast's own second check. Matching only ever picks from the Site hosts Citadel
 * already knows. No domain found in mail text is ever handed on to be fetched.
 *
 * Pure: no I/O, no Prisma.
 */

import { isNoiseClientName, NOISE_SENDER_DOMAINS } from '../rules';
import { normalizeHost } from './rule';
import { siteDownDetail, siteDownTitle, SITE_KUMA_IF_IGNORED, SITE_MAIL_IF_IGNORED } from './copy';

export const SITE_KEY_PREFIX = 'site:';
export type IncidentSource = 'kuma' | 'uptime_mail';
export type IncidentCloseReason = 'answered' | 'watchdog_closed' | 'mail_handled';

/** A watchdog incident counts only once it is this old (the watchdog confirms before it opens one). */
export const KUMA_MIN_AGE_MINUTES = 10;
/** An urgent mail names a site only while it is this fresh. */
export const MAIL_MAX_AGE_DAYS = 3;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const siteItemKey = (siteId: string): string => `${SITE_KEY_PREFIX}${siteId.toLowerCase()}`;

/** `site:<uuid>` to the site id, or null. */
export function parseSiteItemKey(key: unknown): string | null {
  if (typeof key !== 'string' || !key.startsWith(SITE_KEY_PREFIX)) return null;
  const id = key.slice(SITE_KEY_PREFIX.length);
  return UUID_RE.test(id) ? id : null;
}

/** A Site of an active client, as Citadel knows it. */
export interface SiteHost {
  id: string;
  /** Already normalized (normalizeHost). */
  host: string;
  client_id: string | null;
  client_name: string | null;
}

/** Ruled noise: the host belongs to a noise domain or the client is a noise client. */
export function isNoiseSite(site: Pick<SiteHost, 'host' | 'client_name'>): boolean {
  const h = site.host;
  if (NOISE_SENDER_DOMAINS.some((n) => h === n || h.endsWith(`.${n}`))) return true;
  return isNoiseClientName(site.client_name);
}

/** Sites named in the text (subject plus gist), whole host only, noise sites left out. One entry per site. */
export function matchSiteHosts(text: string | null | undefined, sites: readonly SiteHost[]): SiteHost[] {
  if (!text) return [];
  const t = text.toLowerCase().replace(/\bwww\./g, '');
  const out: SiteHost[] = [];
  const seen = new Set<string>();
  for (const s of sites) {
    if (!s.host || seen.has(s.id) || isNoiseSite(s)) continue;
    const esc = s.host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(?<![a-z0-9.-])${esc}(?![a-z0-9-])(?!\\.[a-z0-9])`).test(t)) {
      seen.add(s.id);
      out.push(s);
    }
  }
  return out;
}

/** The host of a Site.url, or ''. */
export function siteHostOf(url: string | null | undefined): string {
  return normalizeHost(url);
}

export interface IncidentRow {
  site_id: string;
  domain: string;
  client_id: string | null;
  client_name?: string | null;
  source: IncidentSource;
  ask_ids: string[];
  started_at: Date;
  last_checked_at: Date | null;
  last_check_up: boolean | null;
  closed_at: Date | null;
}

const minutesBetween = (from: Date, to: Date): number => Math.max(0, Math.floor((to.getTime() - from.getTime()) / 60_000));

/**
 * Whether an incident is a row on the screen. Never when closed. A Kuma incident only once it is at least 10 minutes
 * old. A mail incident only when Bast's own check last found the site down.
 */
export function siteIncidentShown(row: IncidentRow, now: Date): boolean {
  if (row.closed_at) return false;
  if (row.source === 'kuma') return minutesBetween(row.started_at, now) >= KUMA_MIN_AGE_MINUTES;
  return row.last_check_up === false;
}

export interface SiteDownItem {
  key: string;
  site_id: string;
  domain: string;
  client_id: string | null;
  client_name: string | null;
  source: IncidentSource;
  /** "jillscafe.com is down." */
  title: string;
  /** "Jill's Cafe · down 35 minutes · checked again 3 minutes ago" */
  detail: string;
  default_if_ignored: string;
  down_minutes: number;
  /** The mail asks behind it (the mail is linked from the row). [] for a Kuma incident. */
  ask_ids: string[];
}

/** Open incidents that are shown, as items, the longest down first. One item per site (the oldest incident wins). */
export function siteDownItems(rows: readonly IncidentRow[], now: Date): SiteDownItem[] {
  const bySite = new Map<string, IncidentRow>();
  for (const r of rows) {
    if (!siteIncidentShown(r, now)) continue;
    const cur = bySite.get(r.site_id);
    if (!cur || r.started_at < cur.started_at) bySite.set(r.site_id, r);
  }
  const items: SiteDownItem[] = [];
  for (const r of bySite.values()) {
    const down = minutesBetween(r.started_at, now);
    items.push({
      key: siteItemKey(r.site_id),
      site_id: r.site_id,
      domain: r.domain,
      client_id: r.client_id,
      client_name: r.client_name ?? null,
      source: r.source,
      title: siteDownTitle(r.domain),
      detail: siteDownDetail({
        client: r.client_name ?? null,
        downMinutes: down,
        checkedAgoMinutes: r.last_checked_at ? minutesBetween(r.last_checked_at, now) : null,
      }),
      default_if_ignored: r.source === 'kuma' ? SITE_KUMA_IF_IGNORED : SITE_MAIL_IF_IGNORED,
      down_minutes: down,
      ask_ids: r.ask_ids,
    });
  }
  return items.sort((a, b) => b.down_minutes - a.down_minutes || a.domain.localeCompare(b.domain));
}

export type CloseVerdict = { close: false } | { close: true; reason: IncidentCloseReason };

/** A mail incident closes when Bast's check finds the site up. A Kuma incident is never closed by Bast's own check. */
export function closeOnCheck(row: Pick<IncidentRow, 'source' | 'closed_at'>, up: boolean): CloseVerdict {
  if (row.closed_at || row.source !== 'uptime_mail' || !up) return { close: false };
  return { close: true, reason: 'answered' };
}

/**
 * Kuma incidents close only when the watchdog's state was read and no longer lists them. `listed` is the set of site
 * ids it lists now, or null when the state could not be read (then nothing closes).
 */
export function closeOnWatchdog(
  rows: ReadonlyArray<Pick<IncidentRow, 'site_id' | 'source' | 'closed_at'>>,
  listed: ReadonlySet<string> | null
): string[] {
  if (listed === null) return [];
  return rows.filter((r) => r.source === 'kuma' && !r.closed_at && !listed.has(r.site_id)).map((r) => r.site_id);
}

/** A mail incident whose mails have all been handled has nothing left to show. */
export function closeOnMailHandled(row: Pick<IncidentRow, 'source' | 'closed_at'>, openAskCount: number): CloseVerdict {
  if (row.closed_at || row.source !== 'uptime_mail' || openAskCount > 0) return { close: false };
  return { close: true, reason: 'mail_handled' };
}

/** Whole minutes an incident was down once closed (or so far). */
export function downMinutes(row: Pick<IncidentRow, 'started_at'>, until: Date): number {
  return minutesBetween(row.started_at, until);
}
