import { describe, it, expect } from 'vitest';
import { CHECKLIST_TEMPLATES, ONBOARDING_BUILD_TEMPLATE, findTemplateItem, getChecklistTemplate } from '../templates';
import { itemsFromTemplate } from '../service';

describe('onboarding build template', () => {
  const t = ONBOARDING_BUILD_TEMPLATE;
  it('is a draft onboarding template registered by key', () => {
    expect(t.draft).toBe(true);
    expect(t.kind).toBe('onboarding');
    expect(getChecklistTemplate('onboarding.build')).toBe(t);
    expect(getChecklistTemplate('nope')).toBeNull();
  });
  it('requires exactly the six W11 items before work starts', () => {
    expect(t.items.filter((i) => i.gate === 'before_work').map((i) => i.key).sort()).toEqual(
      ['assets.logo', 'billing.first_payment', 'billing.msa', 'meeting.kickoff', 'people.approver', 'people.billing_contact']
    );
  });
  it('requires GA4, Search Console and DNS before launch only', () => {
    expect(t.items.filter((i) => i.gate === 'before_launch').map((i) => i.key).sort()).toEqual(['access.dns', 'access.ga4', 'access.gsc']);
  });
  it('carries the other map 6 items as not required', () => {
    const rest = t.items.filter((i) => i.gate === 'none').map((i) => i.key);
    for (const k of ['access.hosting', 'assets.photos', 'assets.brand_guidelines', 'assets.content_export', 'assets.legal_pages', 'people.report_recipient', 'people.signer', 'reference.sites']) {
      expect(rest).toContain(k);
    }
  });
  it('has unique keys, labels in range, and a client label on every item', () => {
    const keys = t.items.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const i of t.items) {
      expect(i.key.length).toBeLessThanOrEqual(60);
      expect(i.label.length).toBeGreaterThan(0);
      expect(i.label.length).toBeLessThanOrEqual(255);
      expect(i.client_label.trim().length).toBeGreaterThan(0);
      expect(i.group.length).toBeLessThanOrEqual(20);
    }
  });
  it('client labels are plain words: no tool names, no internal terms, no dashes', () => {
    for (const i of t.items) {
      expect(i.client_label).not.toMatch(/\b(ga4|gsc|dns|msa|qbo|quickbooks|bast|citadel|kickoff booked|verified)\b/i);
      expect(i.client_label).not.toMatch(/[-–—]/);
    }
  });
  it('turns into item rows with required true for work and launch items', () => {
    const rows = itemsFromTemplate(t);
    expect(rows.find((r) => r.key === 'access.ga4')?.required).toBe(true);
    expect(rows.find((r) => r.key === 'assets.photos')?.required).toBe(false);
  });
  it('findTemplateItem looks across templates', () => {
    expect(findTemplateItem('assets.logo')?.client_label).toBe('Your logo file');
    expect(findTemplateItem('x.y')).toBeNull();
    expect(Object.keys(CHECKLIST_TEMPLATES)).toContain('onboarding.build');
  });
});
