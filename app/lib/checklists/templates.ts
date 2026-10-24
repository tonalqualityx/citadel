/**
 * Checklist templates (specs/citadel-shape-SPEC.md 3.12). Item sets come from the onboarding map
 * (docs/process-map/6-onboarding.mmd) and research/onboarding-automation-2026-10-21.md.
 *
 * Every item has an internal label (staff) and a client label (plain words, the only text a
 * client ever sees; the portal reads it from here by key, never from the database row).
 *
 * `gate` says when the item must be present:
 *  - before_work: work does not start until it is verified, received or waived. These decide
 *    whether the checklist is done (the W11 Q10 default set).
 *  - before_launch: required, but the site cannot launch without it, not before work starts.
 *  - none: wanted, not required.
 *
 * The onboarding template is a draft (`draft: true`): the item set awaits Mike's ruling.
 */
import type { ChecklistKind } from '@prisma/client';

export type ChecklistGate = 'before_work' | 'before_launch' | 'none';
export type ChecklistGroup = 'access' | 'assets' | 'people' | 'reference' | 'billing' | 'meeting';

export interface TemplateItem {
  key: string;
  /** Internal wording for staff. Up to 255 characters. */
  label: string;
  /** Plain words for the portal. Never internal terms, never a tool name. */
  client_label: string;
  group: ChecklistGroup;
  gate: ChecklistGate;
}

export interface ChecklistTemplate {
  key: string;
  kind: ChecklistKind;
  engagement: 'build';
  draft: boolean;
  items: TemplateItem[];
}

const item = (key: string, label: string, client_label: string, group: ChecklistGroup, gate: ChecklistGate): TemplateItem => ({
  key,
  label,
  client_label,
  group,
  gate,
});

export const ONBOARDING_BUILD_TEMPLATE: ChecklistTemplate = {
  key: 'onboarding.build',
  kind: 'onboarding',
  engagement: 'build',
  draft: true,
  items: [
    // Required before work starts.
    item('people.approver', 'Approver named', 'Who approves work for you', 'people', 'before_work'),
    item('people.billing_contact', 'Billing contact named', 'Who should receive your invoices', 'people', 'before_work'),
    item('assets.logo', 'Logo received', 'Your logo file', 'assets', 'before_work'),
    item('billing.msa', 'MSA signed', 'Your signed agreement', 'billing', 'before_work'),
    item('billing.first_payment', 'First payment received', 'Your first payment', 'billing', 'before_work'),
    item('meeting.kickoff', 'Kickoff booked', 'A time for our kickoff meeting', 'meeting', 'before_work'),
    // Required before launch, not before work starts.
    item('access.ga4', 'GA4 access granted', 'Access to your Google Analytics', 'access', 'before_launch'),
    item('access.gsc', 'Search Console access granted', 'Access to your Google Search Console', 'access', 'before_launch'),
    item('access.dns', 'DNS or registrar access', 'Access to your domain settings', 'access', 'before_launch'),
    // The rest of map 6: wanted, not required.
    item('access.hosting', 'Hosting access (their current host)', 'Access to your current web host', 'access', 'none'),
    item('access.social', 'Social accounts', 'Access to your social media accounts', 'access', 'none'),
    item('access.email_platform', 'Email platform', 'Access to your email marketing account', 'access', 'none'),
    item('access.site_admin', 'Existing site admin', 'A login for your current website', 'access', 'none'),
    item('assets.photos', 'Photos received', 'Your photos', 'assets', 'none'),
    item('assets.brand_guidelines', 'Brand guidelines received', 'Your brand guidelines, if you have them', 'assets', 'none'),
    item('assets.content_export', 'Existing content export', 'A copy of the content on your current site', 'assets', 'none'),
    item('assets.legal_pages', 'Legal pages', 'Your privacy policy and terms, if you have them', 'assets', 'none'),
    item('people.report_recipient', 'Report recipient named', 'Who should receive your reports', 'people', 'none'),
    item('people.signer', 'Signer named', 'Who signs for your business', 'people', 'none'),
    item('reference.sites', 'Reference sites (3 to 5, and why)', 'Three to five websites you like, and why', 'reference', 'none'),
    item('billing.qbo_customer', 'QuickBooks customer with terms', 'Your billing account', 'billing', 'none'),
    item('billing.first_invoice', 'First invoice issued', 'Your first invoice', 'billing', 'none'),
  ],
};

export const CHECKLIST_TEMPLATES: Record<string, ChecklistTemplate> = {
  [ONBOARDING_BUILD_TEMPLATE.key]: ONBOARDING_BUILD_TEMPLATE,
};

export function getChecklistTemplate(key: string): ChecklistTemplate | null {
  return CHECKLIST_TEMPLATES[key] ?? null;
}

export function templateKeys(): string[] {
  return Object.keys(CHECKLIST_TEMPLATES);
}

/** An item's template entry by key, across every template. First match wins. */
export function findTemplateItem(key: string): TemplateItem | null {
  for (const t of Object.values(CHECKLIST_TEMPLATES)) {
    const found = t.items.find((i) => i.key === key);
    if (found) return found;
  }
  return null;
}

/** Whether an item row is required (stored `required` is true for both before_work and before_launch). */
export const isRequiredGate = (gate: ChecklistGate) => gate !== 'none';
