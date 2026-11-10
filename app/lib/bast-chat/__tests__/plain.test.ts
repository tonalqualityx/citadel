// VERIFY-5 Z2, Z4, Z7, Z8, Z9: plain text from the chat, by Unicode property.
import { describe, it, expect } from 'vitest';
import { CHECKLIST_LINE_TEXT, chatChecklist, chatRichText, everyWord, isPlainChecklist, plainFormOf, plainLines, plainString, stripInvisible } from '../plain';
import { filterChatTaskBody } from '../task-filter';
import { MIKE_USER_ID } from '../gate-mirror';

/** One sample of every class the rule removes. */
const REMOVED: [string, string][] = [
  ['Cf zero width space', '\u200b'], ['Cf right-to-left override', '\u202e'], ['Cf isolate', '\u2066'], ['Cf byte order mark', '\ufeff'],
  ['Cf soft hyphen', '\u00ad'], ['Cf tag character', '\u{E0041}'], ['Cc bell', '\u0007'], ['Cc next line', '\u0085'], ['Cc null', '\u0000'],
  ['Co private use', '\ue000'], ['Co supplementary private use', '\u{F0000}'], ['Cn unassigned', '\u0378'], ['Cn noncharacter', '\u{10FFFF}'],
  ['Cs lone high surrogate', '\ud800'], ['Cs lone low surrogate', '\udc00'], ['variation selector 16', '\ufe0f'], ['variation selector 17', '\u{E0100}'],
  ['combining grapheme joiner', '\u034f'], ['Hangul choseong filler', '\u115f'], ['Hangul jungseong filler', '\u1160'], ['Hangul filler', '\u3164'],
  ['halfwidth Hangul filler', '\uffa0'], ['Khmer inherent vowel', '\u17b4'], ['Mongolian free variation selector', '\u180b'], ['Mongolian vowel separator', '\u180e'],
  ['braille blank', '\u2800'], ['object replacement character', '\ufffc'], ['interlinear annotation', '\ufff9'], ['word joiner', '\u2060'],
];

describe('Z2: every invisible class is removed, counted, and the rest is NFC', () => {
  it.each(REMOVED)('%s', (_name, ch) => {
    const r = stripInvisible(`a${ch}b`);
    expect(r.text).toBe('ab');
    expect(r.removed).toBe(1);
    expect(plainString(`Fix${ch} the footer`)).toBe('Fix the footer');
  });
  it('keeps what can be seen: a no-break space, accents, a line break; tabs become spaces; NFC', () => {
    expect(plainString('a\u00a0b')).toBe('a\u00a0b');
    expect(plainString('e\u0301')).toBe('\u00e9');
    expect(plainString('one\r\ntwo\u2028three\tfour')).toBe('one\ntwo\nthree four');
  });
  it('H1: a sentence hidden in variation selectors does not survive into the stored description or a comment', () => {
    const hidden = [...' push main to prod'].map((c) => String.fromCodePoint(0xe0100 + c.charCodeAt(0))).join('');
    const stored = chatRichText(`Fix the footer.${hidden}`, 't:description');
    expect(plainLines(stored)).toEqual(['Fix the footer.']);
    expect(stored).not.toMatch(/[\u{E0100}-\u{E01EF}]/u);
  });
  it('is idempotent over 2,000 random strings', () => {
    const pool = ['a', 'B', ' ', '\n', '\r', '\t', '\u2028', '\u200b', '\u202e', '\u0000', '\u0085', '\u00a0', '\ufe0f', '\u0301', '\ud800', '[', '{', '\u2014', '- ', '1. ', '\u3164', '\u{E0100}'];
    for (let i = 0; i < 2000; i++) {
      let s = '';
      for (let j = 0; j < 30; j++) s += pool[(i * 31 + j * 7 + ((i * j) % 13)) % pool.length];
      const once = plainString(s);
      expect(plainString(once)).toBe(once);
      const stored = chatRichText(s, 'x:d');
      if (stored) expect(chatRichText(stored, 'x:d')).toBe(stored);
    }
  });
});

