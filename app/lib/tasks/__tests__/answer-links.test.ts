// @vitest-environment node
/** The signing half of answer links, and the pages: no database. */
import { describe, it, expect, beforeAll } from 'vitest';
import { NextRequest } from 'next/server';
import { tokenFor, verifyToken, wordingHash, inspectPage, outcomePage, mayMintLinks, isSelected, mayChangeAnswer, corsHeadersFor, postOriginAllowed, REPORTS_ORIGIN, type LinkOutcome } from '../answer-links';
import { OPTIONS, POST } from '@/app/api/question-links/[token]/route';
import { MIKE_USER_ID, BAST_USER_ID } from '@/lib/oracle/projects/gate-constants';

const ID = '11111111-2222-4333-8444-555555555555';

describe('answer link tokens', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-answer-links';
  });

  it('verifies a token it made and returns the link id', () => {
    expect(verifyToken(tokenFor(ID))).toBe(ID);
  });

  it('refuses an altered signature, an altered id, a truncated token and junk', () => {
    const t = tokenFor(ID);
    const [id, sig] = t.split('.');
    const flipped = sig.slice(0, -1) + (sig.endsWith('A') ? 'B' : 'A');
    expect(verifyToken(`${id}.${flipped}`)).toBeNull();
    expect(verifyToken(`11111111-2222-4333-8444-555555555556.${sig}`)).toBeNull();
    expect(verifyToken(t.slice(0, -2))).toBeNull();
    expect(verifyToken('not-a-token')).toBeNull();
    expect(verifyToken('')).toBeNull();
  });

  it('a different server secret makes old links stop matching', () => {
    const t = tokenFor(ID);
    const before = process.env.QUESTION_LINK_SECRET;
    process.env.QUESTION_LINK_SECRET = 'another-secret';
    try {
      expect(verifyToken(t)).toBeNull();
    } finally {
      if (before === undefined) delete process.env.QUESTION_LINK_SECRET;
      else process.env.QUESTION_LINK_SECRET = before;
    }
  });

  it('the wording hash changes with the question or its options, and only then', () => {
    const opts = [{ id: 'a', label: 'A', consequence: 'x' }];
    const h = wordingHash({ question: 'Pick one?', options: opts });
    expect(wordingHash({ question: 'Pick one?', options: [{ id: 'a', label: 'A', consequence: 'x' }] })).toBe(h);
    expect(wordingHash({ question: 'Pick two?', options: opts })).not.toBe(h);
    expect(wordingHash({ question: 'Pick one?', options: [{ id: 'a', label: 'B', consequence: 'x' }] })).not.toBe(h);
  });
});

describe('who may mint', () => {
  it('Mike, the chat lane, the front session and the worker key; not Dox or another lane, not a pm session', () => {
    expect(mayMintLinks({ userId: MIKE_USER_ID, role: 'admin', via: 'session' })).toBe(true);
    expect(mayMintLinks({ userId: BAST_USER_ID, role: 'pm', via: 'api_key', lane: 'bast-chat', laneEnforced: true })).toBe(true);
    expect(mayMintLinks({ userId: BAST_USER_ID, role: 'pm', via: 'api_key', lane: 'bast' })).toBe(true);
    expect(mayMintLinks({ userId: BAST_USER_ID, role: 'pm', via: 'api_key' })).toBe(true);
    expect(mayMintLinks({ userId: BAST_USER_ID, role: 'pm', via: 'api_key', lane: 'courier' })).toBe(false);
    expect(mayMintLinks({ userId: '1797579d-2c5e-42de-8366-c38be92ee1ae', role: 'pm', via: 'api_key', lane: 'dox', laneEnforced: true })).toBe(false);
    expect(mayMintLinks({ userId: '99999999-2222-4333-8444-555555555555', role: 'pm', via: 'session' })).toBe(false);
  });
});

describe('link pages', () => {
  const ready: LinkOutcome = { ok: true, code: 'ready', status: 200, title: 'Recording your answer: <b>Map</b>', message: '', question: 'Show "the" map?', label: '<b>Map</b>' };

  it('a good link posts itself back and escapes what it shows', () => {
    const html = inspectPage(ready, 'tok.en');
    expect(html).toContain('method="post" action="/api/question-links/tok.en"');
    expect(html).toContain("document.getElementById('f').submit()");
    expect(html).toContain('&lt;b&gt;Map&lt;/b&gt;');
    expect(html).not.toContain('<b>Map</b>');
    expect(html).toContain('noindex');
  });

  it('a refused link shows why and carries no form', () => {
    const no: LinkOutcome = { ok: false, code: 'used', status: 410, title: 'This link was already used', message: 'Nothing was recorded.' };
    const html = inspectPage(no, 'tok.en');
    expect(html).not.toContain('<form');
    expect(html).toContain('Nothing was recorded.');
    expect(outcomePage(no)).toContain('This link was already used');
  });
});

describe('the plain-link page leads back to the report', () => {
  it('shows a back link for an https report page, escaped, and none otherwise', () => {
    const done: LinkOutcome = { ok: true, code: 'answered', status: 200, title: 'Recorded: Cards', message: 'Saved.', report_url: 'https://reports.becomeindelible.com/for-mike-x--t/?a=1&b=2' };
    const html = outcomePage(done);
    expect(html).toContain('>Back to the report</a>');
    expect(html).toContain('href="https://reports.becomeindelible.com/for-mike-x--t/?a=1&amp;b=2"');
    expect(outcomePage({ ...done, report_url: undefined })).not.toContain('Back to the report');
    expect(outcomePage({ ...done, report_url: 'javascript:alert(1)' })).not.toContain('Back to the report');
    expect(outcomePage({ ...done, report_url: 'https://x.test/"><script>' })).not.toContain('Back to the report');
  });
});

