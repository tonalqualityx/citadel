import { NextRequest } from 'next/server';
import type { AuthPayload } from '@/lib/auth/middleware';

export const OWNER_ID = '3ecfb7be-0000-4000-8000-000000000001';
export const OTHER_ID = '3ecfb7be-0000-4000-8000-000000000002';
export const CONV = '11111111-1111-4111-8111-111111111111';
export const ACTION = '22222222-2222-4222-8222-222222222222';

export const OWNER_SESSION: AuthPayload = { userId: OWNER_ID, email: 'mike@example.test', role: 'admin', via: 'session' };
export const OWNER_KEY: AuthPayload = { ...OWNER_SESSION, via: 'api_key', apiKeyId: 'k1' };
export const OTHER_SESSION: AuthPayload = { userId: OTHER_ID, email: 'other@example.test', role: 'admin', via: 'session' };

export const WORKER: AuthPayload = { userId: OTHER_ID, email: 'bast@example.test', role: 'pm', via: 'api_key', apiKeyId: 'k2', lane: 'bast-chat', laneEnforced: true };
export const NOT_WORKERS: [string, AuthPayload][] = [
  ['the owner session', OWNER_SESSION],
  ['a session for the worker user', { ...WORKER, via: 'session', apiKeyId: undefined, lane: undefined, laneEnforced: undefined }],
  ['an admin key with no lane', { ...OWNER_KEY }],
  ['another lane key', { ...WORKER, lane: 'bast' }],
  ['a bast-chat key that is not enforced (lane not enforced)', { ...WORKER, laneEnforced: false }],
  ['a bast-chat key with enforce missing', { ...WORKER, laneEnforced: undefined }],
];

export function req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...headers } }),
    ...(body === undefined && Object.keys(headers).length ? { headers } : {}),
  });
}

export const ctx = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

export const SETTINGS = {
  enabled: true,
  owner_user_id: OWNER_ID,
  model: 'sonnet',
  effort: 'low',
  turn_budget_usd: 0.4,
  daily_turn_cap: 100,
  daily_write_cap: 25,
  daily_cost_cap_usd: 8,
  stale_after_minutes: 120,
  idle_close_minutes: 10,
};
