// @vitest-environment node
/**
 * POST /api/tasks/:id/triage/release against a real scratch Postgres: the front session's key releases a Triage card only with Mike's quoted
 * words and where and when he said them; Citadel records them on the card; any other caller, and any request without the words, changes nothing.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';

vi.mock('@/lib/auth/middleware', async (orig) => ({
  ...(await orig<typeof import('@/lib/auth/middleware')>()),
  requireAuth: vi.fn(),
}));

import { prisma } from '@/lib/db/prisma';
import { requireAuth, type AuthPayload } from '@/lib/auth/middleware';
import { SCRATCH } from '@/lib/engine/__tests__/seed';
import { BAST_USER_ID, MIKE_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { DOX_USER_ID } from '@/lib/dox/identity';
import { runHomeUndo } from '@/lib/home/act';
import { loadCards } from '@/lib/tasks/triage-card';
import { patchTask } from '@/lib/services/task-patch';
import { recordWords, releaseOnMikesWords } from '@/lib/front-session/release';
import { POST } from '../route';
import { PATCH as patchTriage } from '../../route';

const authMock = requireAuth as Mock;
const params = (id: string) => ({ params: Promise.resolve({ id }) });
/** The Undo lines on Mike's home screen this suite's releases wrote; teardown deletes these and nothing else. */
const actionIds: string[] = [];
const post = async (id: string, body: unknown) => {
  const res = await POST(new NextRequest(new URL(`http://localhost/api/tasks/${id}/triage/release`), { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) } as never), params(id));
  if (res.status === 200) actionIds.push((await res.clone().json()).release.action_id);
  return res;
};

