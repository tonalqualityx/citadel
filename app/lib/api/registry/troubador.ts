import type { ApiEndpoint } from './index';

// Troubador content control plane. The Bast-machine worker authenticates with a
// Bearer API key for the "Troubador" service user and polls the work-queue, then
// posts results back via upserts (keyed by run id + article slug). Human gates
// (ready / selection_ready / approval) are never advanced past by the worker.
export const troubadorEndpoints: ApiEndpoint[] = [
  {
    path: '/api/troubador/work-queue',
    group: 'troubador',
    methods: [
      {
        method: 'GET',
        summary: 'Worker entry point: actionable items across all runs, ordered by urgency.',
        auth: 'required',
        responseNotes:
          'Returns one entry per unit of machine work the worker should do next. action ∈ generate_proposals | create_articles | research_article | post_interview_questions | draft_article | rewrite_article | publish_article. Respects human gates and leases.',
        responseExample: {
          items: [
            {
              action: 'string',
              run_id: 'uuid',
              run_stage: 'string',
              client: { id: 'uuid', name: 'string' },
              site: { id: 'uuid', name: 'string', site_type: 'eleventy|wordpress|null' },
              article_id: 'uuid|null',
              article_slug: 'string|null',
              urgency_date: 'ISO-8601|null',
            },
          ],
          count: 'number',
        },
      },
    ],
  },
  {
    path: '/api/troubador/schedules',
    group: 'troubador',
    methods: [
      {
        method: 'GET',
        summary: 'List content schedules (defaults to active only).',
        auth: 'required',
        queryParams: [
          { name: 'status', type: 'string', required: false, description: 'active | paused | ended (default active)' },
          { name: 'client_id', type: 'uuid', required: false, description: 'Filter by client' },
          { name: 'page', type: 'number', required: false, description: 'Page number' },
          { name: 'limit', type: 'number', required: false, description: 'Items per page' },
        ],
        responseExample: {
          schedules: [
            {
              id: 'uuid',
              name: 'string',
              status: 'active|paused|ended',
              client: { id: 'uuid', name: 'string' },
              site: { id: 'uuid', name: 'string' },
              target_article_count: 'number',
              publish_per_week: 'number',
              lead_time_days: 'number',
              allow_concurrent: 'boolean',
              start_date: 'ISO-8601',
              default_assignee: { id: 'uuid', name: 'string' },
            },
          ],
          pagination: { page: 'number', limit: 'number', total: 'number', totalPages: 'number' },
        },
      },
      {
        method: 'POST',
        summary: 'Create a content schedule.',
        auth: 'required',
        roles: ['pm', 'admin'],
        bodySchema: [
          { name: 'client_id', type: 'uuid', required: true, description: 'Client' },
          { name: 'site_id', type: 'uuid', required: true, description: 'Site' },
          { name: 'name', type: 'string', required: true, description: 'Schedule name' },
          { name: 'target_article_count', type: 'number', required: false, description: 'Soft target per run' },
          { name: 'publish_per_week', type: 'number', required: false, description: 'Publish throughput' },
          { name: 'lead_time_days', type: 'number', required: false, description: 'Lead time before calendar runs dry' },
          { name: 'overarching_goals', type: 'string', required: false, description: 'Default brief goals' },
          { name: 'default_assignee_id', type: 'uuid', required: false, description: 'Default editor' },
          { name: 'allow_concurrent', type: 'boolean', required: false, description: 'Stack policy (default false)' },
          { name: 'start_date', type: 'ISO-8601', required: true, description: 'First run instantiation date' },
        ],
        responseExample: { id: 'uuid', name: 'string', status: 'active', created_at: 'ISO-8601' },
      },
    ],
  },
  {
    path: '/api/troubador/schedules/:id',
    group: 'troubador',
    methods: [
      {
        method: 'GET',
        summary: 'Get a content schedule.',
        auth: 'required',
        responseExample: {
          id: 'uuid',
          name: 'string',
          status: 'active|paused|ended',
          target_article_count: 'number',
          publish_per_week: 'number',
          lead_time_days: 'number',
          overarching_goals: 'string|null',
          allow_concurrent: 'boolean',
          start_date: 'ISO-8601',
          skip_next: 'boolean',
          last_run_at: 'ISO-8601|null',
        },
      },
      {
        method: 'PATCH',
        summary: 'Update schedule fields, pause/resume, skip-once.',
        auth: 'required',
        roles: ['pm', 'admin'],
        responseExample: { id: 'uuid', status: 'string', updated_at: 'ISO-8601' },
      },
      {
        method: 'DELETE',
        summary: 'Soft-delete (end) a schedule.',
        auth: 'required',
        roles: ['pm', 'admin'],
        responseExample: { success: true },
      },
    ],
  },
  {
    path: '/api/troubador/runs',
    group: 'troubador',
    methods: [
      {
        method: 'GET',
        summary: 'List/board content runs with per-article stats (review-needed badge).',
        auth: 'required',
        queryParams: [
          { name: 'stage', type: 'string', required: false, description: 'Filter by single stage' },
          { name: 'statuses', type: 'string', required: false, description: 'Comma-separated stage list' },
          { name: 'client_id', type: 'uuid', required: false, description: 'Filter by client' },
          { name: 'site_id', type: 'uuid', required: false, description: 'Filter by site' },
          { name: 'assignee_id', type: 'uuid', required: false, description: 'Filter by editor' },
          { name: 'page', type: 'number', required: false, description: 'Page number' },
          { name: 'limit', type: 'number', required: false, description: 'Items per page' },
        ],
        responseExample: {
          runs: [
            {
              id: 'uuid',
              title: 'string',
              stage: 'planning|topic_selection|researching|ready_for_interview|in_production|done|cancelled',
              ready: 'boolean',
              selection_ready: 'boolean',
              client: { id: 'uuid', name: 'string' },
              site: { id: 'uuid', name: 'string' },
              assignee: { id: 'uuid', name: 'string' },
              interview_status: 'pending|in_progress|complete|null',
              article_stats: { total: 'number', in_review: 'number', approved: 'number', published: 'number' },
              proposals_count: 'number',
            },
          ],
          pagination: { page: 'number', limit: 'number', total: 'number', totalPages: 'number' },
        },
      },
      {
        method: 'POST',
        summary: 'Create a manual content run (assignee defaults to creator).',
        auth: 'required',
        roles: ['pm', 'admin'],
        bodySchema: [
          { name: 'client_id', type: 'uuid', required: true, description: 'Client' },
          { name: 'site_id', type: 'uuid', required: true, description: 'Site' },
          { name: 'title', type: 'string', required: true, description: 'Run title' },
          { name: 'brief', type: 'string', required: false, description: 'Campaign brief' },
          { name: 'assignee_id', type: 'uuid', required: false, description: 'Editor (defaults to creator)' },
        ],
        responseExample: { id: 'uuid', title: 'string', stage: 'planning', created_at: 'ISO-8601' },
      },
    ],
  },
  {
    path: '/api/troubador/runs/:id',
    group: 'troubador',
    methods: [
      {
        method: 'GET',
        summary: 'Full run detail: brief, proposals, articles, interview.',
        auth: 'required',
        responseExample: {
          id: 'uuid',
          title: 'string',
          stage: 'string',
          brief: 'string|null',
          ready: 'boolean',
          selection_ready: 'boolean',
          article_stats: { total: 'number', in_review: 'number' },
          proposals: [{ id: 'uuid', title: 'string', selected: 'boolean' }],
          articles: [{ id: 'uuid', slug: 'string', title: 'string', status: 'string' }],
          interview: { id: 'uuid', status: 'string', questions: 'object|null' },
        },
      },
      {
        method: 'PATCH',
        summary: 'Update brief, set human gates (ready / selection_ready), reassign editor, cancel.',
        auth: 'required',
        responseNotes:
          'Setting ready/selection_ready are the human gates the worker waits on. Stage itself advances via worker endpoints, not here (except cancel).',
        responseExample: { id: 'uuid', stage: 'string', ready: 'boolean', updated_at: 'ISO-8601' },
      },
    ],
  },
  {
    path: '/api/troubador/runs/:id/claim',
    group: 'troubador',
    methods: [
      {
        method: 'POST',
        summary: 'Worker: lease run-level work (single-flight, prevents double-processing).',
        auth: 'required',
        responseExample: { claimed: 'boolean', claimed_at: 'ISO-8601|null' },
      },
    ],
  },
  {
    path: '/api/troubador/runs/:id/proposals',
    group: 'troubador',
    methods: [
      {
        method: 'GET',
        summary: 'List topic proposals for a run.',
        auth: 'required',
        responseExample: {
          proposals: [
            {
              id: 'uuid',
              title: 'string',
              archetype: 'pillar|thought_leadership|case_study|how_to|commodity|null',
              primary_keyword: 'string|null',
              search_volume: 'number|null',
              keyword_difficulty: 'number|null',
              source: 'troubador|human',
              selected: 'boolean',
              saved_for_later: 'boolean',
            },
          ],
        },
      },
      {
        method: 'POST',
        summary: 'Worker: upsert topic proposals; advance planning → topic_selection.',
        auth: 'required',
        responseNotes: 'Guarded: run must be in planning with ready=true. Replaces prior troubador-sourced proposals; preserves human-added ones.',
        responseExample: { run_id: 'uuid', stage: 'topic_selection', proposals_count: 'number' },
      },
      {
        method: 'PATCH',
        summary: 'Human: select topics, add custom topics, save-for-later.',
        auth: 'required',
        responseExample: { run_id: 'uuid', selected_count: 'number' },
      },
    ],
  },
  {
    path: '/api/troubador/runs/:id/articles',
    group: 'troubador',
    methods: [
      {
        method: 'POST',
        summary: 'Worker: create article items from selected topics; advance topic_selection → researching.',
        auth: 'required',
        responseNotes: 'Guarded: run in topic_selection with selection_ready=true. Idempotent upsert by article slug.',
        responseExample: { run_id: 'uuid', stage: 'researching', articles_count: 'number' },
      },
    ],
  },
  {
    path: '/api/troubador/runs/:id/interview-questions',
    group: 'troubador',
    methods: [
      {
        method: 'POST',
        summary: 'Worker: attach consolidated prep questions; advance researching → ready_for_interview.',
        auth: 'required',
        responseNotes: 'Guarded: all selected articles must be researched.',
        responseExample: { run_id: 'uuid', stage: 'ready_for_interview', interview_status: 'pending' },
      },
    ],
  },
  {
    path: '/api/troubador/runs/:id/interview-complete',
    group: 'troubador',
    methods: [
      {
        method: 'POST',
        summary: 'CLI skill: mark the live interview complete; advance ready_for_interview → in_production.',
        auth: 'required',
        bodySchema: [
          { name: 'transcript', type: 'string', required: false, description: 'Interview transcript or ref' },
        ],
        responseExample: { run_id: 'uuid', stage: 'in_production', interview_status: 'complete' },
      },
    ],
  },
  {
    path: '/api/troubador/articles/:id',
    group: 'troubador',
    methods: [
      {
        method: 'GET',
        summary: 'Get a single article with its feedback thread.',
        auth: 'required',
        responseExample: {
          id: 'uuid',
          slug: 'string',
          title: 'string',
          status: 'string',
          check_state: 'pending|passed|check_failed|compliance_hold',
          body: 'string|null',
          social_copy: 'string|null',
          suggested_date: 'ISO-8601|null',
          scheduled_date: 'ISO-8601|null',
          locked: 'boolean',
          comments: [{ id: 'uuid', content: 'string', is_feedback: 'boolean', user: 'object|null' }],
        },
      },
      {
        method: 'PATCH',
        summary: 'Worker (draft/research/check/status) or human (approve/drop/postpone/edit/schedule).',
        auth: 'required',
        responseNotes:
          'Worker may set research_summary, body, social_copy, check_state, and transitions drafting→in_review / needs_revision→in_review. Worker may NEVER set approved. Human approve sets approved + locks copy (worker stops touching it). Drop = permanent; postpone = parked (does not block run→done). Scheduling avoids same-site same-day collisions.',
        responseExample: { id: 'uuid', status: 'string', locked: 'boolean', updated_at: 'ISO-8601' },
      },
    ],
  },
  {
    path: '/api/troubador/articles/:id/claim',
    group: 'troubador',
    methods: [
      {
        method: 'POST',
        summary: 'Worker: lease an article for drafting/rewrite (locks inline editor during the rewrite).',
        auth: 'required',
        responseExample: { claimed: 'boolean', claimed_at: 'ISO-8601|null' },
      },
    ],
  },
  {
    path: '/api/troubador/articles/:id/comments',
    group: 'troubador',
    methods: [
      {
        method: 'POST',
        summary: 'Human: leave feedback on an article (flips it to needs_revision).',
        auth: 'required',
        bodySchema: [
          { name: 'content', type: 'string', required: true, description: 'Feedback comment' },
        ],
        responseExample: { id: 'uuid', article_id: 'uuid', status: 'needs_revision', created_at: 'ISO-8601' },
      },
    ],
  },
  {
    path: '/api/troubador/calendar',
    group: 'troubador',
    methods: [
      {
        method: 'GET',
        summary: 'Publishing calendar for a site (collision surface for same-site same-day).',
        auth: 'required',
        queryParams: [
          { name: 'site_id', type: 'uuid', required: true, description: 'Site to view the calendar for' },
          { name: 'from', type: 'ISO-8601', required: false, description: 'Range start' },
          { name: 'to', type: 'ISO-8601', required: false, description: 'Range end' },
        ],
        responseExample: {
          site_id: 'uuid',
          entries: [
            {
              article_id: 'uuid',
              title: 'string',
              run_id: 'uuid',
              status: 'scheduled|published',
              date: 'ISO-8601',
            },
          ],
        },
      },
    ],
  },
  {
    path: '/api/troubador/dashboard',
    group: 'troubador',
    methods: [
      {
        method: 'GET',
        summary: "Editor work queue: articles awaiting review + runs needing the current user's action.",
        auth: 'required',
        responseExample: {
          articles_awaiting_review: [{ id: 'uuid', title: 'string', run_id: 'uuid' }],
          runs_in_planning: [{ id: 'uuid', title: 'string' }],
          runs_in_topic_selection: [{ id: 'uuid', title: 'string' }],
          runs_ready_for_interview: [{ id: 'uuid', title: 'string' }],
        },
      },
    ],
  },
  {
    path: '/api/cron/troubador-scheduler',
    group: 'troubador',
    methods: [
      {
        method: 'POST',
        summary: 'Cron: instantiate due runs from active schedules (keep-calendar-full + lead time).',
        auth: 'cron',
        responseNotes: 'Respects stack policy, skip-once, start-date; never backfills missed runs.',
        responseExample: { success: true, runs_created: 'number', skipped: 'number' },
      },
    ],
  },
];
