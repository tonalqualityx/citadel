import { describe, it, expect } from 'vitest';
import {
  matchingCharter,
  openBuilds,
  placeRequest,
  type PlacementCharter,
  type PlacementInput,
  type PlacementProject,
  type PlacementResult,
} from '../placement';

const NOW = new Date('2026-10-21T12:00:00Z');
const build = (over: Partial<PlacementProject> = {}): PlacementProject => ({
  id: 'b1',
  name: 'Relaunch',
  site_id: 's1',
  status: 'in_progress',
  scope_locked: false,
  ...over,
});
const charter = (over: Partial<PlacementCharter> = {}): PlacementCharter => ({
  id: 'c1',
  name: 'internal name',
  site_id: null,
  status: 'active',
  start_date: new Date('2026-01-01'),
  end_date: null,
  created_at: new Date('2026-01-01'),
  ...over,
});
const input = (over: Partial<PlacementInput> = {}): PlacementInput => ({
  type: 'site_change',
  site_id: 's1',
  chosen_project_id: null,
  site_has_plan: false,
  projects: [],
  charters: [],
  now: NOW,
  ...over,
});
const ok = (i: PlacementInput): PlacementResult => {
  const r = placeRequest(i);
  if (!r.ok) throw new Error('needs a project choice');
  return r;
};

describe('site_change', () => {
  it('open build, before content lock: project, in scope', () => {
    const r = ok(input({ projects: [build()] }));
    expect(r).toMatchObject({ chain: 'project', project_id: 'b1', quote: false, rule: 'site_change/build' });
  });
  it('open build, after content lock: project, quote', () => {
    const r = ok(input({ projects: [build({ scope_locked: true })] }));
    expect(r).toMatchObject({ chain: 'project', project_id: 'b1', quote: true, rule: 'site_change/build_locked' });
  });
  it('no build, retainer matches: site ad hoc, no quote', () => {
    const r = ok(input({ charters: [charter()] }));
    expect(r).toMatchObject({ chain: 'site', site_id: 's1', charter_id: null, quote: false });
  });
  it('neither: site ad hoc, quote unless the site has a plan', () => {
    expect(ok(input()).quote).toBe(true);
    const planned = ok(input({ site_has_plan: true }));
    expect(planned).toMatchObject({ chain: 'site', quote: false, is_support: true });
  });
  it('is not support work when it is a quote or has no plan', () => {
    expect(ok(input()).is_support).toBe(false);
  });
  it('no sites at all: client ad hoc', () => {
    expect(ok(input({ site_id: null }))).toMatchObject({ chain: 'client', site_id: null, quote: true });
  });
});

describe('new_page_feature', () => {
  it.each([
    ['open build', { projects: [build()] }, 'project'],
    ['retainer only', { charters: [charter()] }, 'site'],
    ['neither', {}, 'site'],
  ])('%s: always a quote', (_n, over, chain) => {
    const r = ok(input({ type: 'new_page_feature', ...over }));
    expect(r.chain).toBe(chain);
    expect(r.quote).toBe(true);
  });
  it('a build that is also locked is still a quote on the project', () => {
    expect(ok(input({ type: 'new_page_feature', projects: [build({ scope_locked: true })] }))).toMatchObject({ chain: 'project', quote: true });
  });
});

describe('content_article', () => {
  const base = { type: 'content_article' as const };
  it('article or social/email with a build and a matching retainer: charter', () => {
    for (const kind of ['blog', 'social_email']) {
      const r = ok(input({ ...base, content_kind: kind, projects: [build()], charters: [charter()] }));
      expect(r).toMatchObject({ chain: 'charter', charter_id: 'c1', quote: false });
    }
  });
  it('page copy with a build: project, in scope before lock, quote after', () => {
    expect(ok(input({ ...base, content_kind: 'page_copy', projects: [build()], charters: [charter()] }))).toMatchObject({ chain: 'project', quote: false });
    expect(ok(input({ ...base, content_kind: 'page_copy', projects: [build({ scope_locked: true })] }))).toMatchObject({ chain: 'project', quote: true });
  });
  it('anything else with a build: project, quote', () => {
    expect(ok(input({ ...base, content_kind: 'blog', projects: [build()] }))).toMatchObject({ chain: 'project', quote: true });
    expect(ok(input({ ...base, content_kind: 'not_sure', projects: [build()], charters: [charter()] }))).toMatchObject({ chain: 'project', quote: true });
  });
  it('no build, retainer matches: charter', () => {
    expect(ok(input({ ...base, content_kind: 'blog', charters: [charter()] }))).toMatchObject({ chain: 'charter', quote: false });
  });
  it('neither: site ad hoc, quote', () => {
    expect(ok(input({ ...base, content_kind: 'blog' }))).toMatchObject({ chain: 'site', quote: true });
  });
});

describe('marketing_question', () => {
  const base = { type: 'marketing_question' as const };
  it('charter when one matches, with or without a build', () => {
    expect(ok(input({ ...base, charters: [charter()] })).chain).toBe('charter');
    expect(ok(input({ ...base, projects: [build()], charters: [charter()] })).chain).toBe('charter');
  });
  it('a build and no charter: project', () => {
    expect(ok(input({ ...base, projects: [build()] }))).toMatchObject({ chain: 'project', quote: false });
  });
  it('neither: client ad hoc with the site set, owned by Mike', () => {
    expect(ok(input(base))).toMatchObject({ chain: 'site', site_id: 's1', owner_mike: true, quote: false });
    expect(ok(input({ ...base, site_id: null }))).toMatchObject({ chain: 'client', site_id: null, owner_mike: true });
  });
});