describe('which button shows as picked', () => {
  const open = { state: 'open', answer_option_id: null, held_for_chat_at: null };
  it('an option is picked only while it is the answer', () => {
    expect(isSelected({ kind: 'option', option_id: 'cards' }, { ...open, state: 'answered', answer_option_id: 'cards' })).toBe(true);
    expect(isSelected({ kind: 'option', option_id: 'table' }, { ...open, state: 'answered', answer_option_id: 'cards' })).toBe(false);
    expect(isSelected({ kind: 'option', option_id: 'cards' }, open)).toBe(false);
    // A recommendation that went ahead with nobody answering is not Mike's pick.
    expect(isSelected({ kind: 'option', option_id: 'cards' }, { ...open, state: 'defaulted', answer_option_id: 'cards' })).toBe(false);
  });
  it('talk it through is picked while the question is held and still open', () => {
    const held = { ...open, held_for_chat_at: new Date() };
    expect(isSelected({ kind: 'hold', option_id: null }, held)).toBe(true);
    expect(isSelected({ kind: 'hold', option_id: null }, open)).toBe(false);
    expect(isSelected({ kind: 'hold', option_id: null }, { ...held, state: 'answered', answer_option_id: 'cards' })).toBe(false);
  });
});

describe('calls from the report page', () => {
  it('only the reports site may read the answer', () => {
    expect(corsHeadersFor(REPORTS_ORIGIN)['Access-Control-Allow-Origin']).toBe('https://reports.becomeindelible.com');
    expect(corsHeadersFor('https://evil.test')['Access-Control-Allow-Origin']).toBeUndefined();
    expect(corsHeadersFor('https://reports.becomeindelible.com.evil.test')['Access-Control-Allow-Origin']).toBeUndefined();
    expect(corsHeadersFor(null)['Access-Control-Allow-Origin']).toBeUndefined();
    expect(corsHeadersFor(null).Vary).toBe('Origin');
  });

  it('a post may come from the reports site, Citadel itself, or no origin; never another site', () => {
    const own = ['citadel.becomeindelible.com'];
    expect(postOriginAllowed(REPORTS_ORIGIN, own)).toBe(true);
    expect(postOriginAllowed(null, own)).toBe(true);
    expect(postOriginAllowed('null', own)).toBe(true);
    expect(postOriginAllowed('https://citadel.becomeindelible.com', own)).toBe(true);
    expect(postOriginAllowed('https://evil.test', own)).toBe(false);
    expect(postOriginAllowed('http://reports.becomeindelible.com', own)).toBe(false);
    expect(postOriginAllowed('not a url', own)).toBe(false);
  });

  it('the route answers the preflight for the reports site only, and refuses a post from another site before reading the link', async () => {
    const pre = await OPTIONS(new NextRequest('http://localhost/api/question-links/x', { method: 'OPTIONS', headers: { origin: REPORTS_ORIGIN } }));
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBe(REPORTS_ORIGIN);
    expect(pre.headers.get('access-control-allow-methods')).toContain('POST');
    const other = await OPTIONS(new NextRequest('http://localhost/api/question-links/x', { method: 'OPTIONS', headers: { origin: 'https://evil.test' } }));
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
    expect(other.headers.get('access-control-allow-methods')).toBeNull();

    const r = await POST(
      new NextRequest('http://localhost/api/question-links/not-a-token', { method: 'POST', headers: { origin: 'https://evil.test', accept: 'application/json' } }),
      { params: Promise.resolve({ token: 'not-a-token' }) },
    );
    expect(r.status).toBe(403);
    expect(((await r.json()) as { code: string }).code).toBe('foreign_origin');
    expect(r.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('changing a tapped answer from the same report', () => {
  const at = new Date('2026-11-27T19:00:00.000Z');
  const answered = { state: 'answered', answer_option_id: 'a', answered_at: at };
  const link = { batch_id: 'b1', kind: 'option', option_id: 'c' };
  const db = (owner: { id: string } | null) => {
    const calls: unknown[] = [];
    return { calls, db: { questionAnswerLink: { findFirst: async (args: unknown) => { calls.push(args); return owner; } } } as never };
  };

  it('allows another option of the batch whose tap holds the answer, matching on the answer time', async () => {
    const d = db({ id: 'x' });
    expect(await mayChangeAnswer(d.db, link, answered)).toBe(true);
    expect(d.calls[0]).toMatchObject({ where: { batch_id: 'b1', kind: 'option', option_id: 'a', used_at: at, used_outcome: { in: ['answered', 'reanswered'] } } });
  });

  it('refuses when the answer came from elsewhere, the link is the answer already, a hold link, or the question is not answered', async () => {
    expect(await mayChangeAnswer(db(null).db, link, answered)).toBe(false);
    const never = db({ id: 'x' });
    expect(await mayChangeAnswer(never.db, { ...link, option_id: 'a' }, answered)).toBe(false);
    expect(await mayChangeAnswer(never.db, { ...link, kind: 'hold', option_id: null }, answered)).toBe(false);
    expect(await mayChangeAnswer(never.db, link, { ...answered, state: 'open' })).toBe(false);
    expect(await mayChangeAnswer(never.db, link, { ...answered, answered_at: null })).toBe(false);
    expect(never.calls).toHaveLength(0);
  });
});