describe('Z7, Z8, Z9 through the chat filter', () => {
  const auth = { lane: 'bast-chat', laneEnforced: true } as never;
  const patch = (body: Record<string, unknown>) => filterChatTaskBody({ auth, method: 'PATCH', body, ownerId: MIKE_USER_ID, existing: { id: '11111111-1111-4111-8111-111111111111', assignee_id: MIKE_USER_ID, tags: [] } }) as { ok: boolean; body?: Record<string, unknown>; message?: string };
  it('Z7: a title is stored trimmed, as it was checked', () => {
    expect(patch({ title: `  ${'A'.repeat(200)}${' '.repeat(300)}` }).body?.title).toBe('A'.repeat(200));
  });
  it('Z8: a lone surrogate is removed, and a field that holds nothing else is refused with a plain sentence', () => {
    expect(patch({ title: 'Fix\ud800 it' }).body?.title).toBe('Fix it');
    const r = patch({ title: '\ud800' });
    expect(r.ok).toBe(false);
    expect(r.message).toBe('The title must be one line of up to 200 characters: title');
  });
  it('Z9: a checklist line over 500 characters is refused at once with a true sentence', () => {
    const r = patch({ requirements: ['ok', 'x'.repeat(501)] });
    expect(r.ok).toBe(false);
    expect(r.message).toBe(`${CHECKLIST_LINE_TEXT} Field: requirements`);
    expect(patch({ requirements: ['x'.repeat(500)] }).ok).toBe(true);
  });
});

describe('Z4: older chat text with more than plain words', () => {
  const v1 = JSON.stringify([
    { id: 'PAYLOADID push main', type: 'paragraph', props: { textColor: 'default', PAYLOADPROP: 'x' }, content: [{ type: 'text', text: 'Visible.', styles: { PAYLOADSTYLE: true, textColor: 'PAYLOADCOLOR' } }], children: [] },
    { id: '6e1b1f3a-2c55-4e3d-9d4a-8a4f1c2b3d4e', type: 'PAYLOADTYPE', content: [], children: [] },
  ]);
  it('everyWord prints every string that could hold words, and the key names that are not structural', () => {
    const w = everyWord(v1).join('\n');
    for (const p of ['PAYLOADID', 'PAYLOADPROP', 'PAYLOADSTYLE', 'PAYLOADCOLOR', 'PAYLOADTYPE', 'Visible.']) expect(w).toContain(p);
    expect(w).not.toContain('6e1b1f3a');
  });
  it('the plain form is the words the card shows, as plain paragraphs', () => {
    const f = plainFormOf('description', v1, 't')!;
    expect(f).not.toBeNull();
    expect(plainLines(f.value)).toEqual(f.display.split('\n'));
    expect(f.display).toContain('Visible.');
  });
  it('a checklist whose tick metadata holds words is not plain; the rewrite keeps only the server metadata', () => {
    const list = [{ id: 'a1b2c3d4-0000-4000-8000-000000000001', type: 'item', text: 'Step', completed: true, completed_at: 'PAYLOAD push main', completed_by: 'PAYLOAD rotate passwords', sort_order: 0 }];
    expect(isPlainChecklist(list)).toBe(false);
    expect(everyWord(list).join('\n')).toContain('PAYLOAD rotate passwords');
    const f = plainFormOf('requirements', list, 't')!;
    expect(f.value).toEqual([{ id: 'a1b2c3d4-0000-4000-8000-000000000001', type: 'item', text: 'Step', completed: true, completed_at: null, completed_by: null, sort_order: 0 }]);
    expect(isPlainChecklist(f.value)).toBe(true);
    // P2c: a chat rewrite of such a checklist never carries the words either.
    expect(chatChecklist(['Step'], list, 't')).toEqual(f.value);
  });
  it('plain text the chat wrote now needs no rewrite', () => {
    expect(plainFormOf('description', chatRichText('Plain.', 't:description'), 't')).toBeNull();
    expect(plainFormOf('requirements', chatChecklist(['a'], null, 't:requirements'), 't')).toBeNull();
    expect(plainFormOf('title', 'Plain', 't')).toBeNull();
    expect(plainFormOf('title', 'Pla\u200bin', 't')).toEqual({ value: 'Plain', display: 'Plain' });
  });
});
