/**
 * WHO READS WHAT OF A PLAN, in one place (P10; Mike, 2026-11-13: "Your thoughts on who sees what are fine for now. We'll change it later if we need to").
 * Every read of a plan (GET /api/tasks/:id/plan, the project plan link, the Plan tab) goes through `planReaderOf` (may this caller read at all, and
 * as which kind of reader) and `viewOf` (what that reader gets of one section). To change the policy, change this file and nothing else.
 *
 *   owner       Mike's own session or his key with no lane, the chat lane and the Dox lane: everything, in Triage and after release.
 *   staff       a PM or an admin who is not the owner, after release: everything (Triage-stage rules stay: while the card is in Triage only the
 *               owner, the chat lane and Dox read it, everyone else gets the same 404 as a card that does not exist).
 *   contractor  a tech user on the task, after release: Requirements, Dates, Work to note, Risks and Examples, each line's source reduced to a short
 *               label (no names, no addresses, no links to mail). Team shows staff only (the client's contacts and outside parties are withheld).
 *               Withheld entirely: Billing model (items and notes), Decisions, anything marked wrong and who marked it, the "was" and "changed by"
 *               detail, the answered questions that came through the plan, the deal's name and link, and change lines that describe withheld sections.
 *   designer    nothing, ever.
 */
import type { AuthPayload } from '@/lib/auth/middleware';
import { MIKE_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { isDoxLane } from '@/lib/dox/guard';
import { isChatLane } from './questions';
import type { PlanSectionName } from './plan-schema';
import { shortDay } from './plan-summary';

type Auth = Pick<AuthPayload, 'userId' | 'role' | 'via' | 'lane' | 'laneEnforced'>;

export type PlanReader = 'owner' | 'staff' | 'contractor';
export type SectionView = 'full' | 'contractor' | 'staff_only' | 'none';

/** The owner is Mike signed in, or Mike's key with no lane. A lane key minted under his user is NOT the owner (only the named lanes below are). */
export function isPlanOwner(auth: Auth): boolean {
  return auth.userId === MIKE_USER_ID && (auth.via === 'session' || !auth.lane);
}

/** Null = the caller may not read this plan at all (the route answers 404). */
export function planReaderOf(task: { status: string }, auth: Auth): PlanReader | null {
  if (auth.role === 'designer') return null;
  if (task.status === 'triage') {
    if (auth.role === 'tech') return null;
    if (isPlanOwner(auth) || isChatLane(auth) || isDoxLane(auth)) return 'owner';
    return null;
  }
  if (auth.role === 'tech') return 'contractor';
  return isPlanOwner(auth) || isChatLane(auth) || isDoxLane(auth) ? 'owner' : 'staff';
}

const CONTRACTOR_VIEW: Record<PlanSectionName, SectionView> = {
  requirements: 'contractor',
  dates: 'contractor',
  team: 'staff_only',
  billing: 'none',
  planned_tasks: 'contractor',
  risks: 'contractor',
  examples: 'contractor',
  decisions: 'none',
};

/** What this reader gets of one section. */
export function viewOf(reader: PlanReader, section: PlanSectionName): SectionView {
  return reader === 'contractor' ? CONTRACTOR_VIEW[section] : 'full';
}

/** The deal's name and link, the answered questions and the lines marked wrong are the owner's and the staff's. */
export const contractorSeesAnsweredQuestions = false;
export const contractorSeesDeal = false;

const DOC_WORDS: [RegExp, string][] = [
  [/\bsow\b|statement of work/i, 'Signed SOW'],
  [/\bproposal\b/i, 'Proposal'],
  [/\bcontract\b/i, 'Contract'],
  [/\bbrief\b/i, 'Brief'],
  [/\bspec(ification)?\b/i, 'Spec'],
];

/** A short label for where a line came from, with no names, no addresses and no links: the kind of source, a known document word, and the day. */
export function contractorSourceLabel(source: unknown): { label: string } {
  const s = (source && typeof source === 'object' ? source : {}) as { label?: unknown; kind?: unknown; date?: unknown };
  const date = typeof s.date === 'string' ? s.date : undefined;
  const day = date ? shortDay(date) : null;
  const kind = typeof s.kind === 'string' ? s.kind : 'other';
  let base: string;
  if (kind === 'email') base = 'Client email';
  else if (kind === 'deal') base = 'Signed deal';
  else if (kind === 'mike_typed') base = 'Owner note';
  else if (kind === 'session') base = 'Session note';
  else if (kind === 'web') base = 'Web page';
  else if (kind === 'document') base = DOC_WORDS.find(([re]) => re.test(typeof s.label === 'string' ? s.label : ''))?.[1] ?? 'Document';
  else base = 'Source on file';
  return { label: day ? `${base}, ${day}` : base };
}

const OUTSIDE = 'An outside party';

/** One plan line as a contractor may read it. Null drops the line (a line marked wrong is not shown to a contractor). */
export function contractorItem(section: PlanSectionName, item: Record<string, unknown>): Record<string, unknown> | null {
  if (item.marked_wrong === true) return null;
  const out: Record<string, unknown> = { ...item };
  for (const k of ['was', 'changed_by', 'marked_wrong_at', 'marked_wrong_by']) delete out[k];
  out.marked_wrong = false;
  out.marked_wrong_at = null;
  out.marked_wrong_by = null;
  if ('source' in out && out.source) out.source = contractorSourceLabel(out.source);
  if (section === 'team') {
    const person = out.person as { user_id?: string } | undefined;
    if (!person || !person.user_id) return null; // a client contact or an outside party
  }
  if (section === 'planned_tasks') {
    const f = out.for as { name?: string; org?: string } | undefined;
    if (f && typeof f.name === 'string') {
      out.for = { name: OUTSIDE };
      out.for_name = OUTSIDE;
    }
  }
  return out;
}
