import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { cleanApprovalSource } from '../receipts';

const ID = '3f2b8c1e-9d4a-4e6b-8a1f-0c2d3e4f5a6b';

describe('cleanApprovalSource', () => {
  it('keeps the existing sources unchanged', () => {
    expect(cleanApprovalSource('portal')).toBe('portal');
    expect(cleanApprovalSource('approval_link')).toBe('approval_link');
    expect(cleanApprovalSource('api')).toBe('api');
    expect(cleanApprovalSource('email:<abc@mail.example>')).toBe('email:<abc@mail.example>');
    expect(cleanApprovalSource('  portal  ')).toBe('portal');
    expect(cleanApprovalSource(`  design_publish:${ID} `)).toBe(`design_publish:${ID}`);
    expect(cleanApprovalSource(null)).toBe('api');
    expect(cleanApprovalSource(undefined)).toBe('api');
    expect(cleanApprovalSource('')).toBe('api');
    expect(cleanApprovalSource('something-else')).toBe('api');
  });

  it.each([`design_publish:${ID}`, `design_admin_publish:${ID}`, `design_rollback:${ID}`, `design_publish:${ID.toUpperCase()}`])('keeps %s', (s) => {
    expect(cleanApprovalSource(s)).toBe(s);
  });

  it.each([
    'design_publish:',
    'design_publish:not-a-uuid',
    `design_publish:${ID}x`,
    `design_publish:${ID} extra`,
    `design_other:${ID}`,
    `design_publish ${ID}`,
    `xdesign_publish:${ID}`,
    `design_publish:${ID};drop`,
  ])('collapses %j to api', (s) => {
    expect(cleanApprovalSource(s)).toBe('api');
  });
});
