// Response formatters for the Troubador control plane.
// Mirror the conventions in formatters.ts: accept loosely-typed Prisma rows,
// coerce Decimals to Number, expose nested client/site/user as light objects.

function lightUser(u: any) {
  return u ? { id: u.id, name: u.name, email: u.email } : null;
}

function lightClient(c: any) {
  return c ? { id: c.id, name: c.name } : null;
}

function lightSite(s: any) {
  return s ? { id: s.id, name: s.name, url: s.url ?? null, site_type: s.site_type ?? null } : null;
}

export function formatScheduleResponse(s: any) {
  return {
    id: s.id,
    client_id: s.client_id,
    client: lightClient(s.client),
    site_id: s.site_id,
    site: lightSite(s.site),
    name: s.name,
    status: s.status,
    target_article_count: s.target_article_count,
    publish_per_week: s.publish_per_week != null ? Number(s.publish_per_week) : null,
    lead_time_days: s.lead_time_days,
    overarching_goals: s.overarching_goals ?? null,
    default_assignee_id: s.default_assignee_id ?? null,
    default_assignee: lightUser(s.default_assignee),
    allow_concurrent: s.allow_concurrent,
    start_date: s.start_date,
    skip_next: s.skip_next,
    last_run_at: s.last_run_at ?? null,
    runs_count: s._count?.runs ?? s.runs?.length ?? 0,
    created_at: s.created_at,
    updated_at: s.updated_at,
  };
}

export function formatProposalResponse(p: any) {
  return {
    id: p.id,
    run_id: p.run_id,
    title: p.title,
    archetype: p.archetype ?? null,
    primary_keyword: p.primary_keyword ?? null,
    search_volume: p.search_volume ?? null,
    keyword_difficulty: p.keyword_difficulty ?? null,
    rationale: p.rationale ?? null,
    source: p.source,
    selected: p.selected,
    saved_for_later: p.saved_for_later,
    created_at: p.created_at,
    updated_at: p.updated_at,
  };
}

export function formatArticleResponse(a: any) {
  return {
    id: a.id,
    run_id: a.run_id,
    client_id: a.client_id,
    client: lightClient(a.client),
    site_id: a.site_id,
    site: lightSite(a.site),
    slug: a.slug,
    title: a.title,
    status: a.status,
    check_state: a.check_state,
    check_report: a.check_report ?? null,
    research_summary: a.research_summary ?? null,
    body: a.body ?? null,
    social_copy: a.social_copy ?? null,
    suggested_date: a.suggested_date ?? null,
    scheduled_date: a.scheduled_date ?? null,
    published_url: a.published_url ?? null,
    approved_at: a.approved_at ?? null,
    approved_by_id: a.approved_by_id ?? null,
    approved_by: lightUser(a.approved_by),
    locked: a.locked,
    claimed_at: a.claimed_at ?? null,
    claimed_by_id: a.claimed_by_id ?? null,
    comments: a.comments?.map(formatArticleCommentResponse),
    comments_count: a._count?.comments ?? a.comments?.length ?? 0,
    created_at: a.created_at,
    updated_at: a.updated_at,
  };
}

export function formatArticleCommentResponse(c: any) {
  return {
    id: c.id,
    article_id: c.article_id,
    user_id: c.user_id ?? null,
    user: lightUser(c.user),
    content: c.content,
    is_feedback: c.is_feedback,
    resolved: c.resolved,
    created_at: c.created_at,
  };
}

export function formatInterviewResponse(i: any) {
  if (!i) return null;
  return {
    id: i.id,
    run_id: i.run_id,
    status: i.status,
    questions: i.questions ?? null,
    transcript: i.transcript ?? null,
    completed_at: i.completed_at ?? null,
    created_at: i.created_at,
    updated_at: i.updated_at,
  };
}

// Aggregate per-article counts for board badges (review-needed surfacing).
function articleStats(articles: any[] | undefined) {
  const list = articles ?? [];
  const by = (s: string) => list.filter((a) => a.status === s).length;
  return {
    total: list.length,
    in_review: by('in_review'),       // articles awaiting editor review (board badge)
    needs_revision: by('needs_revision'),
    approved: by('approved'),
    scheduled: by('scheduled'),
    published: by('published'),
    postponed: by('postponed'),
    dropped: by('dropped'),
  };
}

// List/board shape: counts + light relations, no heavy bodies.
export function formatRunListResponse(r: any) {
  return {
    id: r.id,
    client_id: r.client_id,
    client: lightClient(r.client),
    site_id: r.site_id,
    site: lightSite(r.site),
    schedule_id: r.schedule_id ?? null,
    title: r.title,
    stage: r.stage,
    ready: r.ready,
    selection_ready: r.selection_ready,
    assignee_id: r.assignee_id ?? null,
    assignee: lightUser(r.assignee),
    interview_status: r.interview?.status ?? null,
    article_stats: articleStats(r.articles),
    proposals_count: r._count?.proposals ?? r.proposals?.length ?? 0,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

// Detail shape: full brief, proposals, articles, interview.
export function formatRunDetailResponse(r: any) {
  return {
    ...formatRunListResponse(r),
    brief: r.brief ?? null,
    goal_type: r.goal_type ?? null,
    target_offering: r.target_offering ?? null,
    must_cover: r.must_cover ?? null,
    avoid: r.avoid ?? null,
    claimed_at: r.claimed_at ?? null,
    claimed_by_id: r.claimed_by_id ?? null,
    proposals: r.proposals?.map(formatProposalResponse),
    articles: r.articles?.map(formatArticleResponse),
    interview: formatInterviewResponse(r.interview),
  };
}
