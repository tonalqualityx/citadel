// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { NextRequest } from 'next/server';
import crypto from 'crypto';

let bearer: string | null = null;
vi.mock('next/headers', () => ({
  headers: async () => new Headers(bearer ? { authorization: `Bearer ${bearer}` } : {}),
  cookies: async () => ({ get: () => undefined }),
}));

import { prisma } from '@/lib/db/prisma';
import { hashApiKey } from '@/lib/auth/api-keys';
import { POST as claim } from '../claim/route';
import { POST as toolCall } from '../jobs/[id]/tool-calls/route';
import { GET as read } from '../jobs/[id]/read/[kind]/route';
import { enqueueJob } from '@/lib/engine/queue';
import { accessForJob, runRead } from '@/lib/engine/reads';
import { MAX_CALLS_PER_JOB } from '@/lib/engine/tool-calls';
import { PAGE_TEXT_CACHE_MS, PAGE_TEXT_MAX_BYTES, PAGE_TEXT_TIMEOUT_MS, readPageText, resetPageTextCache } from '@/lib/portal/chat/page-text';
import { anyUser, cleanup, SCRATCH, seedClient, type Seeded } from '@/lib/engine/__tests__/seed';

const req = (url: string) => new NextRequest(`http://localhost${url}`);
const ctx = (id: string, kind?: string) => ({ params: Promise.resolve({ id, kind: kind ?? '' }) });

const HOME = '<html><head><title>Home</title></head><body><h1>Lake Region Septic</h1><h2>What we do</h2><p>Septic tank pumping for homes, done right the first time. Call today.</p></body></html>';
const html = (body: string, status = 200, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });

