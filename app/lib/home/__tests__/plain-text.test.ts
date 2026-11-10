import { describe, it, expect } from 'vitest';
import { serializeRichText, markdownToBlockNote } from '@/lib/api/blocknote';
import { cardSummary, firstParagraph, richTextToParagraphs, toPlainText, truncateWords } from '../plain-text';

const words = (n: number, w = 'word') => Array.from({ length: n }, (_, i) => `${w}${i + 1}`).join(' ');

describe('richTextToParagraphs: BlockNote', () => {
  it('reads a stored description (JSON string written by serializeRichText)', () => {
    const stored = serializeRichText('# Context\n\nThe **footer** has a [hidden link](https://x.example).\n\n- Remove it\n- Scan the site');
    expect(typeof stored).toBe('string');
    expect(richTextToParagraphs(stored)).toEqual([
      { text: 'Context', heading: true },
      { text: 'The footer has a hidden link.', heading: false },
      { text: 'Remove it', heading: false },
      { text: 'Scan the site', heading: false },
    ]);
  });

  it('reads a block array directly, nested children included, empty blocks dropped', () => {
    const blocks = [
      { id: '1', type: 'paragraph', content: [{ type: 'text', text: 'Top', styles: {} }], children: [
        { id: '2', type: 'bulletListItem', content: [{ type: 'text', text: 'Child', styles: {} }] },
      ] },
      { id: '3', type: 'paragraph', content: [] },
      { id: '4', type: 'paragraph', content: [{ type: 'link', href: 'https://a', content: [{ type: 'text', text: 'Link text', styles: {} }] }] },
    ];
    expect(richTextToParagraphs(blocks).map((p) => p.text)).toEqual(['Top', 'Child', 'Link text']);
  });

  it('reads table content cell by cell', () => {
    const blocks = [
      {
        id: 't',
        type: 'table',
        content: {
          type: 'tableContent',
          rows: [
            { cells: [[{ type: 'text', text: 'A1', styles: {} }], [{ type: 'text', text: 'B1', styles: {} }]] },
            { cells: [{ type: 'tableCell', content: [{ type: 'text', text: 'A2', styles: {} }] }] },
          ],
        },
      },
    ];
    expect(toPlainText(blocks)).toBe('A1 B1 A2');
  });

  it('collapses whitespace inside a block', () => {
    const blocks = [{ id: '1', type: 'paragraph', content: [{ type: 'text', text: '  a\n\n b\tc  ', styles: {} }] }];
    expect(toPlainText(blocks)).toBe('a b c');
  });

  it('ignores junk entries in a block array', () => {
    expect(toPlainText([null, 3, [], { type: 'paragraph' }, 'loose string'])).toBe('loose string');
  });
});

describe('richTextToParagraphs: TipTap and text', () => {
  it('reads a TipTap document object', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'One' }, { type: 'hardBreak' }, { type: 'text', text: 'two' }] },
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Item' }] }] }] },
      ],
    };
    expect(richTextToParagraphs(doc)).toEqual([
      { text: 'Title', heading: true },
      { text: 'One two', heading: false },
      { text: 'Item', heading: false },
    ]);
    expect(toPlainText(JSON.stringify(doc))).toBe('Title\n\nOne two\n\nItem');
  });

  it('reads plain text and light Markdown', () => {
    const md = '## Why\nLine one\nline two with `code` and *stress*.\n\n1. First\n* Second\n\n> quoted words\n\n```\nconst x = 1;\n```';
    expect(richTextToParagraphs(md)).toEqual([
      { text: 'Why', heading: true },
      { text: 'Line one line two with code and stress.', heading: false },
      { text: 'First', heading: false },
      { text: 'Second', heading: false },
      { text: 'quoted words', heading: false },
      { text: 'const x = 1;', heading: false },
    ]);
  });

  it('treats text that only looks like JSON as text', () => {
    expect(toPlainText('[not json] at all')).toBe('[not json] at all');
    expect(toPlainText('{broken')).toBe('{broken');
  });

  it('returns nothing for empty or unreadable values', () => {
    for (const v of [null, undefined, '', '   ', [], {}, '[]', '{}']) {
      expect(richTextToParagraphs(v)).toEqual([]);
      expect(toPlainText(v)).toBe('');
      expect(firstParagraph(v)).toBe('');
      expect(cardSummary(v)).toBe('');
    }
  });

  it('survives deeply nested input without throwing', () => {
    let node: Record<string, unknown> = { type: 'text', text: 'deep' };
    for (let i = 0; i < 200; i++) node = { type: 'wrap', content: [node] };
    expect(() => richTextToParagraphs({ type: 'doc', content: [node] })).not.toThrow();
  });
});

describe('firstParagraph', () => {
  it('skips a leading heading in favour of the first body paragraph', () => {
    expect(firstParagraph(markdownToBlockNote('# Context\n\nThe real summary.\n\nMore.'))).toBe('The real summary.');
  });

  it('falls back to a heading when that is all there is', () => {
    expect(firstParagraph('# Only a heading')).toBe('Only a heading');
  });

  it('takes a list item when the description is only a list', () => {
    expect(firstParagraph('- Step one\n- Step two')).toBe('Step one');
  });
});

describe('truncateWords and cardSummary', () => {
  it('leaves 60 words or fewer alone', () => {
    const t = words(60);
    expect(truncateWords(t)).toBe(t);
  });

  it('cuts at 60 words on a word boundary and adds an ellipsis', () => {
    const out = truncateWords(words(61));
    expect(out).toBe(`${words(60)}…`);
    expect(out.replace('…', '').split(' ')).toHaveLength(60);
  });

  it('drops trailing punctuation before the ellipsis', () => {
    expect(truncateWords('one, two; three: four five', 3)).toBe('one, two; three…');
  });

  it('honours a custom limit and collapses whitespace', () => {
    expect(truncateWords('  a   b\n c d ', 2)).toBe('a b…');
    expect(truncateWords('  a   b ', 5)).toBe('a b');
  });

  it('never adds an em dash or en dash', () => {
    expect(truncateWords(words(100))).not.toMatch(/[–—]/);
  });

  it('cardSummary is the first body paragraph, truncated', () => {
    const stored = serializeRichText(`# Heading\n\n${words(80)}\n\nSecond paragraph.`);
    expect(cardSummary(stored)).toBe(`${words(60)}…`);
    expect(cardSummary('Short one.')).toBe('Short one.');
  });
});
