/**
 * The plan of a Triage card (Mike, 2026-11-13: "an ongoing description that is different than the task of conducting the triage ... Sections
 * for requirements, dates, team, billing model", plus examples and decisions). Pure: no database, safe in the browser.
 *
 * MODEL. One table, TaskPlanItem(task, section, position, data), keeps every section a list of items. `data` is JSON validated here, one zod
 * schema per section, so a new field is a schema change and not a migration, and the API, the tests and the screen share one definition.
 * Rejected: a table per section (six tables and six sets of routes for lines that are all "one sentence plus where it came from"), and one
 * JSON document per card (a change to one line would rewrite the whole plan, and "Mark wrong" could not be stored on a line).
 *
 * Every line can carry its source (what a document or a person said, with a date and an optional link). Amounts are text exactly as the
 * source states them: nothing here computes, converts or changes a price.
 */
import { z } from 'zod';

export const PLAN_SECTIONS = ['requirements', 'dates', 'team', 'billing', 'examples', 'decisions'] as const;
export type PlanSectionName = (typeof PLAN_SECTIONS)[number];

export const PLAN_SECTION_TITLES: Record<PlanSectionName, string> = {
  requirements: 'Requirements',
  dates: 'Dates',
  team: 'Team',
  billing: 'Billing model',
  examples: 'Examples',
  decisions: 'Decisions',
};

/** One muted line per empty section: what goes there, so the shape is visible before it is filled. */
export const PLAN_EMPTY_LINES: Record<PlanSectionName, string> = {
  requirements: 'What the work has to do, one line each, with where each came from.',
  dates: 'Start, design handoff, staging, launch and any other date, with where each came from.',
  team: 'Who is on it and as what. What will be yours is listed first.',
  billing: 'How this is billed: retainer, hourly, milestones, or not billed. Milestones with amount and trigger.',
  examples: 'Links to example sites or pages, with what each is an example of.',
  decisions: 'What was decided, by whom and from what.',
};

export const PLAN_LIMITS = {
  requirements: 150,
  dates: 40,
  team: 40,
  billing: 31, // one basis line and up to 30 milestones
  examples: 40,
  decisions: 100,
} as const;

export const MARKS = ['original', 'changed', 'added', 'dropped'] as const;
export type PlanMark = (typeof MARKS)[number];
export const MARK_LABELS: Record<PlanMark, string> = { original: 'Original', changed: 'Changed', added: 'Added', dropped: 'Dropped' };

const oneLine = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((v) => !/[\r\n]/.test(v), { message: 'One line only: no line breaks.' });
const optLine = (max: number) => oneLine(max).optional();

