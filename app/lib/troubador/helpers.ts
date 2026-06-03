// Shared constants + helpers for the Troubador control plane.
import type { TokenPayload } from '@/lib/auth/jwt';

// The Bast-machine worker authenticates as this service user (seeded separately).
// Used to enforce "Troubador never sets approved" and "worker can't touch locked copy".
export const TROUBADOR_SERVICE_EMAIL = 'troubador@indelible.bot';

// How long a claim/lease holds before another worker tick may steal it.
export const LEASE_MINUTES = 15;

export function isTroubadorBot(auth: { email?: string } | TokenPayload | null | undefined): boolean {
  return !!auth?.email && auth.email.toLowerCase() === TROUBADOR_SERVICE_EMAIL;
}

// A lease is active if claimed within the last LEASE_MINUTES.
export function isLeaseActive(claimedAt: Date | null | undefined, now: Date = new Date()): boolean {
  if (!claimedAt) return false;
  return now.getTime() - new Date(claimedAt).getTime() < LEASE_MINUTES * 60_000;
}

// Slugify a topic title into a stable, URL-safe article slug.
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'article';
}

// Make a slug unique within an existing set of slugs (append -2, -3, ...).
export function uniqueSlug(base: string, existing: Set<string>): string {
  if (!existing.has(base)) return base;
  let i = 2;
  while (existing.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

// Normalize a date to its UTC calendar day (for same-site same-day collision checks).
export function utcDayKey(d: Date | string): string {
  const date = new Date(d);
  return `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}`;
}
