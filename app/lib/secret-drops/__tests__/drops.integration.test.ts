// @vitest-environment node
/**
 * Secret drops against a real scratch Postgres, through the routes: minting (who may, the hold on the waiting task), a key encrypted the way the
 * page does it and taken once, the database holding only ciphertext, the machine collecting and decrypting it, and storing it lifting the hold,
 * closing Mike's task and releasing what it held. Used, expired and altered links take nothing.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { webcrypto } from 'crypto';

vi.mock('@/lib/auth/middleware', async (orig) => ({
  ...(await orig<typeof import('@/lib/auth/middleware')>()),
  requireAuth: vi.fn(),
}));

import { prisma } from '@/lib/db/prisma';
import { requireAuth, type AuthPayload } from '@/lib/auth/middleware';
import { SCRATCH } from '@/lib/engine/__tests__/seed';
import { BAST_USER_ID, MIKE_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { POST as mintRoute } from '@/app/api/secret-drops/route';
import { GET as machineRoute } from '@/app/api/secret-drops/[id]/route';
import { POST as resultRoute } from '@/app/api/secret-drops/[id]/result/route';
import { GET as openLink, POST as sendLink } from '@/app/api/secret-drop-links/[token]/route';

const subtle = webcrypto.subtle;
const authMock = requireAuth as Mock;
const idParams = (id: string) => ({ params: Promise.resolve({ id }) });
const tParams = (token: string) => ({ params: Promise.resolve({ token }) });
const req = (body?: unknown, extra: { accept?: string; origin?: string } = {}, method = 'POST') => {
  const headers: Record<string, string> = { 'content-type': 'application/json', host: 'localhost' };
  if (extra.accept) headers.accept = extra.accept;
  if (extra.origin) headers.origin = extra.origin;
  return new NextRequest('http://localhost/api/x', { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
};
const b64u = (buf: ArrayBuffer | Uint8Array) => Buffer.from(buf instanceof Uint8Array ? buf : new Uint8Array(buf)).toString('base64url');
const SECRET = 'sk_test_plaintext_value_9f1c2e';

/** Encrypt exactly as the page's script does. */
async function encryptLikeThePage(pub: { n: string; e: string }, value: string) {
  const rsa = await subtle.importKey('jwk', { kty: 'RSA', n: pub.n, e: pub.e, alg: 'RSA-OAEP-256', ext: true }, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
  const aes = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, aes, new TextEncoder().encode(value));
  const ek = await subtle.encrypt({ name: 'RSA-OAEP' }, rsa, await subtle.exportKey('raw', aes));
  return { v: 1, ek: b64u(ek), iv: b64u(iv), ct: b64u(ct) };
}

