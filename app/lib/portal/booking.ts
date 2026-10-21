/**
 * Book a meeting (portal MVP A5).
 *
 * One generic "Book a meeting" page asks which kind of meeting, then loads the matching Calendly
 * embed. Meeting types and URLs come from this config map. Source of the URLs: the router routing
 * table (/home/mike/.openclaw/workspace/pipeline/router/config/routing-table.json). The Marketing
 * Meeting URL is real there; the other client-facing types have no usable URL yet, so they are
 * null and the page falls back to a plain email line. Each can be set without a deploy through
 * an env var (CALENDLY_URL_CONSULT, CALENDLY_URL_MARKETING, CALENDLY_URL_QUESTIONS).
 *
 * Calendly's embed is an external script. It loads only from assets.calendly.com (Calendly docs).
 * Only https calendly.com URLs are ever embedded or linked; anything else is treated as not set.
 */

export const MEETING_TYPE_KEYS = ['consult', 'marketing', 'questions'] as const;
export type MeetingTypeKey = (typeof MEETING_TYPE_KEYS)[number];

export const CALENDLY_SCRIPT_URL = 'https://assets.calendly.com/assets/external/widget.js';
export const CALENDLY_STYLE_URL = 'https://assets.calendly.com/assets/external/widget.css';
export const SUPPORT_EMAIL = 'support@becomeindelible.com';

export interface MeetingType {
  key: MeetingTypeKey;
  label: string;
  description: string;
  /** Calendly booking URL, or null when none is set yet. */
  url: string | null;
}

interface MeetingTypeConfig {
  key: MeetingTypeKey;
  label: string;
  description: string;
  envVar: string;
  /** Default URL from the router routing table; null = placeholder, not set yet. */
  defaultUrl: string | null;
}

const CONFIG: MeetingTypeConfig[] = [
  {
    key: 'consult',
    label: 'Consult',
    description: 'Talk through a new idea, a change to your site, or what to do next.',
    envVar: 'CALENDLY_URL_CONSULT',
    // Routing table has no client consult type (Intro Call is the sales lane, Discovery Meeting
    // is content collection for builds). Placeholder until Mike names one.
    defaultUrl: null,
  },
  {
    key: 'marketing',
    label: 'Marketing',
    description: 'Review content, search results and ads, and plan what comes next.',
    envVar: 'CALENDLY_URL_MARKETING',
    // routing-table.json CONTENT-MONTHLY "Marketing Meeting".
    defaultUrl: 'https://calendly.com/indelible-mike/marketing-meeting',
  },
  {
    key: 'questions',
    label: 'Questions',
    description: 'A short call to get answers about your site, your account or a request.',
    envVar: 'CALENDLY_URL_QUESTIONS',
    // routing-table.json SUPPORT "Support Call" has no booking_url.
    defaultUrl: null,
  },
];

/** True only for https URLs on calendly.com. Everything else is refused. */
export function isCalendlyUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    if (url.username || url.password) return false;
    return url.hostname === 'calendly.com' || url.hostname === 'www.calendly.com';
  } catch {
    return false;
  }
}

function resolveUrl(candidate: string | null | undefined): string | null {
  const value = (candidate ?? '').trim();
  if (!value || /placeholder/i.test(value)) return null;
  return isCalendlyUrl(value) ? value : null;
}

/** The meeting types with their resolved URLs. `env` is injectable for tests. */
export function getMeetingTypes(env: Record<string, string | undefined> = process.env): MeetingType[] {
  return CONFIG.map((c) => ({
    key: c.key,
    label: c.label,
    description: c.description,
    url: resolveUrl(env[c.envVar]) ?? resolveUrl(c.defaultUrl),
  }));
}

export function isMeetingTypeKey(value: unknown): value is MeetingTypeKey {
  return typeof value === 'string' && (MEETING_TYPE_KEYS as readonly string[]).includes(value);
}

/** Embed URL for the inline widget: the booking URL with Calendly's embed-friendly options. */
export function embedUrl(bookingUrl: string): string {
  const url = new URL(bookingUrl);
  url.searchParams.set('hide_gdpr_banner', '1');
  return url.toString();
}
