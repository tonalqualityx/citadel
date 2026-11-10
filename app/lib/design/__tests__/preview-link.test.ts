import { describe, it, expect } from 'vitest';
import { buildPreviewLink, buildSiteLink, cleanPreviewPath } from '../preview-link';

const BASE = 'https://design-t-abcd2345abcd2345.vcdp.pages.dev';

describe('buildPreviewLink', () => {
  it('builds a link on the alias and drops query and hash', () => {
    expect(buildPreviewLink(BASE, '/about/')).toBe(`${BASE}/about/`);
    expect(buildPreviewLink(BASE, '/about/?a=1#team')).toBe(`${BASE}/about/`);
    expect(buildPreviewLink(`${BASE}/`, '/')).toBe(`${BASE}/`);
    expect(buildSiteLink(BASE)).toBe(`${BASE}/`);
  });
  it.each([
    ['//evil.example/x'],
    ['/\\evil'],
    ['https://evil.example'],
    ['evil.example/x'],
    ['/a/../b'],
    ['/a/./b'],
    ['/x@evil.example'],
    ['/a/%2e%2e/b'],
    ['/a%2Fb'],
    ['/' + 'a'.repeat(600)],
    ['/a\nb'],
    ['/a\u0000b'],
    [''],
    [42],
    [null],
  ])('refuses %j', (path) => {
    expect(buildPreviewLink(BASE, path)).toBeNull();
    expect(cleanPreviewPath(path)).toBeNull();
  });
  it('refuses a preview URL that is not an https pages.dev address, or is missing', () => {
    expect(buildPreviewLink(null, '/')).toBeNull();
    expect(buildPreviewLink('', '/')).toBeNull();
    expect(buildPreviewLink('http://design-x.vcdp.pages.dev', '/')).toBeNull();
    expect(buildPreviewLink('https://evil.example', '/')).toBeNull();
    expect(buildPreviewLink('https://pages.dev.evil.example', '/')).toBeNull();
    expect(buildPreviewLink('not a url', '/')).toBeNull();
  });
  it('accepts exactly 512 characters and refuses 513', () => {
    expect(buildPreviewLink(BASE, '/' + 'a'.repeat(511))).not.toBeNull();
    expect(buildPreviewLink(BASE, '/' + 'a'.repeat(512))).toBeNull();
  });
});
