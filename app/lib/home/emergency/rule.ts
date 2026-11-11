/**
 * Home screen Slice 6a: "Not an emergency" rules, the pure part.
 *
 * A rule hides a later outside signal from Needs you now. It never covers a task (SOUL: a security flag is never
 * downplayed), and the sender or domain of mail is matched exactly (no subdomain guessing, so a rule hides less, not
 * more). The Decision key is `home-not-emergency:<kind>:<value>`.
 *
 * Pure: no I/O, no Prisma.
 */

import { emailDomain, isOwnAddress, OWN_ADDRESSES } from '../rules';
import { scopeLabelDomain, scopeLabelSender, scopeLabelSite } from './copy';

export type RuleKind = 'sender' | 'domain' | 'site';
export const RULE_KINDS: readonly RuleKind[] = ['sender', 'domain', 'site'];

export const RULE_KEY_PREFIX = 'home-not-emergency:';
export const RULE_LANE = 'home-emergency';
export const RULE_TAGS = ['home-screen', 'not-emergency'] as const;
/** Decision.key is VarChar(200). */
export const RULE_KEY_MAX = 200;
/** How long Undo works on a saved rule. */
export const RULE_UNDO_DAYS = 7;

/** Domains a rule for "anyone at" is never offered for: free mail providers. */
export const FREE_MAIL_DOMAINS: readonly string[] = [
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'ymail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'aol.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'proton.me',
  'protonmail.com',
  'pm.me',
  'gmx.com',
  'gmx.net',
  'mail.com',
  'zoho.com',
  'fastmail.com',
  'comcast.net',
  'verizon.net',
  'att.net',
  'sbcglobal.net',
  'bellsouth.net',
  'cox.net',
  'charter.net',
  'earthlink.net',
  'yahoo.co.uk',
  'hotmail.co.uk',
];

/** Our own domains (from the own addresses), a rule for "anyone at" is never offered for them. */
export const OWN_DOMAINS: readonly string[] = Array.from(new Set(OWN_ADDRESSES.map((a) => emailDomain(a))));

export function isFreeMailDomain(domain: string): boolean {
  const d = domain.trim().toLowerCase();
  return FREE_MAIL_DOMAINS.includes(d);
}
export function isOwnDomain(domain: string): boolean {
  const d = domain.trim().toLowerCase();
  return OWN_DOMAINS.some((o) => d === o || d.endsWith(`.${o}`));
}
/** A domain a domain rule may cover. */
export function domainRuleAllowed(domain: string): boolean {
  const d = domain.trim().toLowerCase();
  return d !== '' && d.includes('.') && !isFreeMailDomain(d) && !isOwnDomain(d);
}

/** What a rule can look at. Built by the caller from the record behind the item. */
export type RuleItem =
  | { kind: 'crisis'; from_email: string | null }
  | { kind: 'site'; host: string }
  | { kind: 'task' | 'wait' | 'session' | 'review' | 'thread' };

export interface RuleScope {
  scope: RuleKind;
  value: string;
  label: string;
}

export interface NotEmergencyRule {
  kind: RuleKind;
  value: string;
}

/** Lowercase, no scheme, path, port, credentials or leading "www.". '' when nothing usable is left. */
export function normalizeHost(raw: string | null | undefined): string {
  if (!raw) return '';
  let h = raw.trim().toLowerCase();
  h = h.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  h = h.replace(/[/?#].*$/, '');
  h = h.replace(/^.*@/, '');
  h = h.replace(/:\d+$/, '');
  h = h.replace(/\.$/, '');
  h = h.replace(/^www\./, '');
  return /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(h) && h.includes('.') ? h : '';
}

function cleanAddress(raw: string | null | undefined): string {
  const e = (raw ?? '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : '';
}

/** The choices the screen offers for an item. Tasks, waits, sessions and sign-offs get none. */
export function ruleScopesFor(item: RuleItem): RuleScope[] {
  if (item.kind === 'site') {
    const host = normalizeHost(item.host);
    return host ? [{ scope: 'site', value: host, label: scopeLabelSite(host) }] : [];
  }
  if (item.kind === 'crisis') {
    const address = cleanAddress(item.from_email);
    if (!address) return [];
    const out: RuleScope[] = [];
    if (!isOwnAddress(address)) out.push({ scope: 'sender', value: address, label: scopeLabelSender(address) });
    const domain = emailDomain(address);
    if (domainRuleAllowed(domain)) out.push({ scope: 'domain', value: domain, label: scopeLabelDomain(domain) });
    return out;
  }
  return [];
}

/** The Decision key for a rule, or null when it would not fit the column. */
export function ruleKey(kind: RuleKind, value: string): string | null {
  const key = `${RULE_KEY_PREFIX}${kind}:${value}`;
  return key.length <= RULE_KEY_MAX ? key : null;
}

/** Parse a Decision key back into a rule, or null when it is not one of ours. */
export function parseRuleKey(key: string | null | undefined): NotEmergencyRule | null {
  if (!key || !key.startsWith(RULE_KEY_PREFIX)) return null;
  const rest = key.slice(RULE_KEY_PREFIX.length);
  const colon = rest.indexOf(':');
  if (colon <= 0) return null;
  const kind = rest.slice(0, colon) as RuleKind;
  const value = rest.slice(colon + 1);
  if (!RULE_KINDS.includes(kind) || !value) return null;
  return { kind, value };
}

/**
 * Whether any rule covers the item. A sender rule matches the exact address, a domain rule the exact domain, a site
 * rule the exact site host. A rule never matches a task, wait, session or review.
 */
export function matchesNotEmergencyRule(item: RuleItem, rules: readonly NotEmergencyRule[]): boolean {
  if (item.kind === 'crisis') {
    const address = cleanAddress(item.from_email);
    if (!address) return false;
    const domain = emailDomain(address);
    return rules.some((r) => (r.kind === 'sender' && r.value === address) || (r.kind === 'domain' && r.value === domain));
  }
  if (item.kind === 'site') {
    const host = normalizeHost(item.host);
    return host !== '' && rules.some((r) => r.kind === 'site' && r.value === host);
  }
  return false;
}
