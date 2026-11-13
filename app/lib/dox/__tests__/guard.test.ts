import { describe, it, expect } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import {
  DOX_PROJECT_HEADER,
  checkCreateTags,
  doxProjectOf,
  guardDoxComment,
  guardDoxProjectCreate,
  guardDoxProjectPatch,
  guardDoxSnapshotRead,
  guardDoxTaskCreate,
  guardDoxTaskPatch,
  guardDoxTaskWrite,
  guardDoxWaitCreate,
  guardDoxWaitPatch,
  isDoxLane,
  mayReadSnapshot,
  requireObject,
} from '../guard';
import { authorLabel, isDoxLaneValue } from '../identity';

// The rules that need the database (the project in play, the open pass, assignees, hold state) are covered through the real routes in
// dox.integration.test.ts and dox-escapes.integration.test.ts. This file holds the pure parts.
const P = '7f1c0000-0000-4000-8000-000000000001';
const CARD = '7f1c0000-0000-4000-8000-000000000009';
const BAST = { lane: 'bast' };
const hdr = (p?: string): Pick<Headers, 'get'> => ({ get: (n: string) => (n.toLowerCase() === DOX_PROJECT_HEADER && p ? p : null) });
const status = (fn: () => unknown): { status: number; code: string | null } | null => {
  try {
    fn();
    return null;
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    return { status: (e as ApiError).statusCode, code: (e as ApiError).code ?? null };
  }
};

describe('Dox identity', () => {
  it('shows Dox as the author of the Dox lane and the user name for anyone else', () => {
    expect(authorLabel('dox', 'Bast')).toBe('Dox');
    expect(authorLabel('bast', 'Bast')).toBe('Bast');
    expect(authorLabel(null, 'Sabeen')).toBe('Sabeen');
    expect(authorLabel(null, null)).toBe('Unknown');
    expect(isDoxLaneValue('bast,dox')).toBe(true);
    expect(isDoxLaneValue('doxx')).toBe(false);
  });
});

describe('Dox guard: every function is a no-op for another caller', () => {
  it('returns bodies untouched and never throws for non-Dox lanes', async () => {
    const body = { title: 'x', status: 'triage', anything: 1 };
    expect(await guardDoxTaskCreate(BAST, hdr(), body)).toBe(body);
    expect(await guardDoxTaskPatch(BAST, hdr(), body, { status: 'x', project_id: P, tags: [] })).toBe(body);
    await expect(guardDoxProjectPatch({}, hdr(), { status: 'cancelled' }, { id: P, status: 'x', open_task_count: 0, done_task_count: 0, total_task_count: 0 })).resolves.toBeUndefined();
    await expect(guardDoxWaitCreate(BAST, hdr(), { template_key: 'charter.price_review' })).resolves.toBeUndefined();
    await expect(guardDoxWaitPatch(BAST, hdr(), P, { action: 'resolve', resolution: 'sent' })).resolves.toBeUndefined();
    await expect(guardDoxTaskWrite(BAST, hdr(), { status: 'not_started', project_id: P })).resolves.toBeUndefined();
    await expect(guardDoxSnapshotRead(BAST, P)).resolves.toBeUndefined();
    expect(await guardDoxProjectCreate(BAST, hdr(), null)).toBeNull();
    expect(guardDoxComment(BAST, { client_visible: true })).toBeNull();
    expect(isDoxLane(BAST)).toBe(false);
  });
  it('a key carrying two lanes is still the Dox lane (no === on the lane string)', () => {
    expect(isDoxLane({ lane: 'dox' })).toBe(true);
    expect(isDoxLane({ lane: 'bast,dox' })).toBe(true);
    expect(isDoxLane({ lane: 'dox,bast-chat' })).toBe(true);
    expect(isDoxLane({ lane: 'doxx' })).toBe(false);
    expect(isDoxLane({})).toBe(false);
  });
});

describe('Dox guard: pure checks', () => {
  it('a null, list or bare body is a 400, never a crash', async () => {
    for (const v of [null, [], 'x', 3, undefined]) {
      expect(status(() => requireObject(v))).toEqual({ status: 400, code: 'dox_bad_body' });
    }
    const dox = { lane: 'dox' };
    await expect(guardDoxTaskCreate(dox, hdr(P), null)).rejects.toMatchObject({ statusCode: 400 });
    await expect(guardDoxTaskPatch(dox, hdr(P), null, { status: 'not_started', project_id: P, tags: [] })).rejects.toMatchObject({ statusCode: 400 });
    await expect(guardDoxProjectPatch(dox, hdr(P), null, { id: P, status: 'ready', open_task_count: 0, done_task_count: 0, total_task_count: 0 })).rejects.toMatchObject({ statusCode: 400 });
    await expect(guardDoxProjectCreate(dox, hdr(P), null)).rejects.toMatchObject({ statusCode: 400 });
  });
  it('created tasks may carry only from-dox and setup:<card id>', () => {
    expect(checkCreateTags(undefined)).toEqual([]);
    expect(checkCreateTags(['from-dox', `setup:${CARD}`, 'from-dox'])).toEqual(['from-dox', `setup:${CARD}`]);
    for (const bad of ['kickoff', 'needs-mike', 'client-approved', 'security', 'setup:not-an-id', 'setup:', 'From-Dox']) {
      expect(status(() => checkCreateTags(['from-dox', bad])), bad).toEqual({ status: 403, code: 'dox_tag_closed' });
    }
    expect(status(() => checkCreateTags('kickoff'))?.status).toBe(400);
  });
  it('a comment is internal; a client-visible one or a client question is refused', () => {
    expect(guardDoxComment({ lane: 'dox' }, {})).toEqual({ is_internal: true });
    expect(status(() => guardDoxComment({ lane: 'dox' }, { client_visible: true }))?.code).toBe('dox_client_closed');
    expect(status(() => guardDoxComment({ lane: 'dox' }, { client_question: true }))?.code).toBe('dox_client_closed');
  });
  it('the snapshot is for the Dox lane or the owner session, not another key', () => {
    const owner = 'owner-1';
    expect(mayReadSnapshot({ lane: 'dox', via: 'api_key', userId: 'bot', role: 'pm' }, owner)).toBe(true);
    expect(mayReadSnapshot({ lane: 'bast,dox', via: 'api_key', userId: 'bot', role: 'pm' }, owner)).toBe(true);
    expect(mayReadSnapshot({ via: 'session', userId: owner, role: 'admin' }, owner)).toBe(true);
    expect(mayReadSnapshot({ via: 'session', userId: 'other', role: 'admin' }, owner)).toBe(false);
    expect(mayReadSnapshot({ via: 'api_key', userId: owner, role: 'admin' }, owner)).toBe(false);
    expect(mayReadSnapshot({ lane: 'bast', via: 'api_key', userId: 'bot', role: 'pm' }, owner)).toBe(false);
  });
  it('reads the project header only when it is an id', () => {
    expect(doxProjectOf(hdr(P))).toBe(P);
    expect(doxProjectOf(hdr('not-an-id'))).toBeNull();
    expect(doxProjectOf(hdr())).toBeNull();
  });
});
