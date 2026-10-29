import { NextRequest } from 'next/server';
import { DESIGN_WORKER_SERVICE_EMAIL } from '@/lib/design/helpers';
import type { AuthPayload } from '@/lib/auth/middleware';

/** The daemon: service email + lane key. */
export const WORKER: AuthPayload = { userId: '00000000-0000-4000-8000-000000000001', email: DESIGN_WORKER_SERVICE_EMAIL, role: 'tech', via: 'api_key', apiKeyId: 'k1', lane: 'design-worker' };
/** A session cookie for the worker user (no lane). */
export const WORKER_SESSION: AuthPayload = { ...WORKER, via: 'session', apiKeyId: undefined, lane: undefined };
/** A non-lane key minted for the worker user. */
export const WORKER_NON_LANE_KEY: AuthPayload = { ...WORKER, lane: undefined };
/** A lane key of another lane, even with the worker email. */
export const WORKER_WRONG_LANE: AuthPayload = { ...WORKER, lane: 'bast' };
export const ADMIN_KEY: AuthPayload = { userId: '00000000-0000-4000-8000-000000000002', email: 'admin@example.test', role: 'admin', via: 'api_key', apiKeyId: 'k2' };
export const ADMIN_SESSION: AuthPayload = { ...ADMIN_KEY, via: 'session', apiKeyId: undefined };

export const NOT_WORKERS: [string, AuthPayload][] = [
  ['an admin key', ADMIN_KEY],
  ['an admin session', ADMIN_SESSION],
  ['a session cookie for the worker user', WORKER_SESSION],
  ['a non-lane key for the worker user', WORKER_NON_LANE_KEY],
  ['another lane key with the worker email', WORKER_WRONG_LANE],
];

export function req(method: string, path: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
  });
}

export const ctx = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