/** A calendar day, YYYY-MM-DD and a real date. */
export const planDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'A date is YYYY-MM-DD.')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T12:00:00Z`)) && new Date(`${v}T12:00:00Z`).toISOString().startsWith(v), { message: 'That is not a real date.' });

/** A link a reader may click: a web address, or a path inside Citadel (a deal, a task). Never a script or data address. */
export const planLink = z
  .string()
  .trim()
  .max(500)
  .refine((v) => /^https?:\/\/[^\s]+$/i.test(v) || /^\/[A-Za-z0-9][^\s]*$/.test(v), { message: 'A link is an http or https address, or a path starting with /.' });

export const SOURCE_KINDS = ['mike_typed', 'document', 'email', 'deal', 'session', 'web', 'other'] as const;
export type PlanSourceKind = (typeof SOURCE_KINDS)[number];

/** Where a line came from: a document name and section, an email sender and date, "Mike, typed in chat", "signed deal". */
export const sourceSchema = z
  .object({
    label: oneLine(200),
    date: planDay.optional(),
    url: planLink.optional(),
    /** Lets the chat say whether Mike typed it himself or a document said it. A document is never recorded as words Mike typed. */
    kind: z.enum(SOURCE_KINDS).optional(),
  })
  .strict();
export type PlanSource = z.infer<typeof sourceSchema>;

const markFields = {
  mark: z.enum(MARKS).default('original'),
  /** The earlier wording, when mark is changed. */
  was: optLine(200),
  /** What changed it (a later email, a call), or what dropped it. */
  changed_by: optLine(200),
};

function markRules<T extends { mark: PlanMark; was?: string; changed_by?: string }>(v: T, ctx: z.RefinementCtx) {
  if (v.mark === 'changed') {
    if (!v.was) ctx.addIssue({ code: 'custom', path: ['was'], message: 'A changed line says what it was ("was ...").' });
    if (!v.changed_by) ctx.addIssue({ code: 'custom', path: ['changed_by'], message: 'A changed line says what changed it.' });
  }
}

export const requirementItem = z
  .object({ text: oneLine(200), source: sourceSchema, ...markFields })
  .strict()
  .superRefine(markRules);

export const dateItem = z
  .object({
    /** start, design handoff, staging, launch, or free text. */
    label: oneLine(80),
    date: planDay,
    source: sourceSchema,
    ...markFields,
  })
  .strict()
  .superRefine(markRules);

export const personSchema = z.union([
  z.object({ user_id: z.string().uuid() }).strict(),
  z.object({ name: oneLine(120), org: optLine(120) }).strict(),
]);
export const teamItem = z
  .object({
    /** A Citadel user, or a named outside party such as a designer or a client contact. */
    person: personSchema,
    role: oneLine(120),
    note: optLine(200),
    source: sourceSchema.optional(),
  })
  .strict();

export const BILLING_KINDS = ['retainer', 'hourly', 'milestones', 'internal', 'unknown'] as const;
export type BillingKind = (typeof BILLING_KINDS)[number];

export const billingBasis = z
  .object({
    type: z.literal('basis'),
    kind: z.enum(BILLING_KINDS),
    /** The deal or retainer it refers to, by link when one exists. */
    refers_to: z.object({ label: oneLine(200), href: planLink.optional() }).strict().optional(),
    /** true: the figures match Citadel's records. false: they differ. null: not checked (shown as "from a document, not yet confirmed"). */
    matches_citadel: z.boolean().nullable().default(null),
    note: optLine(200),
    source: sourceSchema,
  })
  .strict();
export const billingMilestone = z
  .object({
    type: z.literal('milestone'),
    label: oneLine(120),
    /** Exactly as the source states it ("$4,500", "50% of the fee"). Never computed. */
    amount: oneLine(60),
    trigger: oneLine(200),
    due: planDay.optional(),
    source: sourceSchema.optional(),
  })
  .strict();
export const billingItem = z.discriminatedUnion('type', [billingBasis, billingMilestone]);

export const exampleItem = z
  .object({
    url: planLink,
    title: optLine(120),
    /** What this is an example of. */
    note: oneLine(200),
    source: sourceSchema,
  })
  .strict();

export const decisionItem = z.object({ text: oneLine(200), source: sourceSchema }).strict();

export const ITEM_SCHEMAS = {
  requirements: requirementItem,
  dates: dateItem,
  team: teamItem,
  billing: billingItem,
  examples: exampleItem,
  decisions: decisionItem,
} as const;

export function isSection(v: string): v is PlanSectionName {
  return (PLAN_SECTIONS as readonly string[]).includes(v);
}

/** A date label that names a project's own start or launch date. Those two stay the project's fields of record (PATCH /triage). */
export function isProjectDateLabel(label: string): boolean {
  return /^(project )?(start|launch)( date)?$/i.test(label.trim());
}
export const PROJECT_DATE_MESSAGE = 'The start and launch dates of a project card are set with PATCH /api/tasks/:id/triage (target_start_date, target_launch_date) and shown here from the project. Do not repeat them as plan dates.';

/** The change line a plan write leaves: "Plan: Billing model updated by the chat". */
export function planChangeLine(section: PlanSectionName, by: string): string {
  return `Plan: ${PLAN_SECTION_TITLES[section]} updated by ${by}`;
}

export const WRONG_NOTE = 'Mike marked this wrong';

export const itemId = z.string().uuid();

/** Body of PUT /api/tasks/:id/plan/:section. Items that carry an `id` keep that line (and its Mark wrong flag if the words are unchanged); items without one are new; lines not listed are removed. */
export const putBody = z.object({ items: z.array(z.record(z.string(), z.unknown())).max(200), description: optLine(240) }).strict();

/** Body of PATCH /api/tasks/:id/plan/:section: exactly one operation. */
export const patchBody = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add'), item: z.record(z.string(), z.unknown()), description: optLine(240) }).strict(),
  z.object({ op: z.literal('change'), id: itemId, item: z.record(z.string(), z.unknown()), description: optLine(240) }).strict(),
  z.object({ op: z.literal('remove'), id: itemId, description: optLine(240) }).strict(),
  z.object({ op: z.literal('mark_wrong'), id: itemId, wrong: z.boolean(), description: optLine(240) }).strict(),
]);

/** What GET returns for one line: its fields flattened, plus the bookkeeping. */
export type PlanItemOut = Record<string, unknown> & {
  id: string;
  position: number;
  marked_wrong: boolean;
  marked_wrong_at: string | null;
  marked_wrong_by: string | null;
  updated_at: string;
  updated_by: string;
};

export interface PlanSectionOut {
  section: PlanSectionName;
  title: string;
  items: PlanItemOut[];
  /** True for the billing section of a viewer who may not see prices (a contractor on a released card). */
  withheld?: boolean;
  updated_at: string | null;
  updated_by: string | null;
  /** The one-line description the writer gave, when it gave one. */
  note: string | null;
}

/** A question Mike answered, read through from the Questions data (never copied into the plan). */
export interface PlanAnsweredQuestion {
  id: string;
  question: string;
  answer: string;
  answered_at: string | null;
  /** True when the answer is his own words (typed or tapped); a defaulted question never appears here. */
  by_mike: true;
}

export interface PlanProjectBlock {
  project_id: string;
  name: string;
  status: string;
  start_date: string | null;
  target_date: string | null;
  mike_parts: { phase: string; text: string }[];
  phases: { id: string; name: string; summary: string | null; mike_part: string | null }[];
  sitemap: { id: string; name: string; page_type: string | null; needs_design: boolean; notes: string | null }[];
  deal: { id: string; name: string; href: string } | null;
}

export interface PlanOut {
  task_id: string;
  /** The card's status; the plan stays readable after release. */
  status: string;
  triage_rev: number;
  viewer: { can_write: boolean; is_owner: boolean };
  sections: PlanSectionOut[];
  /** The latest plan write: when and by whom. null when nothing was ever written. */
  updated_at: string | null;
  updated_by: string | null;
  answered_questions: PlanAnsweredQuestion[];
  /** Project cards: the shape, sitemap, dates and deal as the project holds them, read through. null otherwise. */
  project: PlanProjectBlock | null;
}
