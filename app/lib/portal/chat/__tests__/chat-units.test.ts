import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { PROMISES } from '@/lib/portal/intake/promises';
import { bastWordError } from '@/lib/portal/thread';
import { allChatStrings, CANNED_LINE, HANDOFF_BANNER } from '@/lib/portal/chat/copy';
import { isUrgentText } from '@/lib/portal/chat/urgent';
import { foldAnswer, nextTreeStep } from '@/lib/portal/chat/tree-mode';
import { provisionalTitle } from '@/lib/portal/chat/file-early';
import { rankPages } from '@/lib/portal/chat/slots';

describe('chat copy', () => {
  const strings = allChatStrings();
  it('has strings', () => expect(strings.length).toBeGreaterThan(30));
  it('carries no promise, no dash and not the name Bast', () => {
    for (const s of strings) {
      for (const [name, re] of PROMISES) expect(re.test(s), `${name}: ${s}`).toBe(false);
      expect(/—|–|&mdash;|&ndash;|(^|\s)-(\s|$)/.test(s), `dash: ${s}`).toBe(false);
      expect(bastWordError(s), s).toBeNull();
      expect(/!/.test(s), `exclamation: ${s}`).toBe(false);
    }
  });
  it('keeps the canned line and banner word for word', () => {
    expect(CANNED_LINE).toBe('A person on the team will read this and reply here.');
    expect(HANDOFF_BANNER).toBe('A person on the team will reply here. You can keep adding details while you wait.');
  });
  it('voice.md is clean too', () => {
    const voice = fs.readFileSync('/home/mike/.claude/tools/portal-chat/prompts/voice.md', 'utf8').split('\n').filter((l) => l.startsWith('- '));
    for (const line of voice) expect(/—|–/.test(line), line).toBe(false);
  });
});

describe('the keyword emergency rule', () => {
  it.each([
    'our site is down',
    'The website is down right now',
    "I can't check out",
    'checkout is broken',
    'we got hacked',
    'payments are failing',
    'the contact form is not sending',
    'site down!!',
  ])('flags %s', (t) => expect(isUrgentText(t)).toBe(true));
  it.each(['Can you add this picture to the website?', 'Please update the hours on the contact page', 'How many visitors last month?', 'The down payment invoice is paid?'])('leaves %s', (t) =>
    expect(isUrgentText(t)).toBe(false)
  );
});

describe('tree mode steps', () => {
  const pages = [
    { id: 'p1', title: 'Home', path: '/', depth: 0, sections: [] },
    { id: 'p2', title: 'About', path: '/about/', depth: 1, sections: [{ key: 'team', heading: 'The team' }] },
  ];
  it('asks the type first, then the site, then the page, then the section, then summarises', () => {
    let slots = { change: 'fix the opening hours' } as Parameters<typeof nextTreeStep>[0]['slots'];
    let step = nextTreeStep({ slots, siteCount: 2, pages, siteId: null });
    expect(step).toMatchObject({ kind: 'ask', ask: { slot: 'other' } });
    slots = foldAnswer(slots, null, { choice: { slot: 'other', id: 'site_change' } }, { pages, textFills: true });
    step = nextTreeStep({ slots, siteCount: 2, pages, siteId: null });
    expect(step).toMatchObject({ kind: 'ask', ask: { slot: 'site' } });
    slots = foldAnswer(slots, null, { choice: { slot: 'site', id: 's1' } }, { pages, textFills: true });
    step = nextTreeStep({ slots, siteCount: 2, pages, siteId: 's1' });
    expect(step).toMatchObject({ kind: 'ask', ask: { slot: 'page' } });
    slots = foldAnswer(slots, null, { choice: { slot: 'page', id: 'p2' } }, { pages, textFills: true });
    step = nextTreeStep({ slots, siteCount: 2, pages, siteId: 's1' });
    expect(step).toMatchObject({ kind: 'ask', ask: { slot: 'section', choice_ids: ['team'] } });
    slots = foldAnswer(slots, null, { choice: { slot: 'section', id: 'team' } }, { pages, textFills: true });
    expect(nextTreeStep({ slots, siteCount: 2, pages, siteId: 's1' })).toEqual({ kind: 'summary' });
  });
  it('asks for the file only when the words mention one', () => {
    const slots = { change: 'swap the headshot photo', request_type: 'site_change' as const, site_id: 's', page_id: 'p2', section_key: 'team' };
    expect(nextTreeStep({ slots, siteCount: 1, pages, siteId: 's' })).toMatchObject({ kind: 'ask', ask: { slot: 'asset', allow_upload: true } });
    expect(nextTreeStep({ slots: { ...slots, asset_none: true }, siteCount: 1, pages, siteId: 's' })).toEqual({ kind: 'summary' });
    expect(nextTreeStep({ slots: { ...slots, change: 'fix a typo' }, siteCount: 1, pages, siteId: 's' })).toEqual({ kind: 'summary' });
  });
  it('never asks one slot a third time ("not sure" moves on)', () => {
    const slots = { change: 'x', request_type: 'other' as const, asked: ['page', 'page'] };
    expect(nextTreeStep({ slots, siteCount: 1, pages, siteId: 's' })).toEqual({ kind: 'summary' });
  });
  it('words fill the open ask only in tree mode', () => {
    const ask = { slot: 'page' as const, question: 'q', choice_ids: [], allow_free_text: true, allow_upload: false };
    expect(foldAnswer({}, ask, { text: 'The pricing page' }, { pages, textFills: true }).page_text).toBe('The pricing page');
    expect(foldAnswer({}, ask, { text: 'about' }, { pages, textFills: true }).page_id).toBe('p2');
    expect(foldAnswer({}, ask, { text: 'The pricing page' }, { pages, textFills: false }).page_text).toBeUndefined();
  });
  it('a choice always counts, and not sure records not sure', () => {
    expect(foldAnswer({}, null, { choice: { slot: 'page', id: 'not_sure' } }, { pages, textFills: false }).page_text).toBe('Not sure');
    expect(foldAnswer({}, null, { choice: { slot: 'page', id: 'another_page' } }, { pages, textFills: false }).page_id).toBeUndefined();
  });
});

describe('small helpers', () => {
  it('cuts the provisional title at a word, within 80 characters', () => {
    const t = provisionalTitle('Can you please add this lovely picture of our new bakery staff to the website somewhere on a page that makes sense');
    expect(t.length).toBeLessThanOrEqual(80);
    expect(t.startsWith('Request: ')).toBe(true);
    expect(t.endsWith('…')).toBe(true);
    expect(provisionalTitle('Short one')).toBe('Request: Short one');
  });
  it('ranks pages by words in the message', () => {
    const r = rankPages([{ title: 'Home', path: '/', depth: 0 }, { title: 'Catering', path: '/catering/', depth: 1 }], 'a catering menu photo');
    expect(r[0].title).toBe('Catering');
  });
});
