import { describe, expect, it } from 'vitest';
import { distinctiveTokens, gateReply, nameTokens, type GateContext } from '@/lib/portal/chat/gate';
import { isCommonWord } from '@/lib/portal/chat/common-words';
import { buildProvenance } from '@/lib/portal/chat/provenance';
import fixture from './fixtures/client-names.json';

/** Display names from the production client list (GET /api/clients, names only), written 2026-10-21. */
const NAMES: string[] = fixture.names;

const ctx = (over: Partial<GateContext> = {}): GateContext => ({
  provenance: buildProvenance([]),
  staffNames: ['Mike', 'Ashlei', 'Sabeen'],
  otherClientNames: NAMES,
  clientDomains: ['maplestreetbakery.com'],
  portalOrigins: ['https://citadel.becomeindelible.com'],
  reportUrls: [],
  contactEmail: 'dana@maplestreetbakery.com',
  pageNames: ['Home', 'About'],
  ...over,
});

describe('other-client name rule: ordinary words pass', () => {
  const MUST_PASS = [
    'Is this for the first section?',
    'Which page is the gallery page?',
    'Do you mean your house style?',
    'Is that the grace period text?',
    'Should it sit north of the header?',
    'Is this the standard plan page?',
    'Which star rating goes in the footer?',
    'Is the trail map on the Home page?',
    'Should the white button go in the valley section?',
  ];
  for (const t of MUST_PASS) {
    it(`passes: ${t}`, () => {
      expect(gateReply(t, ctx())).toEqual({ ok: true });
    });
  }
});

describe('other-client name rule: real client names fail', () => {
  const pick = (needle: string) => NAMES.find((n) => n.toLowerCase().includes(needle))!;
  const THREE = [pick('abbott septic'), pick('crown point builders'), pick('first congregational')];
  it('the fixture holds the three names', () => {
    for (const n of THREE) expect(n).toBeTruthy();
  });
  for (const full of THREE) {
    it(`full name fails: ${full}`, () => {
      const r = gateReply(`${full} asked for that too.`, ctx());
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.rule).toBe('name');
    });
  }
  it('a distinctive single word still fails', () => {
    for (const t of ['Abbott had the same request.', 'The Bootleggers site has this.', 'Thermalnetics asked too.', 'Quorionis is in the same boat.']) {
      const r = gateReply(t, ctx());
      expect(r.ok, t).toBe(false);
    }
  });
  it('a brand slug and domain fail', () => {
    const c = ctx({ otherClientNames: ['Herba Re-Leaf'], otherClientDomains: ['herbapumps.com'] });
    for (const t of ['Herbapumps had the same request.', 'That matches herbapumps.com.']) {
      expect(gateReply(t, c).ok, t).toBe(false);
    }
    expect(gateReply('The Herba Re-Leaf request is similar.', c).ok).toBe(false);
  });
  it('a multi-word name written as one coined word fails', () => {
    expect(gateReply('CrownPointBuilders asked too.', ctx()).ok).toBe(false);
  });
});

describe('own name is always allowed; Mike in a quoted client phrase', () => {
  it('the signed-in client may be named, even where another client shares a word', () => {
    const c = ctx({ otherClientNames: ['Crown Point Contracting'], ownClientNames: ['Crown Point Builders'] });
    expect(gateReply('Crown Point Builders is the name on the header.', c)).toEqual({ ok: true });
  });
  it('own distinctive word allowed while another client shares it', () => {
    const c = ctx({ otherClientNames: ['Griffin Construction', 'Griffin Roofing'], ownClientNames: ['Griffin Construction'] });
    expect(gateReply('Griffin is in the footer text.', c)).toEqual({ ok: true });
    expect(gateReply('Griffin Roofing is another account.', c).ok).toBe(false);
  });
  it('staff first names still fail', () => {
    for (const n of ['Mike', 'Sabeen', 'Nils', 'Ange']) expect(gateReply(`${n} will see it.`, ctx()).ok, n).toBe(false);
  });
  it('Mike inside a quoted phrase of the client\'s own name passes, outside it fails', () => {
    const c = ctx({ otherClientNames: ['Abbott Septic Service'], ownClientNames: ['Mike Lynn Photography'] });
    expect(gateReply('Is "Mike Lynn Photography" the name for the header?', c)).toEqual({ ok: true });
    expect(gateReply('Mike will look at the header.', c).ok).toBe(false);
  });
  it('Mike inside a quote the client wrote passes', () => {
    const c = ctx({ provenance: buildProvenance([], [], ["Add \"Mike's Bikes\" to the header"]) });
    expect(gateReply('You wrote "Mike\'s Bikes". Which page is the header on?', c)).toEqual({ ok: true });
  });
  it('the company name Indelible is not another client', () => {
    expect(gateReply("I'm Indelible's assistant. Which page should it go on?", ctx())).toEqual({ ok: true });
  });
});

describe('production client list: no common English word trips the rule alone', () => {
  // Reviewed 2026-10-21: every token that may match on its own. A new client whose word is not on this list
  // fails the test until someone decides it is distinctive (add it here) or common (add it to common-words.ts).
  const REVIEWED_DISTINCTIVE = new Set(
    'abbott aiccok alder ashley avis benton bethany bootleggers bpatist bric brockberry calvary clint fenton gaughan globele griffin griswold hennessey herba heron jills johnson lynn marcia meidl mike mitch munroe peisch pixidon plyler quorionis roberts rogues sapcc socal springfield stankard thermalnetics trinity uplands urns viscc winterstone'.split(' ')
  );
  it('every distinctive token is reviewed and none is a common word', () => {
    for (const n of NAMES) {
      for (const t of distinctiveTokens(n)) {
        expect(isCommonWord(t), `${t} (${n}) is common`).toBe(false);
        expect(t.length).toBeGreaterThanOrEqual(4);
        expect(REVIEWED_DISTINCTIVE.has(t), `${t} (${n}) is not reviewed`).toBe(true);
      }
    }
  });
  it('every other token of every name passes alone', () => {
    let checked = 0;
    for (const n of NAMES) {
      const distinct = new Set(distinctiveTokens(n));
      for (const t of nameTokens(n)) {
        if (distinct.has(t)) continue;
        // Other clients' distinctive words are out of scope: only this name is loaded.
        const r = gateReply(`Is it about the ${t}?`, ctx({ otherClientNames: [n] }));
        expect(r.ok === false && r.rule === 'name', `${t} (${n}) tripped the name rule`).toBe(false);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
  it('the fixture is the production list', () => {
    expect(NAMES.length).toBeGreaterThanOrEqual(60);
  });
});
