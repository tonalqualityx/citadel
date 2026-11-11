/**
 * Home screen Slice 10a: which links in an invite may be followed. Only https, no user or
 * password in the address, and (outside Google's own meet_url) only a known meeting host.
 * Event text is untrusted: nothing here builds HTML.
 */

import { MEETING_HOSTS } from './rules';

export interface JoinLink {
  href: string;
  /** "Join on Zoom", or "Join the call" when the host has no name of its own. */
  label: string;
}

/** A parsed https address with no user or password, or null. */
export function parseHttps(raw: string | null | undefined): URL | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password || !u.hostname) return null;
  return u;
}

export function isMeetingHost(host: string): boolean {
  const h = host.toLowerCase();
  return MEETING_HOSTS.some((m) => h === m || h.endsWith(`.${m}`));
}

/** The name of the service for a host, or null. */
export function serviceName(host: string): string | null {
  const h = host.toLowerCase();
  const is = (m: string) => h === m || h.endsWith(`.${m}`);
  if (is('meet.google.com')) return 'Google Meet';
  if (is('zoom.us')) return 'Zoom';
  if (is('teams.microsoft.com') || is('teams.live.com')) return 'Teams';
  if (is('webex.com')) return 'Webex';
  if (is('whereby.com')) return 'Whereby';
  return null;
}

export function joinLabel(host: string): string {
  const s = serviceName(host);
  return s ? `Join on ${s}` : 'Join the call';
}

/** Every https address in a piece of text (tags and entities already handled by the caller), in order. */
export function urlsIn(text: string | null | undefined): string[] {
  if (!text) return [];
  const found = text.match(/https?:\/\/[^\s<>"'`]+/gi) ?? [];
  return found.map((u) => u.replace(/[.,;:!?)\]}]+$/, ''));
}

function decodeBasic(s: string): string {
  return s.replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;/g, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>');
}

/** Links in free text that pass the host test, in order, without repeats. */
export function meetingLinksIn(text: string | null | undefined): JoinLink[] {
  const out: JoinLink[] = [];
  const seen = new Set<string>();
  for (const raw of urlsIn(decodeBasic(text ?? ''))) {
    const u = parseHttps(raw);
    if (!u || !isMeetingHost(u.hostname) || seen.has(u.href)) continue;
    seen.add(u.href);
    out.push({ href: u.href, label: joinLabel(u.hostname) });
  }
  return out;
}

/** The meet_url when it is a safe https address, else the first meeting link in the location, then the description. */
export function pickJoin(ev: { meet_url: string | null; location: string | null; description: string | null }): JoinLink | null {
  const direct = parseHttps(ev.meet_url);
  if (direct) return { href: direct.href, label: joinLabel(direct.hostname) };
  return meetingLinksIn(ev.location)[0] ?? meetingLinksIn(ev.description)[0] ?? null;
}
