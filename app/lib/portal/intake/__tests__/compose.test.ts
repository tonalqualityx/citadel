import { describe, it, expect } from 'vitest';
import { BAST_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { MIKE_USER_ID } from '@/lib/waits/owner';
import { composeDescription, composeTask, composeTitle, sourceRefFor, TITLE_MAX, type ComposeInput } from '../compose';
import type { PlacementResult } from '../placement';

const placement = (over: Partial<PlacementResult> = {}): PlacementResult => ({
  ok: true,
  chain: 'site',
  project_id: null,
  charter_id: null,
  site_id: 's1',
  quote: false,
  needs_mike: false,
  owner_mike: false,
  rule: 'site_change/none',
  is_support: false,
  ...over,
});

const base = (over: Partial<ComposeInput> = {}): ComposeInput => ({
  type: 'site_change',
  intake_id: '11111111-1111-4111-8111-111111111111',
  contact_name: 'Dana Reyes',
  contact_id: 'ct1',
  answers: [
    { key: 'q1', prompt: 'What should change? Tell us in your own words.', value: 'Update the hours on the contact page' },
    { key: 'q2', prompt: 'Which page is it on? Paste the link or name the page.', value: '/contact' },
  ],
  placement: placement(),
  client_id: 'cl1',
  site: { id: 's1', is_wordpress: false, maintenance_assignee_id: null },
  urgent: false,
  emergency_effects: false,
  ...over,
});

describe('composeTitle', () => {
  it('prefixes the type label', () => {
    expect(composeTitle('site_change', 'Fix the footer')).toBe('Site change: Fix the footer');
    expect(composeTitle('other', 'Help')).toBe('Request: Help');
    expect(composeTitle('broken', 'The whole site is down')).toBe('Something broken: The whole site is down');
  });
  it('collapses whitespace', () => {
    expect(composeTitle('other', 'a\n\n  b   c')).toBe('Request: a b c');
  });
  it('cuts at a word so the whole title fits 80 characters', () => {
    const long = 'word '.repeat(60);
    const t = composeTitle('new_page_feature', long);
    expect(t.length).toBeLessThanOrEqual(TITLE_MAX);
    expect(t.endsWith('…')).toBe(true);
    expect(t).not.toMatch(/wor…$|wo…$/);
    expect(t.startsWith('New page or feature: word')).toBe(true);
  });
  it('cuts one long word without spaces and still fits', () => {
    const t = composeTitle('content_article', 'x'.repeat(300));
    expect(t.length).toBeLessThanOrEqual(TITLE_MAX);
  });
  it('leaves an exactly-80 title alone', () => {
    const q = 'a'.repeat(TITLE_MAX - 'Request: '.length);
    expect(composeTitle('other', q)).toBe(`Request: ${q}`);
  });
});

describe('composeDescription', () => {
  it('names who asked and gives each question and answer verbatim', () => {
    const d = composeDescription('Dana Reyes', base().answers);
    expect(d.startsWith('Requested in the portal by Dana Reyes.')).toBe(true);
    expect(d).toContain('**Which page is it on? Paste the link or name the page.**');
    expect(d).toContain('/contact');
  });
});

describe('composeTask', () => {
  it('files a plain in-scope site change', () => {
    const t = composeTask(base());
    expect(t).toMatchObject({
      title: 'Site change: Update the hours on the contact page',
      client_title: 'Site change: Update the hours on the contact page',
      priority: 3,
      assignee_id: BAST_USER_ID,
      client_id: 'cl1',
      site_id: 's1',
      project_id: null,
      charter_id: null,
      is_retainer_work: false,
      is_support: false,
      is_billable: false,
      source: 'portal',
      source_ref: sourceRefFor('11111111-1111-4111-8111-111111111111'),
      requested_by_contact_id: 'ct1',
      status: 'not_started',
      needs_review: false,
      promised_to: null,
    });
    expect(t.tags).toEqual(['portal-chat', 'kind:site-change']);
  });

  it('uses the kind tag for every type', () => {
    const kinds: Record<string, string> = {
      site_change: 'kind:site-change',
      new_page_feature: 'kind:new-feature',
      content_article: 'kind:content',
      marketing_question: 'kind:marketing-question',
      broken: 'kind:troubleshoot',
      other: 'kind:other',
    };
    for (const [type, tag] of Object.entries(kinds)) {
      expect(composeTask(base({ type: type as ComposeInput['type'] })).tags).toContain(tag);
    }
  });

  it('adds quote and needs-mike for a quote', () => {
    const t = composeTask(base({ placement: placement({ quote: true }) }));
    expect(t.tags).toEqual(['portal-chat', 'kind:site-change', 'quote', 'needs-mike']);
    expect(t.priority).toBe(3);
  });

  it('files an emergency at priority 1 with emergency and needs-mike', () => {
    const t = composeTask(base({ type: 'broken', urgent: true, emergency_effects: true }));
    expect(t.priority).toBe(1);
    expect(t.tags).toEqual(['portal-chat', 'kind:troubleshoot', 'emergency', 'needs-mike']);
  });

  it('past the daily emergency limit files priority 2 with needs-mike and no emergency tag', () => {
    const t = composeTask(base({ type: 'broken', urgent: true, emergency_effects: false }));
    expect(t.priority).toBe(2);
    expect(t.tags).toContain('needs-mike');
    expect(t.tags).not.toContain('emergency');
  });

  it('files a non-urgent broken request at priority 2', () => {
    const t = composeTask(base({ type: 'broken' }));
    expect(t.priority).toBe(2);
    expect(t.tags).not.toContain('needs-mike');
  });

  it('marks charter placements as retainer work and carries project and charter ids', () => {
    const t = composeTask(base({ placement: placement({ chain: 'charter', charter_id: 'ch1', site_id: null }) }));
    expect(t).toMatchObject({ is_retainer_work: true, charter_id: 'ch1', site_id: null });
    const p = composeTask(base({ placement: placement({ chain: 'project', project_id: 'p1' }) }));
    expect(p).toMatchObject({ is_retainer_work: false, project_id: 'p1' });
  });

  it('adds needs-mike for a paused charter', () => {
    const t = composeTask(base({ placement: placement({ chain: 'charter', charter_id: 'ch1', needs_mike: true }) }));
    expect(t.tags).toContain('needs-mike');
  });

  it('carries is_support from the placement', () => {
    expect(composeTask(base({ placement: placement({ is_support: true }) })).is_support).toBe(true);
  });

  it('assigns by platform: the WordPress maintainer when named, Bast otherwise, Mike for a marketing orphan', () => {
    const wp = composeTask(base({ site: { id: 's1', is_wordpress: true, maintenance_assignee_id: 'maint-1' } }));
    expect(wp.assignee_id).toBe('maint-1');
    const wpNone = composeTask(base({ site: { id: 's1', is_wordpress: true, maintenance_assignee_id: null } }));
    expect(wpNone.assignee_id).toBe(BAST_USER_ID);
    const notWp = composeTask(base({ site: { id: 's1', is_wordpress: false, maintenance_assignee_id: 'maint-1' } }));
    expect(notWp.assignee_id).toBe(BAST_USER_ID);
    const mike = composeTask(base({ type: 'marketing_question', placement: placement({ owner_mike: true }) }));
    expect(mike.assignee_id).toBe(MIKE_USER_ID);
  });

  it('stores the intake block with version, placement and the answers', () => {
    const t = composeTask(base({ suggested_type: 'broken', placement: placement({ quote: true }) }));
    expect(t.client_intake).toMatchObject({
      v: 1,
      intake_id: '11111111-1111-4111-8111-111111111111',
      type: 'site_change',
      site_id: 's1',
      project_id: null,
      charter_id: null,
      placement: { chain: 'site', rule: 'site_change/none' },
      urgent: false,
      suggested_type: 'broken',
    });
    expect((t.client_intake as { answers: unknown[] }).answers).toHaveLength(2);
    expect(t.tags).toContain('suggested:broken');
  });

  it('does not duplicate tags', () => {
    const t = composeTask(base({ placement: placement({ quote: true, needs_mike: true }) }));
    expect(t.tags.filter((x) => x === 'needs-mike')).toHaveLength(1);
  });
});
