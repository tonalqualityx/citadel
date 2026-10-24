import { describe, it, expect, vi } from 'vitest';
import { makeApplyProceed } from '../apply';
import type { WaitRow } from '@/lib/waits/sweeper';

const wait = (over: Record<string, unknown> = {}) =>
  ({ id: 'w1', template_key: 'charter.price_review', charter_id: 'c1', ...over }) as unknown as WaitRow;

describe('applyProceed for the price review', () => {
  it('stamps price_review_done_at once, only where it is empty', async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const now = new Date('2026-11-02T15:00:00Z');
    await makeApplyProceed({ charter: { updateMany } } as never, () => now)(wait(), 'price_review_done');
    expect(updateMany).toHaveBeenCalledWith({ where: { id: 'c1', price_review_done_at: null }, data: { price_review_done_at: now } });
  });

  it('leaves every other effect alone', async () => {
    const updateMany = vi.fn();
    const apply = makeApplyProceed({ charter: { updateMany } } as never);
    for (const e of [null, 'hold_page', 'accord_dormant', 'publish_staged', '']) await apply(wait(), e);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('refuses the effect on a wait that is not a price review with a charter', async () => {
    const updateMany = vi.fn();
    const apply = makeApplyProceed({ charter: { updateMany } } as never);
    await expect(apply(wait({ template_key: 'handoff.generic' }), 'price_review_done')).rejects.toThrow();
    await expect(apply(wait({ charter_id: null }), 'price_review_done')).rejects.toThrow();
    expect(updateMany).not.toHaveBeenCalled();
  });
});
