// Troubador (SEO/AEO content engine) API types

export type RunStage =
  | 'planning'
  | 'topic_selection'
  | 'researching'
  | 'ready_for_interview'
  | 'in_production'
  | 'done'
  | 'cancelled';

export type ArticleStatus =
  | 'pending_research'
  | 'researched'
  | 'drafting'
  | 'in_review'
  | 'needs_revision'
  | 'approved'
  | 'scheduled'
  | 'published'
  | 'postponed'
  | 'dropped';

export type ScheduleStatus = 'active' | 'paused' | 'cancelled' | string;

export interface NamedRef {
  id: string;
  name: string;
}

export interface ArticleStats {
  total: number;
  in_review: number;
  needs_revision: number;
  approved: number;
  scheduled: number;
  published: number;
  postponed: number;
  dropped: number;
}

export interface Run {
  id: string;
  title: string;
  stage: RunStage;
  ready: boolean;
  selection_ready: boolean;
  client: NamedRef;
  site: NamedRef;
  assignee: NamedRef | null;
  interview_status: string | null;
  article_stats: ArticleStats;
  proposals_count: number;
}

export interface Proposal {
  id: string;
  title: string;
  primary_keyword?: string | null;
  archetype?: string | null;
  selected?: boolean;
  save_for_later?: boolean;
}

export interface ArticleComment {
  id: string;
  content: string;
  is_feedback: boolean;
  user: NamedRef | null;
  created_at: string;
}

export interface Article {
  id: string;
  run_id: string;
  slug: string;
  title: string;
  status: ArticleStatus;
  check_state: string | null;
  body: string | null;
  social_copy: string | null;
  research_summary: string | null;
  suggested_date: string | null;
  scheduled_date: string | null;
  locked: boolean;
  approved_by: NamedRef | string | null;
  comments: ArticleComment[];
}

export interface RunInterview {
  status: string | null;
  questions?: string[] | { question: string; answer?: string }[] | null;
  [key: string]: unknown;
}

export interface RunDetail extends Run {
  brief: string | null;
  goal_type: string | null;
  target_offering: string | null;
  must_cover: string | null;
  avoid: string | null;
  proposals: Proposal[];
  articles: Article[];
  interview: RunInterview | null;
}

export interface RunListResponse {
  runs: Run[];
  pagination?: {
    total: number;
    page: number;
    limit: number;
    totalPages?: number;
  };
}

export interface CreateRunInput {
  client_id: string;
  site_id: string;
  title: string;
  brief?: string;
  assignee_id?: string;
}

export interface UpdateRunInput {
  brief?: string;
  goal_type?: string;
  target_offering?: string;
  must_cover?: string;
  avoid?: string;
  ready?: boolean;
  selection_ready?: boolean;
  assignee_id?: string | null;
  action?: 'cancel';
}

export interface UpdateProposalsInput {
  select?: string[];
  deselect?: string[];
  save_for_later?: string[];
  add?: { title: string; primary_keyword?: string; archetype?: string }[];
}

export type ArticleAction =
  | 'approve'
  | 'drop'
  | 'postpone'
  | 'reactivate'
  | 'schedule';

export interface UpdateArticleInput {
  body?: string;
  social_copy?: string;
  title?: string;
  scheduled_date?: string | null;
  action?: ArticleAction;
}

export interface Schedule {
  id: string;
  name: string;
  status: ScheduleStatus;
  client: NamedRef;
  site: NamedRef;
  target_article_count: number | null;
  publish_per_week: number | null;
  lead_time_days: number | null;
  allow_concurrent: boolean;
  start_date: string | null;
  default_assignee: NamedRef | null;
  overarching_goals: string | null;
}

export interface ScheduleListResponse {
  schedules: Schedule[];
  pagination?: {
    total: number;
    page: number;
    limit: number;
    totalPages?: number;
  };
}

export interface CreateScheduleInput {
  client_id: string;
  site_id: string;
  name: string;
  target_article_count?: number;
  publish_per_week?: number;
  lead_time_days?: number;
  overarching_goals?: string;
  default_assignee_id?: string;
  allow_concurrent?: boolean;
  start_date: string;
}

export interface UpdateScheduleInput {
  name?: string;
  status?: ScheduleStatus;
  target_article_count?: number;
  publish_per_week?: number;
  lead_time_days?: number;
  overarching_goals?: string;
  default_assignee_id?: string | null;
  allow_concurrent?: boolean;
  start_date?: string;
}

export interface CalendarEntry {
  article_id: string;
  title: string;
  run_id: string;
  status: ArticleStatus;
  date: string;
}

export interface CalendarResponse {
  site_id: string;
  entries: CalendarEntry[];
}
