import { describe, it, expect } from 'vitest';
import { evidenceOf, evidenceParts, LOOKS_DONE_PREFIX, EVIDENCE_MAX } from '../looks-done';
import { summaryFromHead } from '../triage-summary';
import { ageLine } from '../triage-copy';

describe('evidenceOf', () => {
  it('takes the text after "Looks done: " and nothing else', () => {
    expect(evidenceOf('Looks done: shipped in abc123')).toBe('shipped in abc123');
    expect(evidenceOf('looks done: nope')).toBeNull();
    expect(evidenceOf(`${LOOKS_DONE_PREFIX}   `)).toBeNull();
    expect(evidenceOf(null)).toBeNull();
  });
  it('caps a long line', () => {
    expect(evidenceOf(`${LOOKS_DONE_PREFIX}${'a'.repeat(2000)}`)!.length).toBe(EVIDENCE_MAX);
  });
});

describe('evidenceParts', () => {
  it('makes only http and https addresses clickable and keeps trailing punctuation as text', () => {
    const p = evidenceParts('See https://x.test/a, and javascript:alert(1) or http://y.test.');
    expect(p.filter((x) => x.href).map((x) => x.href)).toEqual(['https://x.test/a', 'http://y.test']);
    expect(p.map((x) => x.text).join('')).toBe('See https://x.test/a, and javascript:alert(1) or http://y.test.');
  });
});

describe('summaryFromHead', () => {
  const block = (t: string) => `[{"id":"a","type":"paragraph","props":{},"content":[{"type":"text","text":"What's wanted: ","styles":{"bold":true}},{"type":"text","text":${JSON.stringify(t)},"styles":{}}],"children":[]},{"id":"b","type":"paragraph","props":{},"content":[{"type":"text","text":"Why it matters: later","styles":{}}],"children":[]}]`;
  it('is the first block only, without the label', () => {
    expect(summaryFromHead(block('Fix the "footer" link.'))).toBe('Fix the "footer" link.');
  });
  it('survives a head cut in the middle of a string, and plain or empty descriptions', () => {
    expect(summaryFromHead(block('Short.').slice(0, 130))).toBe('');
    expect(summaryFromHead('A plain line\nsecond')).toBe('A plain line');
    expect(summaryFromHead(null)).toBe('');
  });
  it('caps long text', () => {
    expect(summaryFromHead(block('x'.repeat(500))).length).toBeLessThanOrEqual(220);
  });
});

describe('ageLine', () => {
  const now = Date.parse('2026-11-12T12:00:00Z');
  it('reads in days, weeks and months', () => {
    expect(ageLine('2026-11-12T01:00:00Z', now)).toBe('today');
    expect(ageLine('2026-11-11T01:00:00Z', now)).toBe('1 day old');
    expect(ageLine('2026-11-07T01:00:00Z', now)).toBe('5 days old');
    expect(ageLine('2026-10-20T01:00:00Z', now)).toBe('3 weeks old');
    expect(ageLine('2026-07-01T01:00:00Z', now)).toBe('4 months old');
    expect(ageLine(undefined, now)).toBe('');
  });
});
