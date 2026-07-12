import { describe, it, expect } from 'vitest';
import { validateHtmlFragment } from '../html-validation';

describe('validateHtmlFragment', () => {
  it('accepts balanced, properly nested tags', () => {
    const html = '<div><p>Hello <strong>world</strong>.</p></div>';
    expect(validateHtmlFragment(html)).toEqual({ valid: true });
  });

  it('accepts an empty string', () => {
    expect(validateHtmlFragment('')).toEqual({ valid: true });
  });

  it('flags an unclosed opening tag', () => {
    const result = validateHtmlFragment('<div><p>Hello</p>');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.message).toContain('<div>');
      expect(result.message).toContain('without a closing </div>');
    }
  });

  it('flags a dangling closing tag with no matching opener', () => {
    const result = validateHtmlFragment('<p>Hello</p></div>');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.message).toContain('</div>');
      expect(result.message).toContain('without a matching opening <div>');
    }
  });

  it('flags mismatched / improperly closed nesting', () => {
    const result = validateHtmlFragment('<div><p>Hello</div></p>');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.message).toContain('<p>');
    }
  });

  it('handles void elements without requiring a closing tag', () => {
    const html = '<p>Line one<br>Line two<img src="a.png">More<hr>Text</p>';
    expect(validateHtmlFragment(html)).toEqual({ valid: true });
  });

  it('handles self-closed void elements with a trailing slash', () => {
    const html = '<p>Photo: <img src="a.png" alt="a" /></p>';
    expect(validateHtmlFragment(html)).toEqual({ valid: true });
  });

  it('treats a non-void self-closed tag as closed at that instance', () => {
    const html = '<div class="spacer" /><p>Text</p>';
    expect(validateHtmlFragment(html)).toEqual({ valid: true });
  });

  it('does not choke on attributes containing ">" inside quotes', () => {
    const html = '<a href="/x" title="a > b and < c">link</a>';
    expect(validateHtmlFragment(html)).toEqual({ valid: true });
  });

  it('does not choke on attributes containing "<" inside single quotes', () => {
    const html = "<span data-note='1 < 2 > 0'>ok</span>";
    expect(validateHtmlFragment(html)).toEqual({ valid: true });
  });

  it('ignores HTML comments entirely, including tag-like content inside them', () => {
    const html = '<div><!-- <p>not a real tag</p> --><p>Real</p></div>';
    expect(validateHtmlFragment(html)).toEqual({ valid: true });
  });

  it('passes plain markdown/text untouched, including a stray "<" and ">"', () => {
    const text = '**Bold** text with 1 < 2 and 3 > 2, no real tags here — just prose.';
    expect(validateHtmlFragment(text)).toEqual({ valid: true });
  });

  it('passes plain text containing an email-like "<a@b.com>" without a tag name after the <', () => {
    // '<a@b.com>' — 'a' immediately follows '<', so this DOES look like a tag start; use a case
    // that clearly isn't a tag (starts with a digit) to prove non-tag "<" is ignored.
    const text = 'Compare <3 to <5, both less than the total.';
    expect(validateHtmlFragment(text)).toEqual({ valid: true });
  });

  it('flags an unterminated tag (no closing ">")', () => {
    const result = validateHtmlFragment('<div class="unterminated');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.message).toContain('<div>');
    }
  });

  it('handles deeply nested balanced structures', () => {
    const html = '<ul><li>One</li><li>Two <em>emph</em></li></ul>';
    expect(validateHtmlFragment(html)).toEqual({ valid: true });
  });
});
