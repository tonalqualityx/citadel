import { describe, it, expect } from 'vitest';
import { parseTag, parseTags } from '../task-tags';

describe('parseTag', () => {
  it('parses a stack: namespaced tag with the info variant', () => {
    const t = parseTag('stack:eleventy');
    expect(t.namespace).toBe('stack');
    expect(t.value).toBe('eleventy');
    expect(t.label).toBe('Eleventy');
    expect(t.variant).toBe('info');
    expect(t.raw).toBe('stack:eleventy');
  });

  it('parses a kind: namespaced tag with the purple variant', () => {
    const t = parseTag('kind:content');
    expect(t.namespace).toBe('kind');
    expect(t.label).toBe('Content');
    expect(t.variant).toBe('purple');
  });

  it('treats an unknown namespace as default variant but keeps the namespace', () => {
    const t = parseTag('env:prod');
    expect(t.namespace).toBe('env');
    expect(t.label).toBe('Prod');
    expect(t.variant).toBe('default');
  });

  it('maps attention/in-flight triage tags to the warning variant', () => {
    for (const tag of ['needs-mike', 'awaiting-clarification', 'gate-failed', 'staged']) {
      const t = parseTag(tag);
      expect(t.namespace).toBeNull();
      expect(t.variant).toBe('warning');
    }
  });

  it('maps bast-doable to the success variant', () => {
    expect(parseTag('bast-doable').variant).toBe('success');
  });

  it('maps new-sop-candidate to the purple variant', () => {
    expect(parseTag('new-sop-candidate').variant).toBe('purple');
  });

  it('prettifies hyphenated labels into title case', () => {
    expect(parseTag('awaiting-clarification').label).toBe('Awaiting Clarification');
  });

  it('falls back to the default variant for an unknown bare tag', () => {
    const t = parseTag('experimental');
    expect(t.namespace).toBeNull();
    expect(t.label).toBe('Experimental');
    expect(t.variant).toBe('default');
  });

  it('is case-insensitive for namespace and triage matching', () => {
    expect(parseTag('STACK:eleventy').namespace).toBe('stack');
    expect(parseTag('Needs-Mike').variant).toBe('warning');
  });

  it('trims surrounding whitespace from the raw tag', () => {
    const t = parseTag('  stack:wordpress  ');
    expect(t.raw).toBe('stack:wordpress');
    expect(t.namespace).toBe('stack');
    expect(t.label).toBe('Wordpress');
  });
});

describe('parseTags', () => {
  it('returns an empty array for null/undefined/empty input', () => {
    expect(parseTags(null)).toEqual([]);
    expect(parseTags(undefined)).toEqual([]);
    expect(parseTags([])).toEqual([]);
  });

  it('skips empty / whitespace-only entries', () => {
    const result = parseTags(['stack:eleventy', '', '   ', 'needs-mike']);
    expect(result).toHaveLength(2);
    expect(result.map((t) => t.raw)).toEqual(['stack:eleventy', 'needs-mike']);
  });
});
