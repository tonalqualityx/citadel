import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MessageText, linkify, safeHref, toBlocks } from '../MessageText';

describe('safeHref', () => {
  it('allows the app own paths and the three hosts', () => {
    expect(safeHref('/dashboard?view=overlook')).toEqual({ href: '/dashboard?view=overlook', external: false });
    expect(safeHref('https://citadel.becomeindelible.com/tasks/1')?.external).toBe(true);
    expect(safeHref('https://mail.google.com/mail/u/0/#inbox')).not.toBeNull();
    expect(safeHref('https://drive.google.com/drive/folders/x')).not.toBeNull();
  });
  it('refuses everything else', () => {
    for (const bad of [
      'https://evil.example/x.png',
      'http://citadel.becomeindelible.com/x',
      'https://citadel.becomeindelible.com.evil.example/x',
      'https://evil.example/https://citadel.becomeindelible.com',
      'https://user:pw@citadel.becomeindelible.com/',
      'https://citadel.becomeindelible.com:8443/',
      'javascript:alert(1)',
      '//evil.example/x',
      '/\\evil.example',
      'data:text/html,hi',
    ]) {
      expect(safeHref(bad), bad).toBeNull();
    }
  });
});

describe('MessageText', () => {
  it('shows HTML and markdown images as text, never as elements', () => {
    const { container } = render(<MessageText text={'<img src=x onerror=alert(1)> ![beacon](https://evil.example/p.png?q=secret)\n<script>x</script>'} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(container.textContent).toContain('https://evil.example/p.png?q=secret');
  });
  it('links only allowed addresses, and drops trailing punctuation', () => {
    const { container } = render(<MessageText text={'Open /dashboard. Or https://drive.google.com/drive/folders/abc, or https://evil.example/a.'} />);
    const links = [...container.querySelectorAll('a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/dashboard', 'https://drive.google.com/drive/folders/abc']);
    expect(links[1].getAttribute('rel')).toBe('noopener noreferrer');
    expect(container.textContent).toContain('https://evil.example/a.');
  });
  it('does not treat "and/or" as a path', () => {
    expect(linkify('this and/or that').every((p) => !p.href)).toBe(true);
  });
  it('keeps line breaks and simple lists', () => {
    expect(toBlocks('one\ntwo\n\n- a\n- b\n1. x')).toEqual([
      { type: 'p', lines: ['one', 'two'] },
      { type: 'ul', items: ['a', 'b'] },
      { type: 'ol', items: ['x'] },
    ]);
    const { container } = render(<MessageText text={'one\ntwo\n- a\n- b'} />);
    expect(container.querySelectorAll('br').length).toBe(1);
    expect(container.querySelectorAll('li').length).toBe(2);
  });
  it('does not render markdown emphasis or headings', () => {
    const { container } = render(<MessageText text={'# Title **bold**'} />);
    expect(container.querySelector('h1,strong,b')).toBeNull();
    expect(container.textContent).toBe('# Title **bold**');
  });
});
