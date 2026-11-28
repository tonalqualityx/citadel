// @vitest-environment node
/**
 * Signed one-time answer links against a real scratch Postgres: minting (who may, which questions), an option link recording Mike's answer with
 * its source and releasing the blocked card, the talk-it-through link holding the question without defaulting it, and the used, expired,
 * altered and out-of-date links recording nothing.
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
import { MIKE_USER_ID, BOT_USER_IDS } from '@/lib/oracle/projects/gate-constants';
import { POST as addQ } from '@/app/api/tasks/[id]/questions/route';
import { PATCH as patchQ } from '@/app/api/tasks/[id]/questions/[qid]/route';
import { POST as mintQ } from '@/app/api/tasks/[id]/questions/[qid]/links/route';
import { POST as answerQ } from '@/app/api/tasks/[id]/questions/[qid]/answer/route';
import { GET as openLink, POST as redeemLink } from '@/app/api/question-links/[token]/route';
import { defaultDueQuestions, HELD_TAG } from '../questions';
import { WHY_DESCRIPTION } from '@/lib/tasks/__tests__/fixtures/why';

const authMock = requireAuth as Mock;
const taskParams = (id: string) => ({ params: Promise.resolve({ id }) });
const qParams = (id: string, qid: string) => ({ params: Promise.resolve({ id, qid }) });
const tParams = (token: string) => ({ params: Promise.resolve({ token }) });
const req = (body?: unknown, method = 'POST') => new NextRequest('http://localhost/api/x', { method, body: body === undefined ? undefined : JSON.stringify(body) });
const REPORT = 'https://reports.becomeindelible.com/r/abc123/';

const CONTEXT = {
  what_it_is: 'The health view needs a layout before the build starts.',
  sources: [{ who: 'Mike', said: 'Show me options', at: '2026-11-25' }],
  checked: 'The three mockups on the report page.',
  unknown: 'Which layout reads best on a phone.',
  if_nobody: 'The recommended layout goes ahead.',
};
const withOptions = (question: string, action: 'go_with_recommendation' | 'wait' = 'go_with_recommendation') => ({
  ...CONTEXT,
  question,
  options: [
    { id: 'cards', label: 'Cards', consequence: 'Easy to skim.' },
    { id: 'table', label: 'Table', consequence: 'Dense, harder on a phone.' },
  ],
  recommended_option_id: 'cards',
  recommend_why: 'Cards read best at 320px.',
  if_nobody_action: action,
});

describe.skipIf(!SCRATCH)('answer links (real database)', () => {
  const tag = `al${Date.now()}`;
  const taskIds: string[] = [];
  const projectIds: string[] = [];
  let pmId: string;
  let clientId: string;
  let contactId: string;

  const mike = (): AuthPayload => ({ userId: MIKE_USER_ID, role: 'admin', email: 'mike@test', via: 'session' });
  const worker = (): AuthPayload => ({ userId: BOT_USER_IDS[0], role: 'pm', email: 'bast@test', via: 'api_key', apiKeyId: 'kw', lane: 'bast' });
  const pm = (): AuthPayload => ({ userId: pmId, role: 'pm', email: 'pm@test', via: 'session' });
  const as = (a: AuthPayload) => authMock.mockResolvedValue(a);

  const mkTask = async (title: string, extra: Record<string, unknown> = {}) => {
    const t = await prisma.task.create({ data: { title: `${tag} ${title}`, status: 'not_started', ...extra } as never });
    taskIds.push(t.id);
    return t.id;
  };
  const ask = async (taskId: string, body: Record<string, unknown>) => {
    as(mike());
    const res = await addQ(req(body), taskParams(taskId));
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(201);
    return (await res.json()) as { id: string };
  };
  type Minted = { options: Array<{ option_id: string; label: string; recommended: boolean; url: string }>; talk_it_through: { url: string }; expires_at: string };
  const mint = async (taskId: string, qid: string, who: AuthPayload = worker(), body: Record<string, unknown> = { report_url: REPORT }) => {
    as(who);
    return mintQ(req(body), qParams(taskId, qid));
  };
  const mintOk = async (taskId: string, qid: string) => {
    const res = await mint(taskId, qid);
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(201);
    return (await res.json()) as Minted;
  };
  const tokenOf = (url: string) => url.split('/api/question-links/')[1];
  type LinkBody = { ok: boolean; code: string; message: string; label?: string; released_task_ids?: string[]; selected?: boolean; report_url?: string };
  const tap = async (url: string, origin?: string) => {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (origin) headers.origin = origin;
    const r = new NextRequest(`http://localhost/api/question-links/${tokenOf(url)}`, { method: 'POST', headers });
    const res = await redeemLink(r, tParams(tokenOf(url)));
    return { status: res.status, body: (await res.json()) as LinkBody, allowOrigin: res.headers.get('access-control-allow-origin') };
  };
  // What a reopened report page reads for each button: the link's state as JSON, from the reports site.
  const peek = async (url: string) => {
    const r = new NextRequest(`http://localhost/api/question-links/${tokenOf(url)}`, { headers: { accept: 'application/json', origin: 'https://reports.becomeindelible.com' } });
    const res = await openLink(r, tParams(tokenOf(url)));
    return { status: res.status, body: (await res.json()) as LinkBody, allowOrigin: res.headers.get('access-control-allow-origin') };
  };
  const q = (id: string) => prisma.taskQuestion.findUniqueOrThrow({ where: { id } });

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'scratch-secret';
    await prisma.user.upsert({ where: { id: MIKE_USER_ID }, update: {}, create: { id: MIKE_USER_ID, email: `mike-${tag}@example.test`, password_hash: 'x', name: 'Mike', role: 'admin' } });
    await prisma.user.upsert({ where: { id: BOT_USER_IDS[0] }, update: {}, create: { id: BOT_USER_IDS[0], email: `bast-${tag}@example.test`, password_hash: 'x', name: 'Bast', role: 'pm' } });
    pmId = (await prisma.user.create({ data: { email: `pm-${tag}@example.test`, password_hash: 'x', name: 'pm', role: 'pm' } })).id;
    clientId = (await prisma.client.create({ data: { name: `${tag} Co`, type: 'direct', status: 'active' } })).id;
    contactId = (await prisma.clientContact.create({ data: { client_id: clientId, name: 'Olive', email: `olive-${tag}@example.test`, portal_role: 'owner', can_initiate_work: true } })).id;
  });
  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { entity_id: { in: taskIds } } });
    await prisma.activityLog.deleteMany({ where: { entity_id: { in: taskIds } } });
    await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
    await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
    await prisma.clientContact.deleteMany({ where: { id: contactId } });
    await prisma.client.deleteMany({ where: { id: clientId } });
    await prisma.user.deleteMany({ where: { id: pmId } });
    await prisma.$disconnect();
  });

  it('mints one link per option plus a talk-it-through link, for Mike or the worker only', async () => {
    const t = await mkTask('mint');
    const row = await ask(t, withOptions('Which layout for the health view?'));
    const m = await mintOk(t, row.id);
    expect(m.options.map((o) => o.label)).toEqual(['Cards', 'Table']);
    expect(m.options.find((o) => o.option_id === 'cards')?.recommended).toBe(true);
    expect(m.talk_it_through.url).toContain('/api/question-links/');
    expect(new Set([...m.options.map((o) => o.url), m.talk_it_through.url]).size).toBe(3);
    expect(await prisma.questionAnswerLink.count({ where: { question_id: row.id } })).toBe(3);
    // A pm who is not Mike cannot mint links that answer as Mike.
    expect((await mint(t, row.id, pm())).status).toBe(403);
    // A non-https report link is refused.
    expect((await mint(t, row.id, worker(), { report_url: 'http://example.com/r' })).status).toBe(400);
  });

  it('refuses a question we sent a client, and a question that is not open', async () => {
    const t = await mkTask('client q');
    const row = await ask(t, withOptions('Does the client want the table?'));
    await prisma.taskQuestion.update({ where: { id: row.id }, data: { asked_of_contact_id: contactId } });
    const res = await mint(t, row.id);
    expect(res.status).toBe(422);
    expect(JSON.stringify(await res.json())).toContain('not_mikes_question');

    const t2 = await mkTask('closed q');
    const row2 = await ask(t2, withOptions('Is this one withdrawn?'));
    as(mike());
    await patchQ(req({ withdraw: true, reason: 'not needed' }, 'PATCH'), qParams(t2, row2.id));
    expect((await mint(t2, row2.id)).status).toBe(409);
  });

  it('an option link records the option as Mike\'s answer with its source, releases the blocked card, and works once', async () => {
    const t = await mkTask('answer');
    const blocked = await mkTask('waits on the answer');
    const row = await ask(t, { ...withOptions('Which layout should we build?', 'wait') });
    // The question blocks a second card, as a report decision would (held in blocked exactly as the blocks route does).
    await prisma.taskQuestion.update({ where: { id: row.id }, data: { blocks: { connect: [{ id: blocked }] } } });
    await prisma.task.update({ where: { id: blocked }, data: { status: 'blocked' } });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: blocked } })).status).toBe('blocked');

    const m = await mintOk(t, row.id);
    const table = m.options.find((o) => o.option_id === 'table')!;

    // Opening it (GET) reads only: nothing is recorded until the page posts back.
    const page = await openLink(new NextRequest(`http://localhost${new URL(table.url).pathname}`), tParams(tokenOf(table.url)));
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('Recording your answer: Table');
    expect(html).toContain('method="post"');
    expect((await q(row.id)).state).toBe('open');

    // Before the tap, a reopened report shows nothing picked.
    expect((await peek(table.url)).body).toMatchObject({ ok: true, code: 'ready', selected: false, report_url: REPORT });

    // The report page taps from its own site and reads the answer in place.
    const r = await tap(table.url, 'https://reports.becomeindelible.com');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, code: 'answered', label: 'Table', selected: true });
    expect(r.body.released_task_ids).toEqual([blocked]);
    expect(r.allowOrigin).toBe('https://reports.becomeindelible.com');

    // Reopened later: the picked option shows as selected, the other option and the talk button do not.
    const seen = await peek(table.url);
    expect(seen.body).toMatchObject({ ok: false, code: 'used', selected: true });
    expect(seen.allowOrigin).toBe('https://reports.becomeindelible.com');
    expect((await peek(m.options.find((o) => o.option_id === 'cards')!.url)).body.selected).toBe(false);
    expect((await peek(m.talk_it_through.url)).body.selected).toBe(false);

    const after = await q(row.id);
    expect(after.state).toBe('answered');
    expect(after.answer_option_id).toBe('table');
    expect(after.answer_text).toBe('Table');
    expect(after.answered_by_id).toBe(MIKE_USER_ID);
    const c = await prisma.comment.findUniqueOrThrow({ where: { id: after.answer_comment_id! } });
    expect(c.user_id).toBe(MIKE_USER_ID);
    expect(c.is_internal).toBe(true);
    expect(c.content).toContain('Answer on "Which layout should we build?": Table');
    expect(c.content).toMatch(/From Mike, \d{4}-\d{2}-\d{2}: "tapped Table on the report page" \(https:\/\/reports\.becomeindelible\.com\/r\/abc123\/\)/);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: blocked } })).status).toBe('not_started');

    // Used: the same link again records nothing, and neither does the talk button once the question is answered.
    const again = await tap(table.url);
    expect(again.status).toBe(410);
    expect(again.body.code).toBe('used');
    expect((await tap(m.talk_it_through.url)).body.ok).toBe(false);
    expect((await q(row.id)).answer_option_id).toBe('table');
    expect(await prisma.comment.count({ where: { task_id: t, chat_meta: { path: ['question', 'id'], equals: row.id } } })).toBe(1);
  });

  it('another option of the same report changes a tapped answer, back and forth, but never an answer given on the card', async () => {
    const t = await mkTask('change');
    const row = await ask(t, withOptions('Cards or a table for the change test?', 'wait'));
    const m = await mintOk(t, row.id);
    const cards = m.options.find((o) => o.option_id === 'cards')!;
    const table = m.options.find((o) => o.option_id === 'table')!;
    expect((await tap(table.url, 'https://reports.becomeindelible.com')).body.code).toBe('answered');

    // The other option still reads as a live button (ready, not picked), so the page keeps it tappable.
    expect((await peek(cards.url)).body).toMatchObject({ ok: true, code: 'ready', selected: false });
    const ch = await tap(cards.url, 'https://reports.becomeindelible.com');
    expect(ch.status).toBe(200);
    expect(ch.body).toMatchObject({ ok: true, code: 'reanswered', label: 'Cards', selected: true });
    let now = await q(row.id);
    expect(now.state).toBe('answered');
    expect(now.answer_option_id).toBe('cards');
    expect(now.answer_text).toBe('Cards');
    const c = await prisma.comment.findUniqueOrThrow({ where: { id: now.answer_comment_id! } });
    expect(c.content).toContain('Answer on "Cards or a table for the change test?": Cards');
    expect(c.content).toContain('changed the answer from Table to Cards on the report page');
    expect((await peek(cards.url)).body.selected).toBe(true);
    expect((await peek(table.url)).body).toMatchObject({ ok: true, code: 'ready', selected: false });

    // And back again with the first button.
    expect((await tap(table.url)).body.code).toBe('reanswered');
    expect((await q(row.id)).answer_option_id).toBe('table');
    // Tapping the current answer again records nothing.
    expect((await tap(table.url)).body.code).toBe('used');

    // Mike answers on the card instead: the report's buttons can no longer change it.
    as(mike());
    const res = await answerQ(req({ option_id: 'cards', version: (await q(row.id)).updated_at.toISOString() }), qParams(t, row.id));
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    now = await q(row.id);
    expect(now.answer_option_id).toBe('cards');
    const blocked = await tap(table.url);
    expect(blocked.body).toMatchObject({ ok: false, code: 'used' });
    expect((await q(row.id)).answer_option_id).toBe('cards');
    expect((await peek(table.url)).body.ok).toBe(false);
  });

  it('talk it through holds the question for a chat and the go-ahead sweep never defaults it; an option link still answers later', async () => {
    const t = await mkTask('hold');
    const row = await ask(t, withOptions('Which layout, cards or table?', 'go_with_recommendation'));
    await prisma.taskQuestion.update({ where: { id: row.id }, data: { default_at: new Date(Date.now() - 60_000) } });
    // The link minted before the hold is the one the report carries.
    const m = await mintOk(t, row.id);

    // A post from another site records nothing, even with a good link.
    const foreign = await tap(m.talk_it_through.url, 'https://evil.test');
    expect(foreign.status).toBe(403);
    expect(foreign.body.code).toBe('foreign_origin');
    expect((await q(row.id)).held_for_chat_at).toBeNull();

    const r = await tap(m.talk_it_through.url);
    expect(r.body).toMatchObject({ ok: true, code: 'held', selected: true });
    // Reopened: talk it through shows as picked, and the options still answer.
    expect((await peek(m.talk_it_through.url)).body.selected).toBe(true);
    expect((await peek(m.options[0].url)).body).toMatchObject({ ok: true, code: 'ready', selected: false });
    const held = await q(row.id);
    expect(held.state).toBe('open');
    expect(held.held_for_chat_at).not.toBeNull();
    expect(held.held_report_url).toBe(REPORT);
    expect(held.if_nobody_action).toBe('wait');
    expect(held.default_at).toBeNull();
    const note = await prisma.comment.findFirstOrThrow({ where: { task_id: t, content: { contains: 'Talk it through' } } });
    expect(note.user_id).toBe(BOT_USER_IDS[0]);

    const swept = await defaultDueQuestions(new Date());
    expect(swept.defaulted).not.toContain(row.id);
    expect((await q(row.id)).state).toBe('open');

    // The hold link works once.
    expect((await tap(m.talk_it_through.url)).body.code).toBe('used');
    // After the chat he can still tap an option on the same report.
    const later = await tap(m.options[0].url);
    expect(later.body).toMatchObject({ ok: true, code: 'answered', label: 'Cards' });
  });

  it('a held question on a Triage card waits on release instead of going ahead', async () => {
    const t = await mkTask('triage hold', { status: 'triage', description: WHY_DESCRIPTION });
    const row = await ask(t, withOptions('Release with cards or table?', 'go_with_recommendation'));
    // The worker key never reads a Triage card's questions, so it cannot mint there; Mike can.
    expect((await mint(t, row.id, worker())).status).toBe(404);
    const res = await mint(t, row.id, mike());
    expect(res.status).toBe(201);
    const links = (await res.json()) as Minted;
    expect((await tap(links.talk_it_through.url)).body.code).toBe('held');
    const { release } = await import('@/lib/tasks/triage');
    await release(prisma, MIKE_USER_ID, [t], new Date());
    expect((await q(row.id)).state).toBe('open');
    const card = await prisma.task.findUniqueOrThrow({ where: { id: t } });
    expect(card.status).toBe('not_started');
    expect(card.tags).toContain(HELD_TAG);
  });

  it('an expired, altered or out-of-date link records nothing and says so', async () => {
    const t = await mkTask('refusals');
    const row = await ask(t, withOptions('Cards, table, or something else?'));
    const m = await mintOk(t, row.id);
    const [cards, table] = m.options;

    // Altered: one character of the signature changed.
    const tok = tokenOf(cards.url);
    const altered = tok.slice(0, -1) + (tok.endsWith('A') ? 'B' : 'A');
    const a = await tap(`http://x/api/question-links/${altered}`);
    expect(a.status).toBe(400);
    expect(a.body.code).toBe('altered');
    expect(a.body.message).toContain('Nothing was recorded');

    // Out of date: the question's options changed after the report was made.
    as(mike());
    const patched = await patchQ(req({ options: [{ id: 'cards', label: 'Big cards', consequence: 'Easy to skim.' }, { id: 'table', label: 'Table', consequence: 'Dense, harder on a phone.' }] }, 'PATCH'), qParams(t, row.id));
    expect(patched.status, JSON.stringify(await patched.clone().json())).toBe(200);
    const ch = await tap(table.url);
    expect(ch.status).toBe(409);
    expect(ch.body.code).toBe('changed');

    // Expired.
    const m2 = await mintOk(t, row.id);
    await prisma.questionAnswerLink.updateMany({ where: { question_id: row.id, used_at: null }, data: { expires_at: new Date(Date.now() - 1000) } });
    const ex = await tap(m2.options[1].url);
    expect(ex.status).toBe(410);
    expect(ex.body.code).toBe('expired');

    const still = await q(row.id);
    expect(still.state).toBe('open');
    expect(still.answer_text).toBeNull();
  });
});