describe.skipIf(!SCRATCH)('secret drops (real database)', () => {
  const tag = `sd${Date.now()}`;
  const taskIds: string[] = [];
  const dropIds: string[] = [];
  let keys: CryptoKeyPair;
  let pub: { kty: 'RSA'; n: string; e: string };

  const mike = (): AuthPayload => ({ userId: MIKE_USER_ID, role: 'admin', email: 'mike@test', via: 'session' });
  const worker = (): AuthPayload => ({ userId: BAST_USER_ID, role: 'pm', email: 'bast@test', via: 'api_key', apiKeyId: 'kw', lane: 'bast' });
  const chat = (): AuthPayload => ({ userId: BAST_USER_ID, role: 'pm', email: 'bast@test', via: 'api_key', apiKeyId: 'kc', lane: 'bast-chat' });
  const as = (a: AuthPayload) => authMock.mockResolvedValue(a);

  const mkTask = async (title: string, extra: Record<string, unknown> = {}) => {
    const t = await prisma.task.create({ data: { title: `${tag} ${title}`, status: 'not_started', ...extra } as never });
    taskIds.push(t.id);
    return t.id;
  };
  const mint = async (body: Record<string, unknown>, who: AuthPayload = worker()) => {
    as(who);
    const res = await mintRoute(req({ public_key: pub, ...body }));
    const json = await res.json();
    if (res.status === 201) dropIds.push(json.id);
    return { status: res.status, json };
  };
  const tokenOf = (url: string) => url.split('/api/secret-drop-links/')[1];

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-drops';
    keys = (await subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['encrypt', 'decrypt'])) as CryptoKeyPair;
    const jwk = await subtle.exportKey('jwk', keys.publicKey);
    pub = { kty: 'RSA', n: jwk.n!, e: jwk.e! };
  });

  afterAll(async () => {
    await prisma.secretDrop.deleteMany({ where: { id: { in: dropIds } } });
    await prisma.comment.deleteMany({ where: { task_id: { in: taskIds } } });
    await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
  });

  it('only Mike and the worker key mint', async () => {
    expect((await mint({ key_name: 'SOME_KEY' }, chat())).status).toBe(403);
    expect((await mint({ key_name: 'SOME_KEY' }, mike())).status).toBe(201);
    expect((await mint({ key_name: 'SOME_KEY' })).status).toBe(201);
  });

  it('the whole trip: mint, encrypted send, machine collects, stored lifts the hold and closes Mike\'s task', async () => {
    const mikeTask = await mkTask('Hand over the DataForSEO password', { assignee_id: MIKE_USER_ID });
    const waiting = await mkTask('Run the keyword pull', { status: 'blocked', tags: ['needs-mike', 'repo:bast-machine'] });
    await prisma.task.update({ where: { id: waiting }, data: { blocked_by: { connect: { id: mikeTask } } } });

    const m = await mint({ key_name: 'DATAFORSEO_PASSWORD', label: 'DataForSEO password', task_id: waiting, mike_task_id: mikeTask, replaces_existing: true });
    expect(m.status).toBe(201);
    expect(m.json.url).toMatch(/\/api\/secret-drop-links\/[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/);
    const held = await prisma.task.findUnique({ where: { id: waiting }, select: { tags: true } });
    expect(held!.tags).toEqual(expect.arrayContaining(['awaiting-key', 'needs-mike']));
    const row0 = await prisma.secretDrop.findUnique({ where: { id: m.json.id } });
    expect(row0!.added_needs_mike).toBe(false);

    const token = tokenOf(m.json.url);
    const page = await openLink(req(undefined, {}, 'GET'), tParams(token));
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('Hand over DataForSEO password');
    expect(html).toContain('replaces the key already stored');
    expect(page.headers.get('content-security-policy')).toContain("script-src 'nonce-");

    // Nothing to collect yet
    as(worker());
    expect((await (await machineRoute(req(undefined, {}, 'GET'), idParams(m.json.id))).json()).status).toBe('waiting');
    expect((await resultRoute(req({ ok: true, stored_where: 'x' }), idParams(m.json.id))).status).toBe(409);

    // A post from another site takes nothing; the page's own post (Origin null under no-referrer) does
    const envelope = await encryptLikeThePage(pub, SECRET);
    expect((await sendLink(req(envelope, { origin: 'https://evil.example' }), tParams(token))).status).toBe(403);
    expect((await sendLink(req({ value: SECRET }, { origin: 'null' }), tParams(token))).status).toBe(400);
    const sent = await sendLink(req(envelope, { origin: 'null' }), tParams(token));
    expect(sent.status).toBe(200);
    expect((await sendLink(req(envelope, { origin: 'null' }), tParams(token))).status).toBe(410);

    // Citadel holds only ciphertext
    const raw = await prisma.secretDrop.findUnique({ where: { id: m.json.id } });
    expect(raw!.ciphertext).toBeTruthy();
    expect(raw!.ciphertext).not.toContain(SECRET);
    expect(JSON.stringify(raw)).not.toContain(SECRET);

    // The public status never carries the ciphertext
    const pubStatus = await (await openLink(req(undefined, { accept: 'application/json' }, 'GET'), tParams(token))).json();
    expect(pubStatus.status).toBe('received');
    expect(JSON.stringify(pubStatus)).not.toContain(envelope.ct);

    // Another lane cannot collect
    as(chat());
    expect((await machineRoute(req(undefined, {}, 'GET'), idParams(m.json.id))).status).toBe(403);

    // The machine collects and decrypts it with the private half
    as(worker());
    const view = await (await machineRoute(req(undefined, {}, 'GET'), idParams(m.json.id))).json();
    expect(view.status).toBe('received');
    const c = view.ciphertext as typeof envelope;
    const aesRaw = await subtle.decrypt({ name: 'RSA-OAEP' }, keys.privateKey, Buffer.from(c.ek, 'base64url'));
    const aes = await subtle.importKey('raw', aesRaw, { name: 'AES-GCM' }, false, ['decrypt']);
    const plain = await subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(c.iv, 'base64url') }, aes, Buffer.from(c.ct, 'base64url'));
    expect(new TextDecoder().decode(plain)).toBe(SECRET);

    const done = await resultRoute(req({ ok: true, stored_where: 'Troubador config, dataforseo.password' }), idParams(m.json.id));
    expect(done.status).toBe(200);
    const dj = await done.json();
    expect(dj.status).toBe('stored');
    expect(dj.released_task_ids).toContain(waiting);

    const after = await prisma.secretDrop.findUnique({ where: { id: m.json.id } });
    expect(after!.ciphertext).toBeNull();
    expect(after!.stored_at).toBeTruthy();
    const w = await prisma.task.findUnique({ where: { id: waiting }, select: { tags: true, status: true } });
    expect(w!.tags).toEqual(['repo:bast-machine']);
    expect(w!.status).toBe('not_started');
    const mt = await prisma.task.findUnique({ where: { id: mikeTask }, select: { status: true } });
    expect(mt!.status).toBe('done');
    const notes = await prisma.comment.findMany({ where: { task_id: waiting }, select: { content: true, user_id: true, is_internal: true } });
    expect(notes).toHaveLength(1);
    expect(notes[0].user_id).toBe(BAST_USER_ID);
    expect(notes[0].is_internal).toBe(true);
    expect(notes[0].content).toContain('DATAFORSEO_PASSWORD');
    expect(notes[0].content).not.toContain(SECRET);

    // The page now says Stored; a repeat result changes nothing
    const storedPage = await (await openLink(req(undefined, {}, 'GET'), tParams(token))).text();
    expect(storedPage).toContain('<h1>Stored</h1>');
    expect((await (await resultRoute(req({ ok: true, stored_where: 'again' }), idParams(m.json.id))).json()).status).toBe('stored');
    expect(await prisma.comment.count({ where: { task_id: waiting } })).toBe(1);
  });

  it('a link that put needs-mike on takes it off; one that found it there leaves it', async () => {
    const plain = await mkTask('Plain waiting task', { tags: ['repo:x'] });
    const m1 = await mint({ key_name: 'ELEVENLABS_API_KEY', task_id: plain });
    expect((await prisma.task.findUnique({ where: { id: plain } }))!.tags).toEqual(['repo:x', 'awaiting-key', 'needs-mike']);
    await sendLink(req(await encryptLikeThePage(pub, SECRET), { origin: 'null' }), tParams(tokenOf(m1.json.url)));
    as(worker());
    await resultRoute(req({ ok: true, stored_where: 'the machine key store' }), idParams(m1.json.id));
    expect((await prisma.task.findUnique({ where: { id: plain } }))!.tags).toEqual(['repo:x']);

    const parked = await mkTask('Already parked task', { tags: ['needs-mike'] });
    const m2 = await mint({ key_name: 'UNSPLASH_ACCESS_KEY', task_id: parked });
    await sendLink(req(await encryptLikeThePage(pub, SECRET), { origin: 'null' }), tParams(tokenOf(m2.json.url)));
    as(worker());
    await resultRoute(req({ ok: true, stored_where: 'Troubador config' }), idParams(m2.json.id));
    expect((await prisma.task.findUnique({ where: { id: parked } }))!.tags).toEqual(['needs-mike']);
  });

  it('a failed store tells the page why and keeps nothing; the hold stays', async () => {
    const t = await mkTask('Waits on a key', { tags: [] });
    const m = await mint({ key_name: 'STRIPE_SECRET_KEY', task_id: t });
    await sendLink(req(await encryptLikeThePage(pub, SECRET), { origin: 'null' }), tParams(tokenOf(m.json.url)));
    as(worker());
    const r = await (await resultRoute(req({ ok: false, reason: 'the key has line breaks' }), idParams(m.json.id))).json();
    expect(r.status).toBe('failed');
    expect((await prisma.secretDrop.findUnique({ where: { id: m.json.id } }))!.ciphertext).toBeNull();
    const s = await (await openLink(req(undefined, { accept: 'application/json' }, 'GET'), tParams(tokenOf(m.json.url)))).json();
    expect(s.status).toBe('failed');
    expect(s.failed_reason).toBe('the key has line breaks');
    expect((await prisma.task.findUnique({ where: { id: t } }))!.tags).toEqual(['awaiting-key', 'needs-mike']);
  });

  it('expired and altered links take nothing', async () => {
    const m = await mint({ key_name: 'OLD_KEY', expires_in_minutes: 5 });
    await prisma.secretDrop.update({ where: { id: m.json.id }, data: { expires_at: new Date(Date.now() - 1000) } });
    const env = await encryptLikeThePage(pub, SECRET);
    expect((await sendLink(req(env, { origin: 'null' }), tParams(tokenOf(m.json.url)))).status).toBe(410);
    expect((await openLink(req(undefined, {}, 'GET'), tParams(tokenOf(m.json.url)))).status).toBe(410);
    const bad = tokenOf(m.json.url).slice(0, -2) + 'xx';
    expect((await sendLink(req(env, { origin: 'null' }), tParams(bad))).status).toBe(400);
    expect((await openLink(req(undefined, {}, 'GET'), tParams(bad))).status).toBe(400);
    expect((await prisma.secretDrop.findUnique({ where: { id: m.json.id } }))!.ciphertext).toBeNull();
  });
});
