import { describe, it, expect } from 'vitest';
import {
  markdownToBlockNote,
  normalizeRichTextInput,
  serializeRichText,
} from '../blocknote';

describe('markdownToBlockNote', () => {
  it('converts a plain string into a single paragraph (never blank)', () => {
    const blocks = markdownToBlockNote('Just some plain text');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('paragraph');
    expect(blocks[0].content).toEqual([
      { type: 'text', text: 'Just some plain text', styles: {} },
    ]);
    expect(typeof blocks[0].id).toBe('string');
    // proven render shape omits `children`
    expect('children' in blocks[0]).toBe(false);
  });

  it('joins consecutive non-blank lines into one paragraph, splits on blank line', () => {
    const blocks = markdownToBlockNote('Line one\nLine two\n\nSecond para');
    expect(blocks).toHaveLength(2);
    expect(blocks[0].content[0]).toMatchObject({ text: 'Line one Line two' });
    expect(blocks[1].content[0]).toMatchObject({ text: 'Second para' });
  });

  it('converts headings and clamps levels above 3', () => {
    const blocks = markdownToBlockNote('# H1\n## H2\n### H3\n###### H6');
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'heading', 'heading', 'heading']);
    expect(blocks.map((b) => b.props?.level)).toEqual([1, 2, 3, 3]);
    expect(blocks[0].content[0]).toMatchObject({ text: 'H1' });
  });

  it('converts bullet lists (-, *, +)', () => {
    const blocks = markdownToBlockNote('- one\n* two\n+ three');
    expect(blocks.map((b) => b.type)).toEqual([
      'bulletListItem',
      'bulletListItem',
      'bulletListItem',
    ]);
    expect(blocks[2].content[0]).toMatchObject({ text: 'three' });
  });

  it('converts numbered lists (1. and 1))', () => {
    const blocks = markdownToBlockNote('1. first\n2) second');
    expect(blocks.map((b) => b.type)).toEqual(['numberedListItem', 'numberedListItem']);
    expect(blocks[1].content[0]).toMatchObject({ text: 'second' });
  });

  it('parses inline bold, italic, code and strikethrough', () => {
    const [block] = markdownToBlockNote('a **b** _c_ `d` ~~e~~');
    expect(block.content).toEqual([
      { type: 'text', text: 'a ', styles: {} },
      { type: 'text', text: 'b', styles: { bold: true } },
      { type: 'text', text: ' ', styles: {} },
      { type: 'text', text: 'c', styles: { italic: true } },
      { type: 'text', text: ' ', styles: {} },
      { type: 'text', text: 'd', styles: { code: true } },
      { type: 'text', text: ' ', styles: {} },
      { type: 'text', text: 'e', styles: { strike: true } },
    ]);
  });

  it('prefers bold over italic for ** markers', () => {
    const [block] = markdownToBlockNote('**bold**');
    expect(block.content).toEqual([{ type: 'text', text: 'bold', styles: { bold: true } }]);
  });

  it('parses links into BlockNote link inline content', () => {
    const [block] = markdownToBlockNote('see [the docs](https://example.com) now');
    expect(block.content).toEqual([
      { type: 'text', text: 'see ', styles: {} },
      {
        type: 'link',
        href: 'https://example.com',
        content: [{ type: 'text', text: 'the docs', styles: {} }],
      },
      { type: 'text', text: ' now', styles: {} },
    ]);
  });

  it('converts a fenced code block', () => {
    const blocks = markdownToBlockNote('```ts\nconst x = 1;\n```');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('codeBlock');
    expect(blocks[0].props).toEqual({ language: 'ts' });
    expect(blocks[0].content[0]).toMatchObject({ text: 'const x = 1;' });
  });

  it('handles a mixed document (heading + paragraph + list + bold)', () => {
    const md = '# Title\n\nIntro text with **emphasis**.\n\n- item a\n- item b';
    const blocks = markdownToBlockNote(md);
    expect(blocks.map((b) => b.type)).toEqual([
      'heading',
      'paragraph',
      'bulletListItem',
      'bulletListItem',
    ]);
  });

  it('returns a single empty paragraph for whitespace-only input', () => {
    const blocks = markdownToBlockNote('   ');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('paragraph');
  });
});

describe('normalizeRichTextInput', () => {
  it('returns null for null, undefined and empty string', () => {
    expect(normalizeRichTextInput(null)).toBeNull();
    expect(normalizeRichTextInput(undefined)).toBeNull();
    expect(normalizeRichTextInput('')).toBeNull();
    expect(normalizeRichTextInput('   ')).toBeNull();
  });

  it('passes through an existing BlockNote array unchanged (back-compat)', () => {
    const doc = [
      { id: 'x', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'hi', styles: {} }] },
    ];
    expect(normalizeRichTextInput(doc)).toBe(doc);
  });

  it('parses a JSON-stringified BlockNote array (back-compat)', () => {
    const doc = [{ id: 'x', type: 'paragraph', content: [] }];
    const result = normalizeRichTextInput(JSON.stringify(doc));
    expect(result).toEqual(doc);
  });

  it('treats a normal sentence as Markdown, not JSON', () => {
    const result = normalizeRichTextInput('Hello world');
    expect(Array.isArray(result)).toBe(true);
    expect(result[0].type).toBe('paragraph');
    expect(result[0].content[0].text).toBe('Hello world');
  });

  it('passes through a non-array object unchanged', () => {
    const tipTap = { type: 'doc', content: [] };
    expect(normalizeRichTextInput(tipTap)).toBe(tipTap);
  });
});

describe('serializeRichText', () => {
  it('returns null for empty input', () => {
    expect(serializeRichText(null)).toBeNull();
    expect(serializeRichText('')).toBeNull();
  });

  it('returns a JSON string that parses back to a BlockNote array', () => {
    const stored = serializeRichText('# Heading');
    expect(typeof stored).toBe('string');
    const parsed = JSON.parse(stored as string);
    expect(parsed[0].type).toBe('heading');
    expect(parsed[0].props.level).toBe(1);
  });

  it('round-trips a raw BlockNote array', () => {
    const doc = [{ id: 'a', type: 'paragraph', content: [{ type: 'text', text: 'x', styles: {} }] }];
    const stored = serializeRichText(doc);
    expect(JSON.parse(stored as string)).toEqual(doc);
  });
});
