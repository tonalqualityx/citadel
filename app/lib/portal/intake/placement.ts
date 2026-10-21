/**
 * Where a portal request lands (portal phase B slice 1, spec section 2.3).
 *
 * One pure function mirroring inbound placement rule 6: an open build on the site wins, plan and
 * article work goes to the retainer, the rest is ad hoc on the site or the client. No database:
 * the caller loads the contact's visible projects and the client's charters and passes them in,
 * so every cell of the table is unit-tested.
 */
import type { IntakeType } from './tree';

export const OPEN_BUILD_STATUSES = ['ready', 'in_progress', 'review'] as const;

export interface PlacementProject {
  id: string;
  name: string;
  site_id: string | null;
  status: string;
  scope_locked: boolean;
}

export interface PlacementCharter {
  id: string;
  /** Internal name. Never shown to a client; the caller picks the client-facing label. */
  name: string;
  /** null = covers every site. */
  site_id: string | null;
  status: string;
  start_date: Date;
  end_date: Date | null;
  created_at: Date;
}

export type PlacementChain = 'project' | 'charter' | 'site' | 'client';

export interface PlacementInput {
  type: IntakeType;
  /** The chosen site, or null (no site chosen, "All my sites", or a siteless build). */
  site_id: string | null;
  /** A siteless open build the client picked at the site step (or a prefill), or the pick between two builds. */
  chosen_project_id: string | null;
  /** True when the chosen site has a maintenance or hosting plan. */
  site_has_plan: boolean;
  /** The contact's visible projects (already filtered with projectAccessWhere). */
  projects: PlacementProject[];
  charters: PlacementCharter[];
  /** Answer key of the content "what kind of piece" question: blog, page_copy, social_email, not_sure. */
  content_kind?: string | null;
  now: Date;
}

export interface PlacementResult {
  ok: true;
  chain: PlacementChain;
  project_id: string | null;
  charter_id: string | null;
  site_id: string | null;
  /** Files tagged quote and needs-mike. */
  quote: boolean;
  /** Needs Mike's eye for a reason other than a quote (paused charter). */
  needs_mike: boolean;
  /** Marketing question with nowhere else to go: Mike owns it. */
  owner_mike: boolean;
  /** Machine id of the table cell, stored in client_intake.placement.rule. */
  rule: string;
  /** In-scope site-level work on a site with a plan: the task is support work. */
  is_support: boolean;
}

export type PlacementNeedsChoice = {
  ok: false;
  reason: 'choose_project';
  /** The open builds the client must pick between. */
  candidates: PlacementProject[];
};

export type Placement = PlacementResult | PlacementNeedsChoice;

/** Open builds for the chosen site (or the chosen siteless build). */
export function openBuilds(input: Pick<PlacementInput, 'site_id' | 'chosen_project_id' | 'projects'>): PlacementProject[] {
  const open = input.projects.filter((p) => (OPEN_BUILD_STATUSES as readonly string[]).includes(p.status));
  if (input.site_id) return open.filter((p) => p.site_id === input.site_id);
  if (input.chosen_project_id) return open.filter((p) => p.id === input.chosen_project_id && p.site_id === null);
  return [];
}

/**
 * The charter that matches, or null. Active or paused, in date. A site-specific charter beats a
 * client-wide one, then the newest. With no site chosen, a client-wide charter comes first.
 */
export function matchingCharter(
  input: Pick<PlacementInput, 'site_id' | 'charters' | 'now'>
): PlacementCharter | null {
  const t = input.now.getTime();
  const live = input.charters.filter(
    (c) =>
      (c.status === 'active' || c.status === 'paused') &&
      c.start_date.getTime() <= t &&
      (c.end_date === null || c.end_date.getTime() >= t)
  );
  const candidates = input.site_id ? live.filter((c) => c.site_id === null || c.site_id === input.site_id) : live;
  if (candidates.length === 0) return null;
  const rank = (c: PlacementCharter) => (input.site_id && c.site_id === input.site_id ? 0 : c.site_id === null ? 1 : 2);
  return [...candidates].sort(
    (a, b) => rank(a) - rank(b) || b.created_at.getTime() - a.created_at.getTime() || (a.id < b.id ? 1 : -1)
  )[0];
}

export function placeRequest(input: PlacementInput): Placement {
  const builds = openBuilds(input);

  // Two or more open builds on the site: the client picks, the server never guesses.
  let build: PlacementProject | null = null;
  if (builds.length === 1) build = builds[0];
  if (builds.length > 1) {
    const picked = builds.find((b) => b.id === input.chosen_project_id);
    if (!picked) return { ok: false, reason: 'choose_project', candidates: builds };
    build = picked;
  }
  const charter = matchingCharter(input);
  const paused = charter?.status === 'paused';

  const base = {
    ok: true as const,
    project_id: null as string | null,
    charter_id: null as string | null,
    site_id: input.site_id,
    quote: false,
    needs_mike: false,
    owner_mike: false,
    is_support: false,
  };

  const toProject = (rule: string, quote: boolean): PlacementResult => ({
    ...base,
    chain: 'project',
    project_id: build!.id,
    // A siteless build keeps the site it has (none); a build on the site keeps the chosen site.
    site_id: input.site_id ?? build!.site_id,
    quote,
    rule,
  });
  const toCharter = (rule: string, quote = false): PlacementResult => ({
    ...base,
    chain: 'charter',
    charter_id: charter!.id,
    quote,
    needs_mike: paused,
    rule,
  });
  const toSite = (rule: string, quote: boolean): PlacementResult => {
    const chain: PlacementChain = input.site_id ? 'site' : 'client';
    return {
      ...base,
      chain,
      quote,
      // In-scope site work on a site with a maintenance or hosting plan is support work.
      is_support: !quote && chain === 'site' && input.site_has_plan,
      rule,
    };
  };

  switch (input.type) {
    case 'site_change':
      if (build) return toProject(build.scope_locked ? 'site_change/build_locked' : 'site_change/build', build.scope_locked);
      if (charter) return toSite('site_change/retainer', false);
      return toSite('site_change/none', !input.site_has_plan);

    case 'new_page_feature':
      if (build) return toProject('new_page_feature/build', true);
      if (charter) return toSite('new_page_feature/retainer', true);
      return toSite('new_page_feature/none', true);

    case 'content_article': {
      const kind = input.content_kind ?? 'not_sure';
      const retainerKind = kind === 'blog' || kind === 'social_email';
      if (build) {
        if (retainerKind && charter) return toCharter('content_article/build_retainer');
        if (kind === 'page_copy') return toProject(build.scope_locked ? 'content_article/build_page_copy_locked' : 'content_article/build_page_copy', build.scope_locked);
        return toProject('content_article/build', true);
      }
      if (charter) return toCharter('content_article/retainer');
      return toSite('content_article/none', true);
    }

    case 'marketing_question':
      if (charter) return toCharter(build ? 'marketing_question/build_retainer' : 'marketing_question/retainer');
      if (build) return toProject('marketing_question/build', false);
      return { ...toSite('marketing_question/none', false), owner_mike: true };

    case 'broken':
      // The live site is the thing that is broken, whatever is being built. Never a quote.
      if (!input.site_id && build) return toProject('broken/siteless_build', false);
      return toSite(build ? 'broken/build' : charter ? 'broken/retainer' : 'broken/none', false);

    case 'other':
      if (build) return toProject('other/build', false);
      if (charter) return toSite('other/retainer', false);
      return toSite('other/none', false);
  }
}