describe.skipIf(!SCRATCH)('front session release on Mike\'s words (real database)', () => {
  const tag = `fsr${Date.now()}`;
  const ids: string[] = [];
  let otherId: string;

  const front = (): AuthPayload => ({ userId: BAST_USER_ID, role: 'pm', email: 'bast@test', via: 'api_key', apiKeyId: 'kf', lane: 'front-session', laneEnforced: true });
  const WORDS = { mike_words: 'This is great. Let\'s release it', said_where: 'Claude app, front session', said_at: new Date(Date.now() - 60_000).toISOString() };
  const row = (id: string) => prisma.task.findUniqueOrThrow({ where: { id } });
  const mk = async (title: string, data: Record<string, unknown> = {}) => {
    const t = await prisma.task.create({ data: { title: `${tag} ${title}`, status: 'triage', triage_kind: 'task', tags: ['keep-me'], ...data } as never });
    ids.push(t.id);
    return t.id;
  };
  const comments = (id: string) => prisma.comment.findMany({ where: { task_id: id }, orderBy: { created_at: 'asc' } });

  beforeAll(async () => {
    await prisma.user.upsert({ where: { id: MIKE_USER_ID }, update: {}, create: { id: MIKE_USER_ID, email: `mike-${tag}@example.test`, password_hash: 'x', name: 'Mike', role: 'admin' } });
    await prisma.user.upsert({ where: { id: BAST_USER_ID }, update: {}, create: { id: BAST_USER_ID, email: `bast-${tag}@example.test`, password_hash: 'x', name: 'Bast', role: 'pm' } });
    otherId = (await prisma.user.create({ data: { email: `oth-${tag}@example.test`, password_hash: 'x', name: 'Other', role: 'admin' } })).id;
  });
  afterAll(async () => {
    await prisma.homeAction.deleteMany({ where: { id: { in: actionIds } } });
    await prisma.triageChange.deleteMany({ where: { task_id: { in: ids } } });
    await prisma.comment.deleteMany({ where: { task_id: { in: ids } } });
    await prisma.activityLog.deleteMany({ where: { entity_id: { in: ids } } });
    await prisma.task.deleteMany({ where: { id: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: otherId } });
    await prisma.$disconnect();
  });

  it('releases the card as the Release tap does and records Mike\'s words, where and when on the card', async () => {
    const id = await mk('release me');
    authMock.mockResolvedValue(front());
    const res = await post(id, WORDS);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.release.ok).toBe(true);
    const after = await row(id);
    expect(after.status).toBe('not_started');
    expect(after.assignee_id).toBe(DOX_USER_ID); // a sorted release hands the card to Dox, as the tap does
    expect(after.tags).toEqual(expect.arrayContaining(['keep-me', 'from-triage']));
    const [c] = await comments(id);
    expect(c.id).toBe(body.comment_id);
    expect(c.content).toContain(`"${WORDS.mike_words}"`);
    expect(c.content).toContain(WORDS.said_where);
    expect(c.content).toContain(new Date(WORDS.said_at).toISOString());
    expect([c.is_internal, c.client_visible, c.actor_lane, c.user_id]).toEqual([true, false, 'front-session', BAST_USER_ID]);
    const line = await prisma.triageChange.findFirstOrThrow({ where: { task_id: id, area: 'release' } });
    expect(line.line).toBe("Released by the front session on Mike's words");
    expect(line.by_lane).toBe('front-session');
    // Mike's 72 hour Undo covers it, like any release from his home screen.
    await runHomeUndo(prisma, MIKE_USER_ID, body.release.action_id, new Date(Date.now() + 60_000));
    expect((await row(id)).status).toBe('triage');
  });

  it('an unsorted card the front session filed: refused as not sorted, then the front session sorts it and it releases on Mike\'s words', async () => {
    // Filed by the front session (Mike's own key files it, as create-task.py does) with no kind, as card 338356dc arrived on 2026-11-24.
    const id = await mk('unsorted from the front session', { triage_kind: null, created_by_id: MIKE_USER_ID });
    authMock.mockResolvedValue(front());
    const refused = await post(id, WORDS);
    expect(refused.status).toBe(409);
    expect((await refused.json()).code).toBe('not_sorted');
    expect((await row(id)).status).toBe('triage');
    expect(await comments(id)).toHaveLength(0); // the request was taken back out
    // release.py --kind: the same key sorts the card, then releases it
    const sorted = await patchTriage(new NextRequest(new URL(`http://localhost/api/tasks/${id}/triage`), { method: 'PATCH', body: JSON.stringify({ kind: 'project_setup' }) } as never), params(id));
    expect(sorted.status).toBe(200);
    expect(await sorted.json()).toMatchObject({ kind: 'project_setup', release_ready: true });
    const res = await post(id, WORDS);
    expect(res.status).toBe(200);
    const after = await row(id);
    // a project card with no project goes to Dox, who creates the project from it
    expect(after.status).toBe('not_started');
    expect(after.project_id).toBeNull();
    expect(after.assignee_id).toBe(DOX_USER_ID);
    expect(after.tags).toEqual(expect.arrayContaining(['keep-me', 'kickoff', 'from-triage']));
    const [c] = await comments(id);
    expect(c.content).toContain(`"${WORDS.mike_words}"`);
    expect(c.content).toMatch(/^Released from Triage by the front session/);
    const kindLine = await prisma.triageChange.findFirstOrThrow({ where: { task_id: id, area: 'card' } });
    expect(kindLine.line).toBe('Kind set by the front session');
  });

  it('refuses a request without Mike\'s words, without where or when, with empty words or a future time; nothing changes', async () => {
    const id = await mk('no words');
    authMock.mockResolvedValue(front());
    const bad: unknown[] = [
      {},
      { said_where: WORDS.said_where, said_at: WORDS.said_at },
      { ...WORDS, mike_words: '   ' },
      { mike_words: WORDS.mike_words, said_at: WORDS.said_at },
      { mike_words: WORDS.mike_words, said_where: WORDS.said_where },
      { ...WORDS, said_where: '' },
      { ...WORDS, said_at: 'yesterday' },
      { ...WORDS, said_at: new Date(Date.now() + 3600_000).toISOString() },
      { ...WORDS, said_at: new Date(Date.now() + 6 * 60_000).toISOString() }, // past the five minute clock-skew allowance
      { ...WORDS, extra: 'field' },
      'not json',
    ];
    for (const b of bad) {
      const res = await post(id, b);
      expect(res.status, JSON.stringify(b)).toBe(400);
    }
    expect((await row(id)).status).toBe('triage');
    expect(await comments(id)).toHaveLength(0);
  });

  it('refuses every other caller (Mike signed in, his own key, the chat lane, the triage desk, the worker lane, a shadow front-session key, another admin); nothing changes', async () => {
    const id = await mk('not yours');
    const others: AuthPayload[] = [
      { userId: MIKE_USER_ID, role: 'admin', email: 'mike@test', via: 'session' },
      { userId: MIKE_USER_ID, role: 'admin', email: 'mike@test', via: 'api_key', apiKeyId: 'k0' },
      { userId: BAST_USER_ID, role: 'pm', email: 'bast@test', via: 'api_key', apiKeyId: 'k3', lane: 'bast-chat', laneEnforced: true },
      { userId: BAST_USER_ID, role: 'pm', email: 'bast@test', via: 'api_key', apiKeyId: 'k4', lane: 'triage-desk', laneEnforced: true },
      { userId: BAST_USER_ID, role: 'pm', email: 'bast@test', via: 'api_key', apiKeyId: 'k5', lane: 'bast', laneEnforced: true },
      { userId: BAST_USER_ID, role: 'pm', email: 'bast@test', via: 'api_key', apiKeyId: 'k6', lane: 'front-session', laneEnforced: false },
      { userId: BAST_USER_ID, role: 'pm', email: 'bast@test', via: 'session', lane: 'front-session', laneEnforced: true },
      { userId: otherId, role: 'admin', email: 'o@test', via: 'session' },
      // the same enforced scope on a key that is not Bast's (the lane is minted for Bast only)
      { userId: otherId, role: 'admin', email: 'o@test', via: 'api_key', apiKeyId: 'k7', lane: 'front-session', laneEnforced: true },
      { userId: MIKE_USER_ID, role: 'admin', email: 'mike@test', via: 'api_key', apiKeyId: 'k8', lane: 'front-session', laneEnforced: true },
    ];
    for (const a of others) {
      authMock.mockResolvedValue(a);
      const res = await post(id, WORDS);
      expect(res.status, JSON.stringify(a)).toBe(403);
      expect((await res.json()).code).toBe('front_session_only');
    }
    expect((await row(id)).status).toBe('triage');
    expect(await comments(id)).toHaveLength(0);
  });

  it('allows a said_at up to five minutes ahead of the server clock (clock skew)', async () => {
    const id = await mk('skew');
    authMock.mockResolvedValue(front());
    const res = await post(id, { ...WORDS, said_at: new Date(Date.now() + 4 * 60_000).toISOString() });
    expect(res.status).toBe(200);
    expect((await row(id)).status).toBe('not_started');
  });

  it('his words are on the card before it moves: when they cannot be written, the card never leaves Triage', async () => {
    const id = await mk('record fails');
    const failing = async () => {
      throw new Error('record write failed');
    };
    await expect(releaseOnMikesWords(prisma, front(), id, WORDS, new Date(), { record: failing })).rejects.toThrow('record write failed');
    const after = await row(id);
    expect(after.status).toBe('triage');
    expect(after.tags).toEqual(['keep-me']);
    expect(await comments(id)).toHaveLength(0);
    // and the card can then be released normally
    authMock.mockResolvedValue(front());
    expect((await post(id, WORDS)).status).toBe(200);
  });

  it('a release that fails after the card moved keeps his words on the card, worded as a failed request, never as a release', async () => {
    const id = await mk('fails after move');
    const movesThenFails = async () => {
      await prisma.task.update({ where: { id }, data: { status: 'not_started' } });
      throw new Error('later write failed');
    };
    await expect(releaseOnMikesWords(prisma, front(), id, WORDS, new Date(), { release: movesThenFails as never })).rejects.toThrow('later write failed');
    expect((await row(id)).status).toBe('not_started');
    const kept = await comments(id);
    expect(kept).toHaveLength(1);
    expect(kept[0].content).toContain(`"${WORDS.mike_words}"`);
    expect(kept[0].content).toContain('that request returned an error (error)');
    expect(kept[0].content).toContain('this request or another release moved it');
    expect(kept[0].content).not.toContain('Released from Triage');
  });

  it('when the final rewording of the comment fails, what stays on the card is the request wording, which is still true', async () => {
    const failFinish = async () => {
      throw new Error('comment update failed');
    };
    // the release went through, the rewording to "Released" failed
    const ok = await mk('finish fails after release');
    const res = await releaseOnMikesWords(prisma, front(), ok, WORDS, new Date(), { finish: failFinish });
    actionIds.push(res.release.action_id);
    expect((await row(ok)).status).toBe('not_started');
    const [a] = await comments(ok);
    expect(a.content.startsWith("The front session asked to release this card from Triage on Mike's words.")).toBe(true);
    expect(a.content).toContain(`"${WORDS.mike_words}"`);
    // the release failed after a move, and the rewording to the failed text also failed
    const moved = await mk('finish fails after failed release');
    const movesThenFails = async () => {
      await prisma.task.update({ where: { id: moved }, data: { status: 'not_started' } });
      throw new Error('later write failed');
    };
    await expect(releaseOnMikesWords(prisma, front(), moved, WORDS, new Date(), { release: movesThenFails as never, finish: failFinish })).rejects.toThrow('later write failed');
    const [b] = await comments(moved);
    expect(b.content.startsWith("The front session asked to release this card from Triage on Mike's words.")).toBe(true);
    expect(b.content).not.toContain('Released from Triage');
  });

  it('two releases of the same card at once: one wins, and only the winner leaves a release record', async () => {
    const id = await mk('race');
    authMock.mockResolvedValue(front());
    const results = await Promise.all([post(id, WORDS), post(id, { ...WORDS, mike_words: 'Release that one too' })]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses[0]).toBe(200);
    expect(statuses[1]).not.toBe(200);
    expect((await row(id)).status).toBe('not_started');
    const all = await comments(id);
    expect(all.filter((c) => c.content.startsWith('Released from Triage'))).toHaveLength(1);
    // the loser's words are either gone (it failed before or while still in Triage) or kept as a failed request
    for (const c of all.filter((x) => !x.content.startsWith('Released from Triage'))) expect(c.content).toContain('that request returned an error');
  });

  it('a release that fails with the card still in Triage takes the record back out', async () => {
    const id = await mk('fails before move');
    const fails = async () => {
      throw new Error('refused');
    };
    await expect(releaseOnMikesWords(prisma, front(), id, WORDS, new Date(), { release: fails as never })).rejects.toThrow('refused');
    expect((await row(id)).status).toBe('triage');
    expect(await comments(id)).toHaveLength(0);
  });

  it('the record is already on the card when the release runs', async () => {
    const id = await mk('record first');
    let seenStatus: string | null = null;
    let seenContent: string | null = null;
    const spy = async (db: typeof prisma, taskId: string, auth: AuthPayload, input: Parameters<typeof recordWords>[3]) => {
      const c = await recordWords(db, taskId, auth, input);
      seenStatus = (await row(taskId)).status;
      seenContent = (await comments(taskId))[0].content;
      return c;
    };
    const res = await releaseOnMikesWords(prisma, front(), id, WORDS, new Date(), { record: spy });
    actionIds.push(res.release.action_id);
    expect(seenStatus).toBe('triage');
    // before the move it reads as a request; after the confirmed move, as the release
    expect(seenContent).toMatch(/^The front session asked to release this card/);
    expect((await row(id)).status).toBe('not_started');
    const after = await comments(id);
    expect(after.map((c) => c.id)).toEqual([res.comment_id]);
    expect(after[0].content).toMatch(/^Released from Triage by the front session/);
  });

  it('the front-session key still cannot move a card out of Triage through the task PATCH path', async () => {
    const id = await mk('patch path');
    await expect(patchTask({ actor: front(), id, body: { status: 'not_started' } })).rejects.toMatchObject({ statusCode: 403, code: 'triage_exit_forbidden' });
    expect((await row(id)).status).toBe('triage');
  });

  it('answers as the Release tap does: 404 off Triage, 409 for an unsorted card or a stale release_version; the record written first is taken back out', async () => {
    authMock.mockResolvedValue(front());
    const done = await mk('already out', { status: 'not_started' });
    expect((await post(done, WORDS)).status).toBe(404);
    expect((await post('not-a-uuid', WORDS)).status).toBe(404);
    const unsorted = await mk('unsorted', { triage_kind: null });
    const r1 = await post(unsorted, WORDS);
    expect(r1.status).toBe(409);
    expect((await r1.json()).code).toBe('not_sorted');
    const stale = await mk('stale');
    const version = (await loadCards(prisma, [stale]))[0].release_version;
    await prisma.task.update({ where: { id: stale }, data: { triage_rev: { increment: 1 } } });
    const r2 = await post(stale, { ...WORDS, release_version: version });
    expect(r2.status).toBe(409);
    expect((await r2.json()).code).toBe('card_changed');
    for (const id of [done, unsorted, stale]) expect(await comments(id)).toHaveLength(0);
    expect((await row(stale)).status).toBe('triage');
  });
});