// Phase C tool five (pilot finding 2026-10-21): page_text reads the client's OWN live page.
describe.skipIf(!SCRATCH)('page_text read (real database, mocked HTTP)', () => {
  const tag = `pt${Date.now()}`;
  let a: Seeded;
  let b: Seeded;
  let homeA = '';
  let aboutA = '';
  let homeB = '';
  let engineKey = '';
  let keyId = '';
  let fetchMock: MockInstance<typeof fetch>;

  beforeAll(async () => {
    a = await seedClient(`${tag}a`);
    b = await seedClient(`${tag}b`);
    const now = new Date();
    // The SitePage `url` column is NOT what is fetched: the read builds the URL from the site record + path.
    homeA = (await prisma.sitePage.create({ data: { site_id: a.siteId, url: 'https://evil.example.test/', path: '/', title: 'Home', depth: 0, source: 'sitemap', last_seen_at: now } })).id;
    aboutA = (await prisma.sitePage.create({ data: { site_id: a.siteId, url: `https://${tag}a.example.test/about/`, path: '/about/', title: 'About', depth: 1, source: 'sitemap', last_seen_at: now } })).id;
    homeB = (await prisma.sitePage.create({ data: { site_id: b.siteId, url: `https://${tag}b.example.test/`, path: '/', title: 'Bravo home', depth: 0, source: 'sitemap', last_seen_at: now } })).id;
    const user = await anyUser();
    await prisma.user.updateMany({ where: { id: user.id }, data: { role: 'pm', is_active: true } });
    const raw = 'citadel_' + crypto.randomBytes(16).toString('hex');
    keyId = (await prisma.apiKey.create({ data: { user_id: user.id, name: `test-${tag}`, key_hash: hashApiKey(raw), key_prefix: raw.slice(0, 16), scopes: ['engine'] } })).id;
    engineKey = raw;
  });
  afterAll(async () => {
    await cleanup([a, b]);
    await prisma.apiKey.deleteMany({ where: { id: keyId } });
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    resetPageTextCache();
    fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => html(HOME));
    const { updateChatSettings } = await import('@/lib/portal/chat/switches');
    await updateChatSettings({ mode: 'on', pilot_contact_ids: [] });
    bearer = engineKey;
    await prisma.engineToolCall.deleteMany({ where: { client_id: { in: [a.clientId, b.clientId] } } });
    await prisma.engineJob.deleteMany({ where: { client_id: { in: [a.clientId, b.clientId] } } });
  });
  afterEach(() => fetchMock.mockRestore());

  const fetchedUrls = () => fetchMock.mock.calls.map((c: Parameters<typeof fetch>) => String(c[0]));
  const ownerA = async () => (await accessForJob({ client_id: a.clientId, contact_id: a.ownerId }))!;

  it('find hit: the heading and the sentence, fetched from the site record + SitePage path only', async () => {
    const out = (await runRead(await ownerA(), 'page_text', { page_id: homeA, find: "'Done right the first time'" })) as Record<string, any>;
    expect(fetchedUrls()).toEqual([`https://${tag}a.example.test/`]);
    expect(out.found).toBe(true);
    expect(out.matches).toEqual([{ heading: 'What we do', level: 2, sentence: 'Septic tank pumping for homes, done right the first time.', in_heading: false }]);
    expect(out.page).toMatchObject({ id: homeA, title: 'Home', path: '/' });
  });

  it('find miss, and the sectioned text without find; the page is cached for ten minutes', async () => {
    const now = Date.now();
    const miss = (await readPageText(a.clientId, { site_id: a.siteId, path: '/', find: 'satisfaction guaranteed' }, { now })) as Record<string, any>;
    expect(miss).toMatchObject({ found: false, match_count: 0, matches: [] });
    const all = (await readPageText(a.clientId, { site_id: a.siteId, path: '' + '/' }, { now: now + 1000 })) as Record<string, any>;
    expect(all.sections.map((s: { heading: string }) => s.heading)).toEqual(['Lake Region Septic', 'What we do']);
    expect(all.cached).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await readPageText(a.clientId, { page_id: homeA }, { now: now + PAGE_TEXT_CACHE_MS + 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('a path is matched to a known SitePage (slash or not); anything else is a 404 and nothing is fetched', async () => {
    await readPageText(a.clientId, { site_id: a.siteId, path: 'about' });
    await readPageText(a.clientId, { site_id: a.siteId, path: `https://www.${tag}a.example.test/about?x=1` });
    expect(fetchedUrls()).toEqual([`https://${tag}a.example.test/about/`]); // the second was cached
    for (const path of ['/secret/', '//evil.example.test/', 'https://evil.example.test/about/', 'javascript:alert(1)']) {
      await expect(readPageText(a.clientId, { site_id: a.siteId, path }), path).rejects.toMatchObject({ statusCode: 404 });
    }
    await expect(readPageText(a.clientId, { site_id: a.siteId })).rejects.toMatchObject({ statusCode: 400 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('scoped to the job\'s client: another client\'s page or site is a 404 and nothing is fetched', async () => {
    const o = await ownerA();
    await expect(runRead(o, 'page_text', { page_id: homeB })).rejects.toMatchObject({ statusCode: 404 });
    await expect(runRead(o, 'page_text', { site_id: b.siteId, path: '/' })).rejects.toMatchObject({ statusCode: 404 });
    await expect(runRead(o, 'page_text', { site_id: b.siteId, page_id: homeA })).rejects.toMatchObject({ statusCode: 404 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('redirects: followed on the same host, refused off it', async () => {
    fetchMock.mockImplementation(async (input: Parameters<typeof fetch>[0]) => {
      const u = String(input);
      if (u.endsWith('/about/')) return new Response(null, { status: 301, headers: { location: `https://www.${tag}a.example.test/about-us/` } });
      if (u.includes('about-us')) return html(HOME);
      return new Response(null, { status: 302, headers: { location: 'https://evil.example.test/' } });
    });
    const ok = (await readPageText(a.clientId, { page_id: aboutA, find: 'pumping' })) as Record<string, any>;
    expect(ok.found).toBe(true);
    await expect(readPageText(a.clientId, { page_id: homeA })).rejects.toMatchObject({ statusCode: 502 });
    expect(fetchedUrls()).not.toContain('https://evil.example.test/');
  });

  it('reads at most 300 KB of the page', async () => {
    const big = `<h2>What we do</h2><p>${'x'.repeat(PAGE_TEXT_MAX_BYTES)}</p><h2>Tail</h2><p>done right the first time</p>`;
    fetchMock.mockImplementation(async () => html(big));
    const out = (await readPageText(a.clientId, { page_id: homeA, find: 'done right the first time' })) as Record<string, any>;
    expect(out.html_truncated).toBe(true);
    expect(out.found).toBe(false);
  });

  it(`times out after ${PAGE_TEXT_TIMEOUT_MS} ms with a 504`, async () => {
    expect(PAGE_TEXT_TIMEOUT_MS).toBe(5000);
    fetchMock.mockImplementation((_input: Parameters<typeof fetch>[0], init?: RequestInit) => new Promise<Response>((_, reject) => {
      (init?.signal as AbortSignal).addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const started = Date.now();
    await expect(runRead(await ownerA(), 'page_text', { page_id: homeA, find: 'x' })).rejects.toMatchObject({ statusCode: 504 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(PAGE_TEXT_TIMEOUT_MS - 50);
    expect(Date.now() - started).toBeLessThan(PAGE_TEXT_TIMEOUT_MS + 2000);
  }, 15_000);

  it('the route: a live job reads its own client\'s page; ids are validated; another client\'s page is a 404', async () => {
    await enqueueJob({ type: 'chat_reply', conversationId: a.conversationId, taskId: a.taskId, clientId: a.clientId, contactId: a.ownerId });
    const c = await claim(new NextRequest('http://localhost/api/engine/claim', { method: 'POST' }));
    const id = (await c.json()).job.id as string;
    const get = (qs: string) => read(req(`/x${qs}`), ctx(id, 'page_text'));
    const ok = await get(`?site_id=${a.siteId}&page_id=${homeA}&find=${encodeURIComponent('done right the first time')}`);
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body).toMatchObject({ kind: 'page_text', data: { found: true, matches: [{ heading: 'What we do' }] } });
    expect((await get(`?page_id=${homeB}`)).status).toBe(404);
    expect((await get('?page_id=not-a-uuid')).status).toBe(400);
    expect((await get(`?site_id=${a.siteId}&path=/&find=${'x'.repeat(201)}`)).status).toBe(400);
    // A url parameter is not a thing: the fetch still goes to the site record's own address.
    expect((await get(`?site_id=${a.siteId}&path=/&url=${encodeURIComponent('https://evil.example.test/')}`)).status).toBe(200);
    expect(fetchedUrls().every((u: string) => u.startsWith(`https://${tag}a.example.test/`))).toBe(true);

    // Logged like the others and counted against the per-job cap.
    const post = (n: number) => toolCall(new NextRequest('http://localhost/x', { method: 'POST', body: JSON.stringify({ tool: 'page_text', args: { n }, row_count: 1, result: body.data }) }), ctx(id));
    for (let i = 0; i < MAX_CALLS_PER_JOB; i++) expect((await post(i)).status).toBe(201);
    expect((await post(99)).status).toBe(429);
  });
});
