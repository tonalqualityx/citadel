// @vitest-environment node
/** The signing half of answer links, and the pages: no database. */
import { describe, it, expect, beforeAll } from 'vitest';
import { tokenFor, verifyToken, wordingHash, inspectPage, outcomePage, mayMintLinks, type LinkOutcome } from '../answer-links';
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
