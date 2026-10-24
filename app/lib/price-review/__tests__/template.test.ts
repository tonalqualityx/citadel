import { describe, it, expect } from 'vitest';
import { PRICE_REVIEW_MIN_NOTICE_DAYS } from '../terms';
import { longDate, moneyText, PriceReviewRenderError, renderPriceReviewMail } from '../template';

const NOW = new Date('2026-10-24T15:00:00Z');
const approval = { new_amount_cents: 15000, period: 'monthly', effective_on: '2026-12-01' };
const render = (over: Record<string, unknown> = {}) =>
  renderPriceReviewMail({ firstName: 'Dana', planLabel: 'Herba ReLeaf care plan', now: NOW, approval: { ...approval, ...over } });

describe('price review note template', () => {
  it('renders the approved amount and date, signed Indelible', () => {
    const m = render();
    expect(m.subject).toBe('Your Indelible plan: new price from December 1, 2026');
    expect(m.text).toContain('Hello Dana,');
    expect(m.text).toContain('Starting December 1, 2026, the price of Herba ReLeaf care plan will be $150 per month.');
    expect(m.text).toBe(
      [
        'Hello Dana,',
        'Starting December 1, 2026, the price of Herba ReLeaf care plan will be $150 per month.',
        'Until then, nothing changes.',
        'If you have a question about this, reply to this email and we will answer it.',
        'Thank you for working with us.',
        'Indelible',
      ].join('\n\n') + '\n'
    );
    expect(m.text.trimEnd().endsWith('\n\nIndelible')).toBe(true);
  });

  it('says per year for an annual plan and shows cents only when there are some', () => {
    expect(render({ period: 'annually', new_amount_cents: 180050 }).text).toContain('$1,800.50 per year');
    expect(moneyText(15000)).toBe('$150');
    expect(moneyText(15050)).toBe('$150.50');
    expect(longDate('2027-02-09')).toBe('February 9, 2027');
  });

  it('greets plainly with no first name', () => {
    expect(renderPriceReviewMail({ firstName: null, planLabel: 'Plan', now: NOW, approval }).text.startsWith('Hello,\n')).toBe(true);
  });

  it('uses no dashes as punctuation and no discount language', () => {
    for (const m of [render(), render({ period: 'annually' })]) {
      const all = `${m.subject}\n${m.text}`;
      expect(all).not.toMatch(/[–—]/);
      expect(all).not.toMatch(/ - /);
      expect(all).not.toMatch(/discount|waive|waiver|credit|free|special|reduced|savings|offer|deal|promo/i);
      expect(all).not.toMatch(/bast/i);
    }
  });

  it('takes every number from the approval record and from nowhere else', () => {
    const m = render();
    const stripped = `${m.subject}\n${m.text}`.replace('$150', '').replaceAll('December 1, 2026', '');
    expect(stripped).not.toMatch(/\d/);
  });

  it('refuses to render without a complete approval', () => {
    const bad: unknown[] = [
      undefined,
      null,
      {},
      'approved',
      { period: 'monthly', effective_on: '2026-12-01' },
      { new_amount_cents: 15000, effective_on: '2026-12-01' },
      { new_amount_cents: 15000, period: 'monthly' },
      { new_amount_cents: 0, period: 'monthly', effective_on: '2026-12-01' },
      { new_amount_cents: -5, period: 'monthly', effective_on: '2026-12-01' },
      { new_amount_cents: 150.5, period: 'monthly', effective_on: '2026-12-01' },
      { new_amount_cents: 15000, period: 'weekly', effective_on: '2026-12-01' },
      { new_amount_cents: 15000, period: 'monthly', effective_on: '2026-02-30' },
      { new_amount_cents: 15000, period: 'monthly', effective_on: 'next month' },
    ];
    for (const a of bad) {
      expect(() => renderPriceReviewMail({ firstName: 'Dana', planLabel: 'Plan', now: NOW, approval: a })).toThrow(PriceReviewRenderError);
    }
  });

  it('claims nothing the client may not have', () => {
    const t = render().text;
    expect(t).not.toMatch(/site care|report|we review|set date|each plan/i);
  });

  it('says "your marketing plan" with no plan label, and never the business name', () => {
    for (const label of [null, '', '   ']) {
      const t = renderPriceReviewMail({ firstName: 'Dana', planLabel: label, now: NOW, approval }).text;
      expect(t).toContain('the price of your marketing plan will be $150 per month');
    }
  });

  it('refuses a start date in the past or less than the minimum notice after today', () => {
    expect(PRICE_REVIEW_MIN_NOTICE_DAYS).toBe(30);
    // 2026-10-24 + 30 days = 2026-11-23.
    for (const effective_on of ['2026-10-01', '2026-10-24', '2026-11-01', '2026-11-22']) {
      expect(() => render({ effective_on })).toThrow(PriceReviewRenderError);
    }
    expect(() => render({ effective_on: '2026-11-23' })).not.toThrow();
    expect(() => render({ effective_on: '2026-12-01' })).not.toThrow();
  });
});
