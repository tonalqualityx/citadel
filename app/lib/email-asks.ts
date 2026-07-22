// Clarity Phase 4a — email on the Seeing Stone. Pure, dependency-free helpers so subject
// normalization, the due-soon window math (incl. the 8pm-boundary TZ trap that bit the
// Phase 3 seed fixtures during Phase 4a's own baselining — see
// scripts/seed-clarity-phase3-fixtures.ts's header note), and client-domain matching are
// unit-testable without a DB or Next.js request/response.

const REPLY_FORWARD_PREFIX_RE = /^\s*(re|fwd|fw)\s*:\s*/i;

/**
 * Strips a leading Re:/Fwd:/FW: prefix (repeated, case-insensitive) for use as a Task
 * title, per the create-task endpoint's "title from subject (prefix stripped of Re:/Fwd:)"
 * spec. Strips repeatedly so "Re: Fwd: Re: Site down" -> "Site down", not "Fwd: Re: Site
 * down". Leaves the subject untouched (including empty) if there's no such prefix.
 */
export function stripSubjectPrefix(subject: string): string {
  let result = subject;
  let prev: string;
  do {
    prev = result;
    result = result.replace(REPLY_FORWARD_PREFIX_RE, '');
  } while (result !== prev);
  return result.trim();
}

/**
 * A rolling 24-real-hours-from-now window (`now` to `now + windowHours`), NOT a
 * calendar-day boundary — deliberately timezone-agnostic real-time math, so it's immune
 * to the class of bug the Phase 3 seed-fixture UTC-vs-ET mismatch was (see this file's
 * header note): a task due at 11:30pm ET is correctly "due soon" starting 24h before that
 * instant, never mis-bucketed by which calendar day 11:30pm ET happens to fall on in UTC.
 */
export function isDueSoon(dueDate: Date, now: Date, windowHours: number = 24): boolean {
  const windowEnd = now.getTime() + windowHours * 60 * 60 * 1000;
  return dueDate.getTime() >= now.getTime() && dueDate.getTime() <= windowEnd;
}

/** Lowercased domain half of an email address, or null if it doesn't look like one. */
export function extractEmailDomain(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at === -1 || at === email.length - 1) return null;
  return email.slice(at + 1).trim().toLowerCase();
}

export interface DomainMatchClient {
  id: string;
  email: string | null;
}

/**
 * Matches a sender's email domain against a list of clients' Client.email domains — the
 * create-task endpoint's "client matched by from_email domain vs Client.email domains
 * (null if no match)" rule. First match wins (caller controls ordering); returns null if
 * from_email doesn't parse as an email, no client has a usable email, or nothing matches.
 */
export function matchClientByEmailDomain(
  fromEmail: string,
  clients: DomainMatchClient[]
): string | null {
  const senderDomain = extractEmailDomain(fromEmail);
  if (!senderDomain) return null;

  for (const client of clients) {
    if (!client.email) continue;
    const clientDomain = extractEmailDomain(client.email);
    if (clientDomain && clientDomain === senderDomain) {
      return client.id;
    }
  }
  return null;
}
