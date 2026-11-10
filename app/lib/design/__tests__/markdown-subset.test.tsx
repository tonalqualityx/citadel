import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MarkdownSubset, MAX_MARKDOWN_CHARS, safeHttpsUrl } from '../markdown-subset';

const html = (md: string) => render(<MarkdownSubset source={md} />).container;

describe('markdown subset: allowed constructs', () => {
  it('paragraphs, with soft line breaks joined', () => {
    const c = html('First line\nsecond line\n\nNext paragraph');
    const ps = c.querySelectorAll('p');
    expect(ps).toHaveLength(2);
    expect(ps[0].textContent).toBe('First line second line');
  });
  it('unordered and ordered lists', () => {
    const c = html('- one\n- two\n\n1. a\n2. b\n3. c');
    expect(c.querySelectorAll('ul > li')).toHaveLength(2);
    expect(c.querySelectorAll('ol > li')).toHaveLength(3);
  });
  it('bold and italics, both markers', () => {
    const c = html('**bold** and *ital* and _under_');
    expect(c.querySelector('strong')?.textContent).toBe('bold');
    expect([...c.querySelectorAll('em')].map((e) => e.textContent)).toEqual(['ital', 'under']);
  });
  it('nested emphasis', () => {
    const c = html('**bold with *italic* inside** and *ital with **bold** inside*');
    expect(c.querySelector('strong em')?.textContent).toBe('italic');
    expect(c.querySelector('em strong')?.textContent).toBe('bold');
  });
  it('snake_case words are not italicised', () => {
    expect(html('use snake_case_name here').querySelector('em')).toBeNull();
  });
  it('headings h3 and h4 only; other levels stay text', () => {
    const c = html('### Three\n#### Four\n## Two\n# One');
    expect(c.querySelector('h3')?.textContent).toBe('Three');
    expect(c.querySelector('h4')?.textContent).toBe('Four');
    expect(c.querySelector('h1,h2')).toBeNull();
    expect(c.textContent).toContain('## Two');
  });
  it('an https link opens safely in a new tab, emphasis allowed in its label', () => {
    const a = html('see [the **guide**](https://example.com/a?b=1) now').querySelector('a')!;
    expect(a.getAttribute('href')).toBe('https://example.com/a?b=1');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    expect(a.querySelector('strong')?.textContent).toBe('guide');
  });
});

describe('markdown subset: refused links render as plain text', () => {
  const refused = [
    'javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,hi',
    'http://example.com', '//example.com/x', '/relative/path', 'relative.html', 'https://user:pw@example.com/',
    'https://user@example.com/', 'https://exa mple.com', 'https://example.com/\u0001x', 'https:/example.com',
    'https:\\\\example.com', 'https://', 'vbscript:x', 'ftp://example.com', ' https://example.com',
  ];
  it.each(refused)('%j', (u) => {
    const c = html(`[click](${u})`);
    expect(c.querySelector('a')).toBeNull();
    expect(c.textContent).toContain('click');
    expect(safeHttpsUrl(u)).toBeNull();
  });
  it('an unclosed link is text', () => {
    const c = html('[click](https://example.com');
    expect(c.querySelector('a')).toBeNull();
    expect(c.textContent).toBe('[click](https://example.com');
  });
});

describe('markdown subset: raw HTML is text', () => {
  it.each([
    '<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '<iframe src="https://evil.example"></iframe>',
    '<a href="javascript:alert(1)">x</a>', '<style>*{display:none}</style>',
  ])('%s', (raw) => {
    const c = html(`before ${raw} after\n\n- ${raw}\n\n### ${raw}`);
    expect(c.querySelector('script,img,iframe,style,a')).toBeNull();
    expect(c.textContent).toContain(raw);
  });
});

describe('markdown subset: bounds', () => {
  it('truncates over the limit and says so', () => {
    const c = html('a'.repeat(MAX_MARKDOWN_CHARS + 500));
    expect(c.querySelector('p')!.textContent!.length).toBe(MAX_MARKDOWN_CHARS);
    expect(c.querySelector('[data-testid="markdown-truncated"]')).not.toBeNull();
  });
  it('does not note truncation at exactly the limit', () => {
    expect(html('a'.repeat(MAX_MARKDOWN_CHARS)).querySelector('[data-testid="markdown-truncated"]')).toBeNull();
  });
  const shapes: Record<string, string> = {
    'stars': '*'.repeat(20_000),
    'double stars': '**'.repeat(10_000),
    'open brackets': '['.repeat(20_000),
    'brackets then close': `${'['.repeat(19_000)}](`,
    'unclosed links': '[a](https://x.example/'.repeat(900),
    'underscores': '_a'.repeat(10_000),
    'mixed': '***_*[**'.repeat(2_500),
    'nested depth': `${'*a **b '.repeat(2_000)}`,
    'long list': '- x\n'.repeat(5_000),
    'hashes': '#'.repeat(20_000),
    'spaces': ' '.repeat(20_000) + 'x',
  };
  it.each(Object.keys(shapes))('pathological input %s finishes under 200 ms', (name) => {
    const t = performance.now();
    const c = html(shapes[name]);
    const ms = performance.now() - t;
    expect(c).toBeTruthy();
    expect(ms).toBeLessThan(200);
  });
});