describe('broken', () => {
  const base = { type: 'broken' as const };
  it('is the live site even with a build open, and never a quote', () => {
    expect(ok(input({ ...base, projects: [build({ scope_locked: true })] }))).toMatchObject({ chain: 'site', project_id: null, quote: false });
    expect(ok(input({ ...base, charters: [charter()] }))).toMatchObject({ chain: 'site', quote: false });
  });
  it('a siteless build chosen: project', () => {
    const siteless = build({ id: 'sl', site_id: null });
    expect(ok(input({ ...base, site_id: null, chosen_project_id: 'sl', projects: [siteless] }))).toMatchObject({ chain: 'project', project_id: 'sl', quote: false });
  });
  it('no sites and no build: client ad hoc', () => {
    expect(ok(input({ ...base, site_id: null }))).toMatchObject({ chain: 'client', quote: false });
  });
});

describe('other', () => {
  const base = { type: 'other' as const };
  it('open build: project; retainer only: site ad hoc; neither: site or client ad hoc, never a quote', () => {
    expect(ok(input({ ...base, projects: [build()] })).chain).toBe('project');
    expect(ok(input({ ...base, charters: [charter()] })).chain).toBe('site');
    expect(ok(input(base))).toMatchObject({ chain: 'site', quote: false });
    expect(ok(input({ ...base, site_id: null })).chain).toBe('client');
  });
});

describe('open builds', () => {
  it('counts only ready, in_progress and review builds on the chosen site', () => {
    const projects = [
      build({ id: 'a', status: 'ready' }),
      build({ id: 'b', status: 'review' }),
      build({ id: 'c', status: 'done' }),
      build({ id: 'd', status: 'quote' }),
      build({ id: 'e', site_id: 's2' }),
    ];
    expect(openBuilds({ site_id: 's1', chosen_project_id: null, projects }).map((p) => p.id)).toEqual(['a', 'b']);
  });
  it('a siteless build only counts when chosen, and only if it really has no site', () => {
    const projects = [build({ id: 'sl', site_id: null }), build({ id: 'x', site_id: 's9' })];
    expect(openBuilds({ site_id: null, chosen_project_id: 'sl', projects }).map((p) => p.id)).toEqual(['sl']);
    expect(openBuilds({ site_id: null, chosen_project_id: 'x', projects })).toEqual([]);
    expect(openBuilds({ site_id: null, chosen_project_id: null, projects })).toEqual([]);
  });
  it('two builds on the site need a choice, and a choice settles it', () => {
    const projects = [build({ id: 'a' }), build({ id: 'b', name: 'Other' })];
    const pending = placeRequest(input({ projects }));
    expect(pending.ok).toBe(false);
    if (!pending.ok) expect(pending.candidates.map((c) => c.id)).toEqual(['a', 'b']);
    expect(ok(input({ projects, chosen_project_id: 'b' }))).toMatchObject({ chain: 'project', project_id: 'b' });
    // A choice that is not one of the open builds is not honored.
    expect(placeRequest(input({ projects, chosen_project_id: 'zzz' })).ok).toBe(false);
  });
  it('a locked build and an unlocked build: the pick decides the gate', () => {
    const projects = [build({ id: 'a' }), build({ id: 'b', scope_locked: true })];
    expect(ok(input({ projects, chosen_project_id: 'a' })).quote).toBe(false);
    expect(ok(input({ projects, chosen_project_id: 'b' })).quote).toBe(true);
  });
});

describe('charters', () => {
  it('ignores cancelled, out-of-date and not-yet-started charters', () => {
    const charters = [
      charter({ id: 'x', status: 'cancelled' }),
      charter({ id: 'y', end_date: new Date('2026-09-01') }),
      charter({ id: 'z', start_date: new Date('2026-12-01') }),
    ];
    expect(matchingCharter({ site_id: 's1', charters, now: NOW })).toBeNull();
  });
  it('a paused charter still places on the charter, with needs-mike', () => {
    const r = ok(input({ type: 'marketing_question', charters: [charter({ status: 'paused' })] }));
    expect(r).toMatchObject({ chain: 'charter', charter_id: 'c1', needs_mike: true });
    expect(ok(input({ type: 'marketing_question', charters: [charter()] })).needs_mike).toBe(false);
  });
  it('a site-specific charter beats a client-wide one, then the newest wins', () => {
    const wide = charter({ id: 'wide', created_at: new Date('2026-09-01') });
    const specific = charter({ id: 'spec', site_id: 's1', created_at: new Date('2026-02-01') });
    expect(matchingCharter({ site_id: 's1', charters: [wide, specific], now: NOW })?.id).toBe('spec');
    const newer = charter({ id: 'newer', created_at: new Date('2026-10-01') });
    expect(matchingCharter({ site_id: 's1', charters: [wide, newer], now: NOW })?.id).toBe('newer');
  });
  it('two charters: another site\'s charter does not match', () => {
    const other = charter({ id: 'o', site_id: 's2' });
    expect(matchingCharter({ site_id: 's1', charters: [other], now: NOW })).toBeNull();
    expect(matchingCharter({ site_id: 's1', charters: [other, charter({ id: 'w' })], now: NOW })?.id).toBe('w');
  });
  it('with no site chosen, a client-wide charter comes first and any live charter can match', () => {
    const specific = charter({ id: 'spec', site_id: 's2' });
    expect(matchingCharter({ site_id: null, charters: [specific], now: NOW })?.id).toBe('spec');
    expect(matchingCharter({ site_id: null, charters: [specific, charter({ id: 'wide' })], now: NOW })?.id).toBe('wide');
  });
  it('marks charter placements as retainer work via the chain', () => {
    expect(ok(input({ type: 'marketing_question', charters: [charter()] })).chain).toBe('charter');
  });
});
