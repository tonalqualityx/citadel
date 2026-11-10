// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { UPLOAD_REJECT_CODES, UPLOAD_REJECT_SENTENCES } from '../track-assets';

describe('upload reject codes (W3.8b)', () => {
  it('is the handler vocabulary, in order', () => {
    expect([...UPLOAD_REJECT_CODES]).toEqual([
      'too_many_pixels', 'not_an_image', 'type_not_allowed', 'pdf_failed', 'svg_refused', 'svg_failed', 'timeout', 'too_large', 'processing_failed',
    ]);
  });
  it('has a plain sentence for every code and none extra', () => {
    expect(Object.keys(UPLOAD_REJECT_SENTENCES).sort()).toEqual([...UPLOAD_REJECT_CODES].sort());
    for (const code of UPLOAD_REJECT_CODES) {
      const s = UPLOAD_REJECT_SENTENCES[code];
      expect(s.length, code).toBeGreaterThan(10);
      expect(s, code).toMatch(/[.]$/);
      expect(s, code).not.toMatch(/[–—]/);
    }
  });
});
