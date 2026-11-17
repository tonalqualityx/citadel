import { describe, it, expect } from 'vitest';
import { isFigmaHost, parseFigmaLink } from '../figma-link';
import { referenceRole, isUsableDesignFile, hasDesignFile } from '../reference-role';

const KEY = 'AbCdEfGhIjKl';
const code = (raw: string) => {
  try { parseFigmaLink(raw); return null; } catch (e) { return (e as { code?: string }).code ?? 'other'; }
};

describe('isFigmaHost', () => {
  it('matches exactly figma.com and www.figma.com, any case', () => {
    for (const u of ['https://figma.com/x', 'https://www.figma.com/x', 'https://WWW.Figma.COM/x', 'http://figma.com/x']) expect(isFigmaHost(u), u).toBe(true);
  });
  it('refuses look-alikes and user-info tricks', () => {
    for (const u of ['https://figma.com.evil.example/x', 'https://evilfigma.com/x', 'https://notfigma.com', 'https://api.figma.com/x', `https://www.figma.com@evil.example/design/${KEY}`, 'https://example.org/?u=figma.com', 'not a url']) {
      expect(isFigmaHost(u), u).toBe(false);
    }
  });
});

describe('parseFigmaLink', () => {
  it('reads design, file and proto links on both hosts', () => {
    for (const path of ['design', 'file', 'proto']) {
      for (const host of ['figma.com', 'www.figma.com']) {
        expect(parseFigmaLink(`https://${host}/${path}/${KEY}/Some-Name`)).toEqual({ file_key: KEY, node_id: null, canonical_url: `https://www.figma.com/design/${KEY}` });
      }
    }
  });
  it('reads the node id as 12-34, 12:34 and 12%3A34, stored as 12:34', () => {
    for (const q of ['12-34', '12:34', '12%3A34']) {
      expect(parseFigmaLink(`https://www.figma.com/design/${KEY}/N?node-id=${q}`)).toEqual({ file_key: KEY, node_id: '12:34', canonical_url: `https://www.figma.com/design/${KEY}?node-id=12-34` });
    }
  });
  it('drops share parameters and the fragment', () => {
    const r = parseFigmaLink(`https://www.figma.com/design/${KEY}/N?t=abc&node-id=1-2&m=dev&utm_source=x#frag`);
    expect(r.canonical_url).toBe(`https://www.figma.com/design/${KEY}?node-id=1-2`);
    expect(r.canonical_url).not.toMatch(/utm|abc|frag|dev/);
  });
  it('refuses http, bad hosts, user info and ports', () => {
    expect(code(`http://www.figma.com/design/${KEY}`)).toBe('bad_figma_link');
    expect(code(`https://figma.com.evil.example/design/${KEY}`)).toBe('bad_figma_link');
    expect(code(`https://evilfigma.com/design/${KEY}`)).toBe('bad_figma_link');
    expect(code(`https://www.figma.com@evil.example/design/${KEY}`)).toBe('bad_figma_link');
    expect(code(`https://user:pw@www.figma.com/design/${KEY}`)).toBe('bad_figma_link');
    expect(code(`https://www.figma.com:8443/design/${KEY}`)).toBe('bad_figma_link');
  });
  it('refuses FigJam boards, community pages, a bare home page, short or odd keys and odd node ids', () => {
    for (const u of [`https://www.figma.com/board/${KEY}/Jam`, 'https://www.figma.com/community/file/1', 'https://www.figma.com/', 'https://www.figma.com/design/short', `https://www.figma.com/design/${KEY}!`,
      `https://www.figma.com/design/${KEY}/branch/${KEY}/Name`, `https://www.figma.com/design/${KEY}/N?node-id=abc`, `https://www.figma.com/design/${KEY}/N?node-id=1-2;3-4`, `https://www.figma.com/design/${KEY}/N?node-id=1-2-3`]) {
      expect(code(u), u).toBe('bad_figma_link');
    }
  });
  it('reads a link whose file name is long once percent-encoded, and keeps none of the name', () => {
    const name = encodeURIComponent('設計'.repeat(40));
    expect(name.length).toBeGreaterThan(700);
    expect(parseFigmaLink(`https://www.figma.com/design/${KEY}/${name}?node-id=1-2`).canonical_url).toBe(`https://www.figma.com/design/${KEY}?node-id=1-2`);
  });

  it('refuses empty and over-long input', () => {
    expect(code('')).toBe('bad_figma_link');
    expect(code(`https://www.figma.com/design/${KEY}/${'a'.repeat(2100)}`)).toBe('bad_figma_link');
    expect(code(`https://www.figma.com/design/${'a'.repeat(65)}`)).toBe('bad_figma_link');
  });
});

describe('reference roles', () => {
  it('names the role by source', () => {
    expect(referenceRole('designer_upload')).toBe('design_file');
    expect(referenceRole('designer_figma')).toBe('design_file');
    for (const s of ['bast_pick', 'client_named', 'indelible_site', 'designer_url']) expect(referenceRole(s)).toBe('inspiration');
  });
  it('a design file is usable when not set aside and captured (Figma) or holding a ready picture (upload)', () => {
    const ok = { url: '/a' };
    expect(isUsableDesignFile({ source: 'designer_figma', decision: 'pending', capture_status: 'captured' })).toBe(true);
    expect(isUsableDesignFile({ source: 'designer_figma', decision: 'yes', capture_status: 'queued' })).toBe(false);
    expect(isUsableDesignFile({ source: 'designer_figma', decision: 'no', capture_status: 'captured' })).toBe(false);
    expect(isUsableDesignFile({ source: 'designer_upload', decision: 'pending', capture_status: 'none', uploads: [{ asset: ok }] })).toBe(true);
    expect(isUsableDesignFile({ source: 'designer_upload', decision: 'pending', capture_status: 'none', uploads: [{ asset: { url: null }, renders: [ok] }] })).toBe(true);
    expect(isUsableDesignFile({ source: 'designer_upload', decision: 'pending', capture_status: 'none', uploads: [{ asset: { url: null } }] })).toBe(false);
    expect(isUsableDesignFile({ source: 'designer_url', decision: 'pending', capture_status: 'captured' })).toBe(false);
    expect(hasDesignFile([{ source: 'bast_pick', decision: 'yes', capture_status: 'captured' }])).toBe(false);
  });
});
