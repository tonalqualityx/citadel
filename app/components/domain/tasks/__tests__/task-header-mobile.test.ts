import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The card page header (the Plan tab sits under it) used to be one unwrapped flex row: title, status, priority and the
 * delete button added up to more than a 360 to 375px phone, so the whole page scrolled sideways. Measured in a real
 * browser: document scrollWidth 376 at a 360 and 375 viewport before, equal to the viewport after. These pin the classes
 * that let each row wrap and shrink.
 */
const src = readFileSync(resolve(__dirname, '../../../../app/(app)/tasks/[id]/page.tsx'), 'utf8');
const classOf = (testid: string): string => {
  const m = new RegExp(`className="([^"]*)"\\s+data-testid="${testid}"`).exec(src);
  if (!m) throw new Error(`no element with data-testid ${testid}`);
  return m[1];
};

describe('card page header on a phone', () => {
  it('the header row wraps', () => {
    expect(classOf('task-header')).toContain('flex-wrap');
  });
  it('the title, status and priority row wraps', () => {
    expect(classOf('task-title-row')).toContain('flex-wrap');
  });
  it('the action buttons wrap instead of running off the right edge', () => {
    expect(classOf('task-header-actions')).toContain('flex-wrap');
  });
  it('the title block can shrink and a long title breaks', () => {
    expect(src).toContain('<div className="flex min-w-0 items-start gap-4">');
    expect(src).toContain('<h1 className="min-w-0 break-words text-2xl');
  });
});
