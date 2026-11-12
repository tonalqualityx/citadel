/**
 * Home screen Slice 1: from raw loader inputs to the lists behind the tiles (plan 1.2, 1.3,
 * task H4).
 *
 * selectHome() takes the raw inputs, the user's item states and "now", and returns:
 * - `sections` and `everything_else`, exactly as the HomeResponse carries them;
 * - `candidates`, every item the screen can show anywhere (including parked, queued and
 *   Everything-else items), each with its internal ranking facts. today.ts reads these to
 *   propose the day. Candidates never leave the server; only `candidate.item` does.
 *
 * Placement, first match wins, per item:
 *   pinned (working_since)                      -> Things in progress
 *   meets an emergency rule, not marked
 *   "Not an emergency"                          -> Needs you now (view_at is ignored)
 *   Not now still running (view_at in future)   -> Everything else, "Parked by you"
 *   given a day by the nightly sort, day ahead  -> Everything else, "Given a day to come back"
 *   thread older than 21 days                   -> Everything else, "Older open threads"
 *   other venture, not boosted, not fresh       -> Everything else, "Other ventures"
 *   qualifying thread, newest ask is sales      -> Sales leads waiting
 *   other qualifying thread                     -> Client emails waiting (3 visible)
 *   task, sign-off, session ask, wait in view
 *   that meets the Next rule (a fresh or
 *   arrived task meets it)                      -> Decisions ready (3 visible)
 *   everything else (overflow, not yet due)     -> Everything else, "Waiting their turn"
 *
 * No score, class, emergency rule or quadrant is placed on any HomeItem.
 */

import { calculateEstimatedMinutes } from '@/lib/calculations/energy';
import { actionsFor } from './actions-for';
import {
  IF_IGNORED,
  REASON,
  REST_GROUP_COPY,
  ageWords,
  daysSince,
  displayText,
  effortWords,
  everythingElseLine,
  handledLine,
  handledMoreText,
  hardDateChip,
  backOnText,
  reasonEmergency,
  scopeLine,
  whenProjectStarts,
  whyFresh,
  BOT_WHO,
  WHY_BOT_STOPPED,
  withSignOff,
  REST_CHECK,
  WHY_ARRIVED,
  waitedFor,
  whyEmergency,
  whySession,
  whySignOff,
  whyTask,
  whyThread,
  whyWait,
} from './copy';
import {
  arcGroupKey,
  clientGroupKey,
  crisisKey,
  projectGroupKey,
  reviewKey,
  sessionKey,
  siteKey,
  stepKey,
  taskKey,
  threadKey,
  waitKey,
  OWN_GROUP_KEY,
} from './item-key';
import {
  HANDS_IF_IGNORED,
  HANDS_REASON,
  HANDS_SUMMARY,
  HANDS_WHY_NOW,
  SECURITY_NEVER_RULE,
  SITE_RULED_CHECK,
  minutesWord,
  outsideCheckLine,
  siteSummary,
} from './emergency/copy';
import { HANDS_ITEM_KEY, HANDS_REST_GROUP, handsRow, isHandsTask, type HandsTask } from './emergency/hands';
import { matchesNotEmergencyRule, ruleScopesFor } from './emergency/rule';
import { siteDownItems, siteHostOf, type IncidentRow, type SiteDownItem } from './emergency/site';
import { AUTO_DRAFT_LINE, LEAD_ASK, NEW_MESSAGE_AFTER_DRAFT, SHORT_READY_LINE, WOKE_LINE, IF_IGNORED_4C, leadDueLine, waitingLine } from './owed/copy';
import { bookLine, bookedLine } from './owed/book-copy';
import { notSentLine, sendFailureReason, sentLine, sendingLine } from './owed/send-copy';
import { isLeadNow, leadResurfacedPastPark, owedClock, weekdayIn, wokeByNewMessage } from './owed/clock';
import { mergeJoinedThreads, repliedElsewhere, type JoinRow } from './owed/join';
import { hasBastDraft, ifIgnoredLine, owedSecondLine, owedStatus, type OwedRow, type OwedState } from './owed/state';
import { cardSummary, truncateWords } from './plain-text';
import { applyWeights, type WeightRow } from './learn/apply';
import { effortExtras, learnedFooter, timeBasisSentence } from './learn/copy';
import { evidenceKeys, isLearnableKey } from './learn/evidence';
import { ON_DAY_REASON, ON_DAY_WHY_NOW, SNOOZE_BACK_WHY, dayChoices, isDayArrived, isDayParked, isSnoozeBack, isSnoozeParked, onDayCheckText, snoozeCheckText, snoozeChoices } from './on-day';
import { STEP_IF_IGNORED, dedupeSteps, stepReason, stepTitle, stepVisibility, stepWhyNow } from './projects/step';
import { buildProposalDraft, proposalOrder, type ProposalDraft } from './reconcile/card';
import { FINISHED_CARD } from '@/lib/work/finished-copy';
import { SESSION_FINISHED, sessionCardTitle } from '@/lib/work/session-copy';
import { ATTACH_CARD } from '@/lib/work/attach-copy';
import { FINISHED_CARD_KEY, buildItemKey } from './item-key';
import { nextStepSource } from './projects/copy';
import { descriptionHash, readStoredChecklist } from './summary-hash';
import { emailLinkLabel, HANDLED_MAIL, recordedLine, handledReason } from '@/lib/work/copy';
import { askRef } from '@/lib/work/intake';
import { stripSubjectPrefix } from '@/lib/email-asks';
import {
  CAPS,
  FRESH_NEW,
  MINUTES,
  NEXT_ENTRY,
  OPEN_WAIT_STATES,
  PROMISED_DATE_EMERGENCY_BUSINESS_DAYS,
  PRICE_REVIEW_WAIT_TEMPLATE,
  OWN_GROUP_LABEL,
  THREAD_MAX_AGE_DAYS,
  THREAD_MIN_AGE_BUSINESS_DAYS,
  WAIT_IN_VIEW_STATE,
  businessDaysElapsed,
  businessDaysUntil,
  crisisEmergencyRule,
  isFreshNew,
  isPersonMessage,
  sessionEmergencyRule,
  taskEmergencyRule,
  waitEmergencyRule,
  type EmergencyRule,
} from './rules';
import {
  normalizeDueDate,
  scoreCrisis,
  scoreHands,
  scoreReview,
  scoreSite,
  scoreSession,
  scoreStep,
  scoreTask,
  scoreThread,
  scoreWait,
  STEP_URGENCY_CAP,
  taskHasPersonWaiting,
  threadClient,
  threadProject,
  waitClockStart,
  type Score,
} from './score';
import type {
  HomeEverythingElse,
  HomeEverythingElseGroup,
  HomeHandledMail,
  HomeItem,
  HomeItemType,
  HomeQuietLine,
  HomeRef,
  HomeRestGroupKey,
  HomeRestItem,
  HomeSections,
  HomeSourceKind,
  RawArcRef,
  RawClientRef,
  RawEmailAsk,
  RawFinishedCard,
  RawHomeInputs,
  RawItemState,
  RawProjectRef,
  RawProjectStep,
  RawReviewFold,
  HomeChoice,
  HomeItemAction,
  RawSessionAsk,
  RawSiteIncident,
  RawTask,
  RawThread,
  RawWait,
} from './types';

// ============================================================================
// Candidate
// ============================================================================

export type SectionName = 'needs_you_now' | 'working_on' | 'leads' | 'mail' | 'next' | 'rest';

/** The group Today would propose an item under: an open arc, its client, its project, or own work. */
export interface GroupInfo {
  key: string;
  name: string;
  client: HomeRef | null;
  project: HomeRef | null;
  /** The open arc behind an arc group, else null. */
  arc: RawArcRef | null;
}

/** An item with its internal ranking facts. Server only. */
export interface Candidate {
  key: string;
  kind: HomeSourceKind;
  /** The row and card, without a score or class. Buttons and footer lines are final. */
  item: HomeItem;
  /** The emergency rule met, after "Not an emergency" is applied; null when not an emergency. */
  rule: EmergencyRule | null;
  score: Score;
  boosted: boolean;
  /** Hidden until state.view_at, whoever set it (his Not now or the nightly sort). */
  parked: boolean;
  /** Who set the view_at while parked: 'user' (his Not now) or 'keeper' (the nightly sort). Null when not parked. */
  parkedBy: 'user' | 'keeper' | null;
  /** A task of his tagged from-chat or made by him, inside its first two business days (rules.ts isFreshNew). */
  fresh: boolean;
  /** A task the nightly sort gave a day to, and that day has come (view_set_by keeper, view_at passed). */
  arrived: boolean;
  /** Slice 4c: a client reply on its third business day, or a lead past its clock. It goes to the top of its People tile (after a boosted row). */
  clockDue?: boolean;
  /** "Do it on a day": his day has come. Boosted for that day only; the card says "You said today." */
  dayArrived?: boolean;
  /** "Do it on a day": the emergency rule he parked until a day (rule is null meanwhile). The Slack lifeline line still reads it. */
  dayHeldRule?: EmergencyRule | null;
  /** "Do it on a day": the quick choices for this card's More list (server only; same array for every item). */
  dayChoices?: HomeChoice[];
  /** "Snooze": a snooze ended earlier today; the card says "Back from a snooze." (no boost). */
  snoozeBack?: boolean;
  /** "Snooze": the quick choices for this card's More list (server only). */
  snoozeChoices?: HomeChoice[];
  /** Slice 4c: a thread whose Not now ended early (a new message from them, or a lead that came back at its repeat time). */
  unpark?: boolean;
  /** Slice 3: Bast's task, stopped and tagged needs-mike (RawTask.bot_task). Never a Today step, never in the keeper's pool. */
  botTask: boolean;
  /** Slice 7b: set when a learned weight changed this item's urgency (server only; the screen gets a sentence, never a number). */
  learned?: { key: string; label: string; dir: 'up' | 'down' };
  pinned: boolean;
  /** In Needs you now, Things in progress, a People list, or the visible Next rows. */
  shown: boolean;
  /**
   * In view: qualifies for one of those lists before the caps. A People or Next row beyond its
   * cap is in view but not shown. Today reads this, so a client who waits behind the cap still
   * counts as a group to pick or swap to.
   */
  inView: boolean;
  section: SectionName;
  /** The Everything-else group when section is 'rest'. */
  restGroup: HomeRestGroupKey | null;
  /** When the clock behind its age started (oldest first breaks ties). */
  since: Date;
  /** A person is waiting on it (threads, folds, sessions, waits with a client, promised or requested tasks). */
  personWaiting: boolean;
  /** The hard date (date-only values normalized), or null. */
  hardDate: Date | null;
  minutes: number;
  group: GroupInfo;
  state: RawItemState | undefined;
  /** A task's open arc id, else null. */
  arcId: string | null;
}

export interface SelectInput {
  raw: RawHomeInputs;
  states: RawItemState[];
  now: Date;
}

export interface SelectResult {
  /** Work stage B: Mail recorded as handled, the last 30 days (read only, never counted in Everything else). */
  handled_mail: HomeHandledMail[];
  sections: HomeSections;
  everything_else: HomeEverythingElse;
  candidates: Candidate[];
  byKey: Map<string, Candidate>;
}

// ============================================================================
// Ordering
// ============================================================================

function t(d: Date | null): number {
  return d ? d.getTime() : Number.POSITIVE_INFINITY;
}

function compareKey(a: Candidate, b: Candidate): number {
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/**
 * Overall rank, best first: emergencies, then "This matters more", then consequence class,
 * then urgency (higher first), then the oldest clock, then key (so the order is stable).
 */
export function rankCompare(a: Candidate, b: Candidate): number {
  if ((a.rule !== null) !== (b.rule !== null)) return a.rule !== null ? -1 : 1;
  if (a.boosted !== b.boosted) return a.boosted ? -1 : 1;
  if (a.score.klass !== b.score.klass) return a.score.klass - b.score.klass;
  if (a.score.urgency !== b.score.urgency) return b.score.urgency - a.score.urgency;
  if (a.since.getTime() !== b.since.getTime()) return a.since.getTime() - b.since.getTime();
  return compareKey(a, b);
}

/** Needs you now: client-facing first, then the nearest hard date, then the oldest. */
export function emergencyCompare(a: Candidate, b: Candidate): number {
  if (!!a.dayArrived !== !!b.dayArrived) return a.dayArrived ? -1 : 1; // the day he picked, first
  const ac = a.item.client !== null;
  const bc = b.item.client !== null;
  if (ac !== bc) return ac ? -1 : 1;
  const ah = t(a.hardDate);
  const bh = t(b.hardDate);
  if (ah !== bh) return ah - bh;
  if (a.since.getTime() !== b.since.getTime()) return a.since.getTime() - b.since.getTime();
  return compareKey(a, b);
}

/** Next: boosted first, then fresh (just made) or Bast-stopped, then class, then urgency, then oldest. */
export function nextCompare(a: Candidate, b: Candidate): number {
  if (a.boosted !== b.boosted) return a.boosted ? -1 : 1;
  // Just made, or Bast stopped on it: both come ahead of the class bands (Bast's is muted elsewhere, so it must not sink).
  const aFirst = a.fresh || a.botTask;
  const bFirst = b.fresh || b.botTask;
  if (aFirst !== bFirst) return aFirst ? -1 : 1;
  if (a.score.klass !== b.score.klass) return a.score.klass - b.score.klass;
  if (a.score.urgency !== b.score.urgency) return b.score.urgency - a.score.urgency;
  if (a.since.getTime() !== b.since.getTime()) return a.since.getTime() - b.since.getTime();
  return compareKey(a, b);
}

/** People lists: boosted first, then the oldest thread first. */
function peopleCompare(a: Candidate, b: Candidate): number {
  if (a.boosted !== b.boosted) return a.boosted ? -1 : 1;
  if (!!a.clockDue !== !!b.clockDue) return a.clockDue ? -1 : 1;
  if (a.since.getTime() !== b.since.getTime()) return a.since.getTime() - b.since.getTime();
  return compareKey(a, b);
}

// ============================================================================
// Threads
// ============================================================================

/**
 * How a thread stands for the People tiles (plan 1.3):
 * 'show' qualifies now; 'young' is not yet a business day old (not shown, counted in Everything else as new mail);
 * 'older' qualifies except that its newest open ask is over 21 days old (counted in Everything
 * else); 'no' is not a known person, or is automated, noise or a calendar reply.
 */
export function threadStatus(thread: RawThread, now: Date, opts: { notLead?: boolean; woke?: boolean } = {}): 'show' | 'young' | 'older' | 'no' {
  const newest = thread.asks[0];
  if (!newest) return 'no';
  const client = threadClient(thread);
  if (!isPersonMessage({ from_email: newest.from_email, subject: newest.subject, client_name: client?.name ?? null })) {
    return 'no';
  }
  const known =
    thread.asks.some((a) => a.client !== null) ||
    thread.asks.some((a) => !!a.draft_url) ||
    thread.asks.some((a) => a.intent === 'sales');
  if (!known) return 'no';
  if (daysSince(newest.received_at, now) > THREAD_MAX_AGE_DAYS) return 'older';
  const lead = newest.intent === 'sales' && !opts.notLead;
  // A thread whose Not now just ended because they wrote again comes back at once; it does not wait out the first business day.
  if (!lead && !opts.woke && businessDaysElapsed(newest.received_at, now) < THREAD_MIN_AGE_BUSINESS_DAYS) return 'young';
  return 'show';
}

// ============================================================================
// Building candidates
// ============================================================================

interface Refs {
  clients: Map<string, HomeRef>;
  projects: Map<string, HomeRef>;
}

function refOf(r: RawClientRef | RawProjectRef | null | undefined): HomeRef | null {
  return r ? { id: r.id, name: displayText(r.name) || r.name } : null;
}

function collectRefs(raw: RawHomeInputs): Refs {
  const clients = new Map<string, HomeRef>();
  const projects = new Map<string, HomeRef>();
  const addC = (c: RawClientRef | null | undefined) => {
    const r = refOf(c);
    if (r) clients.set(r.id, r);
  };
  const addP = (p: RawProjectRef | null | undefined) => {
    const r = refOf(p);
    if (r) projects.set(r.id, r);
  };
  for (const x of raw.tasks) {
    addC(x.client);
    addP(x.project);
  }
  for (const x of raw.review_folds) {
    addC(x.client);
    addP(x.project);
  }
  for (const x of raw.session_asks) {
    addC(x.client);
    addP(x.project);
  }
  for (const x of raw.waits) {
    addC(x.client);
    addP(x.project);
  }
  for (const th of raw.threads) {
    for (const a of th.asks) {
      addC(a.client);
      addP(a.project);
    }
  }
  for (const a of raw.crises) {
    addC(a.client);
    addP(a.project);
  }
  return { clients, projects };
}

function arcIsOpen(arc: RawArcRef | null | undefined, now: Date): arc is RawArcRef {
  if (!arc) return false;
  if (arc.closed_at) return false;
  return !arc.snoozed_until || arc.snoozed_until.getTime() <= now.getTime();
}

function groupFor(
  client: HomeRef | null,
  project: HomeRef | null,
  arc: RawArcRef | null,
  refs: Refs,
): GroupInfo {
  if (arc) {
    const c = (arc.client_id && refs.clients.get(arc.client_id)) || client;
    const p = (arc.project_id && refs.projects.get(arc.project_id)) || project;
    return { key: arcGroupKey(arc.id), name: displayText(arc.name) || 'Untitled arc', client: c, project: p, arc };
  }
  if (client) return { key: clientGroupKey(client.id), name: client.name, client, project, arc: null };
  if (project) return { key: projectGroupKey(project.id), name: project.name, client: null, project, arc: null };
  return { key: OWN_GROUP_KEY, name: OWN_GROUP_LABEL, client: null, project: null, arc: null };
}

function emptyItem(): Pick<HomeItem, 'actions' | 'more_actions' | 'pinned' | 'reason' | 'default_if_ignored'> {
  return { actions: [], more_actions: [], pinned: false, reason: '', default_if_ignored: '' };
}

function taskMinutes(task: RawTask): number {
  if (task.estimated_minutes && task.estimated_minutes > 0) return task.estimated_minutes;
  return calculateEstimatedMinutes(task.energy_estimate, task.mystery_factor, task.battery_impact) ?? MINUTES.taskDefault;
}

/**
 * Slice 7c: the time, the words after it and the basis line for a task, from the guesses the nightly learn step stored
 * on his home_item_state row. Display only. A person's value always wins: a set estimated_minutes is used as it is
 * (and gets no basis line), and a non-default mystery_factor or battery_impact is never shadowed (no guess for it).
 * With no stored guess this is exactly taskMinutes and no extra words.
 */
function taskEffort(task: RawTask, st: RawItemState | undefined, botTask: boolean): { minutes: number; extras: string[]; basis: string | null } {
  const base = taskMinutes(task);
  if (botTask || !st) return { minutes: base, extras: [], basis: null };
  const personMinutes = !!task.estimated_minutes && task.estimated_minutes > 0;
  const mysteryDefault = task.mystery_factor === 'none';
  const batteryDefault = task.battery_impact === 'average_drain';
  let minutes = base;
  let basis: string | null = null;
  if (!personMinutes && mysteryDefault && batteryDefault) {
    if (st.effort_source === 'history' && st.effort_minutes && st.effort_minutes > 0) {
      minutes = st.effort_minutes;
      basis = timeBasisSentence('history', st.effort_basis_n);
      if (!basis) minutes = base;
    } else if (st.effort_source === 'kind' && !task.energy_estimate) {
      basis = timeBasisSentence('kind', null);
    }
  }
  const extras = effortExtras(mysteryDefault ? st.unknowns : null, batteryDefault ? st.drain : null);
  return { minutes, extras, basis };
}

function nameOfAsk(a: RawEmailAsk): string {
  return displayText(a.from_name) || a.from_email;
}

function stripEndPeriod(s: string): string {
  return s.replace(/[.\s]+$/, '');
}

/** What a build step returns before placement. */
interface Draft {
  cand: Omit<Candidate, 'shown' | 'inView' | 'section' | 'restGroup' | 'parked' | 'parkedBy' | 'pinned' | 'boosted' | 'rule' | 'state' | 'fresh' | 'arrived' | 'botTask'> & {
    fresh?: boolean;
    arrived?: boolean;
    botTask?: boolean;
    rule: EmergencyRule | null;
  };
  /** Slice 6a: a "Not an emergency" rule (or an answered site check) already covers this crisis mail or site row. */
  muted?: boolean;
  /** Extra inputs for actionsFor and the footer lines. */
  ctx: {
    waitInView?: boolean;
    waitNeedsHuman?: boolean;
    pieceCount?: number;
    sessionUrl?: string | null;
    draftUrl?: string | null;
    threadUrl?: string | null;
    waitPriceReview?: boolean;
    waitApprovable?: boolean;
    waitHref?: string | null;
    hasTaskId?: boolean;
    outsideDate?: boolean;
    lead?: boolean;
    thread?: { status: 'show' | 'older' };
    /** Work stage B: the newest ask is a request for a time (disposition meeting): a row that wants a time, never owed, no clock, no draft. */
    meeting?: boolean;
    /** Slice 4a: where Bast's reply work stands, whether it holds a suggested answer, and the "If you do nothing" line. */
    owedState?: OwedState | null;
    owedSuggestion?: boolean;
    owedIfIgnored?: string | null;
    /** Slice 4c: lead clock and short draft facts for the buttons. */
    owedLead?: boolean;
    owedLeadAsk?: boolean;
    owedShort?: boolean;
    owedSend?: { full: boolean; short: boolean };
    owedBook?: boolean;
    /** Slice 6a: a site down row's mail link, site link and "If you do nothing" line. */
    mailUrl?: string | null;
    siteUrl?: string | null;
    siteIfIgnored?: string | null;
    /** Slice 9a: a card from his sent mail: its buttons, "Why Bast asks" line and "If you do nothing" line. */
    proposal?: { ifIgnored: string; why: string; buttons: HomeItemAction[]; noDefault: boolean };
  };
}

function isChatTagged(tags: readonly string[]): boolean {
  return tags.some((x) => x.trim().toLowerCase() === FRESH_NEW.chatTag);
}

/** Slice 2b: Bast's stored short version, only while the hash it was written from still matches the description. */
function bastSummary(task: RawTask, st: RawItemState | undefined): { summary: string; checklist: string[] } | null {
  if (!st || !st.card_summary || st.card_summary.trim() === '' || !st.card_summary_hash) return null;
  if (st.card_summary_hash !== descriptionHash(task.description)) return null;
  return { summary: st.card_summary, checklist: readStoredChecklist(st.card_checklist) };
}

function buildTask(task: RawTask, now: Date, refs: Refs, st: RawItemState | undefined, userId: string): Draft {
  const score = scoreTask(task, now, { at: st?.read_hard_due_at ?? null, source: st?.read_hard_due_source ?? null });
  const client = refOf(task.client);
  const project = refOf(task.project);
  const arc = arcIsOpen(task.arc, now) ? task.arc : null;
  const botTask = task.bot_task;
  let rule = botTask ? null : taskEmergencyRule(
    {
      due_date: task.due_date ? normalizeDueDate(task.due_date) : null,
      promised_to: task.promised_to,
      tags: task.tags,
      site_id: task.site_id,
      client: task.client ? { id: task.client.id, name: task.client.name } : null,
    },
    now,
  );
  // Rule 7 also covers a real outside date filed on the task (never the keeper's "source unclear" reading).
  if (!botTask && !rule && task.hard_due_at && businessDaysUntil(normalizeDueDate(task.hard_due_at), now) <= PROMISED_DATE_EMERGENCY_BUSINESS_DAYS) {
    rule = 'promised_date';
  }
  const promisedNamed = !!task.promised_to && task.promised_to.trim() !== '';
  const outsideDate = rule === 'promised_date' && !promisedNamed;
  const fresh = !botTask && isFreshNew(task, userId, now);
  const arrived =
    !botTask && st?.view_set_by === 'keeper' && !!st.view_at && st.view_at.getTime() <= now.getTime();
  const personWaiting = taskHasPersonWaiting(task);
  const since = score.waitingSince ?? task.created_at;
  const who = botTask ? BOT_WHO : displayText(task.requested_by_name) || client?.name || null;
  const { minutes, extras: effortExtraWords, basis: effortBasis } = taskEffort(task, st, botTask);
  const why = botTask
    ? WHY_BOT_STOPPED
    : rule
    ? whyEmergency(rule, { client: client?.name, outsideDate })
    : fresh
    ? whyFresh(isChatTagged(task.tags))
    : arrived
    ? WHY_ARRIVED
    : whyTask({
        who,
        client: client?.name ?? null,
        personWaiting,
        waited: waitedFor(since, now),
        unblocks: task.open_blocking_count,
        daysOnList: Math.max(0, Math.round((now.getTime() - task.created_at.getTime()) / 86_400_000)),
      });
  const links: { label: string; href: string }[] = [];
  if (task.origin_url) links.push({ label: 'The email it came from', href: task.origin_url });
  // Work stage A: the emails that belong to this task, under Email ("Email: Jeffrey Knisely, Nov 2: Website update").
  for (const e of task.emails ?? []) links.push({ label: emailLinkLabel(e), href: e.deep_link });
  // Work stage D: the other sources attached to this task (sessions, sends, deploys, meetings), each with its date.
  for (const a of task.attached ?? []) links.push({ label: a.label, href: a.href ?? `/tasks/${task.id}` });
  if (task.staging_preview_url) links.push({ label: 'The preview', href: task.staging_preview_url });
  if (project) links.push({ label: `Project: ${project.name}`, href: `/projects/${project.id}` });
  if (client) links.push({ label: `Client: ${client.name}`, href: `/clients/${client.id}` });
  const doneWhen = task.requirements
    .map((r) => ({
      text: displayText(r.text),
      done: r.completed,
      ...(r.id ? { id: r.id } : {}),
      ...(r.answer ? { answer: displayText(r.answer) } : {}),
    }))
    .filter((r) => r.text !== '');
  const bast = bastSummary(task, st);
  const item: HomeItem = {
    ...emptyItem(),
    key: taskKey(task.id),
    type: 'task',
    title: displayText(task.title) || 'Untitled task',
    who,
    age: ageWords(since, now),
    why_now: why,
    hard_date: score.hardDate
      ? hardDateChip(score.hardDate, score.hardKind === 'promised' ? task.promised_to : score.hardSource)
      : null,
    effort: effortWords(minutes, false, effortExtraWords),
    minutes,
    opened: {
      summary: bast ? displayText(bast.summary) : displayText(cardSummary(task.description)),
      summary_by: bast ? 'bast' : null,
      done_when:
        doneWhen.length >= 2
          ? doneWhen
          : bast && task.requirements.length === 0 && bast.checklist.length >= 2
          ? bast.checklist.map((text) => ({ text: displayText(text), done: false })).filter((r) => r.text !== '')
          : [],
      how: task.sop ? { label: displayText(task.sop.title) || 'The SOP', href: `/sops/${task.sop.id}` } : null,
      links,
      task_id: task.id,
      left_off_note: displayText(st?.left_off_note) || null,
      ...(effortBasis ? { effort_basis: effortBasis } : {}),
    },
    source: { kind: 'task', id: task.id, ids: [task.id], task_status: task.status },
    client,
    project,
    ...(task.work_line ? { work_line: displayText(task.work_line) } : {}),
  };
  return {
    cand: {
      key: item.key,
      kind: 'task',
      item,
      rule,
      score,
      since,
      personWaiting,
      hardDate: score.hardDate,
      minutes,
      group: groupFor(client, project, botTask ? null : arc, refs),
      arcId: !botTask && arc ? arc.id : null,
      fresh,
      arrived,
      botTask,
    },
    ctx: { hasTaskId: true, outsideDate },
  };
}

function buildReview(fold: RawReviewFold, now: Date, refs: Refs, st: RawItemState | undefined): Draft {
  const score = scoreReview(fold, now);
  const client = refOf(fold.client);
  const project = refOf(fold.project);
  const n = fold.pieces.length;
  const pieces = n === 1 ? 'finished piece' : 'finished pieces';
  const minutes = Math.min(MINUTES.reviewCap, MINUTES.reviewBase + n * MINUTES.reviewPerPiece);
  const links: { label: string; href: string }[] = [];
  if (project) links.push({ label: `Project: ${project.name}`, href: `/projects/${project.id}` });
  if (client) links.push({ label: `Client: ${client.name}`, href: `/clients/${client.id}` });
  const item: HomeItem = {
    ...emptyItem(),
    key: reviewKey(fold.project?.id ?? null),
    type: 'sign_off',
    title: project ? `Sign off ${n} ${pieces} for ${project.name}` : `Sign off ${n} ${pieces}`,
    who: client?.name ?? null,
    age: ageWords(fold.waiting_since, now),
    why_now: whySignOff({ pieces: n, since: waitedFor(fold.waiting_since, now) }),
    hard_date: null,
    effort: effortWords(minutes),
    minutes,
    opened: {
      summary: `${n} ${pieces}${project ? ` on ${project.name}` : ''} ${n === 1 ? 'is' : 'are'} done and waiting for your approval.`,
      summary_by: null,
      done_when: [],
      how: null,
      links,
      task_id: null,
      left_off_note: displayText(st?.left_off_note) || null,
    },
    source: { kind: 'review', id: fold.project?.id ?? 'none', ids: fold.pieces.map((p) => p.id), task_status: null },
    client,
    project,
  };
  return {
    cand: {
      key: item.key,
      kind: 'review',
      item,
      rule: null,
      score,
      since: fold.waiting_since,
      personWaiting: true,
      hardDate: null,
      minutes,
      group: groupFor(client, project, null, refs),
      arcId: null,
    },
    ctx: { pieceCount: n },
  };
}

function buildSession(s: RawSessionAsk, now: Date, refs: Refs, st: RawItemState | undefined): Draft {
  const score = scoreSession(s, now);
  const client = refOf(s.client);
  const project = refOf(s.project);
  const arc = arcIsOpen(s.arc, now) ? s.arc : null;
  const rule = sessionEmergencyRule(s);
  const ask = truncateWords(displayText(s.waiting_on), 14);
  const label = displayText(s.title);
  const title = label ? `${label}: ${ask}` : ask || 'A session is waiting for you';
  const links: { label: string; href: string }[] = [];
  if (s.remote_url) links.push({ label: 'The session', href: s.remote_url });
  if (project) links.push({ label: `Project: ${project.name}`, href: `/projects/${project.id}` });
  if (client) links.push({ label: `Client: ${client.name}`, href: `/clients/${client.id}` });
  const minutes = MINUTES.sessionAsk;
  const item: HomeItem = {
    ...emptyItem(),
    key: sessionKey(s.external_id),
    type: 'session_ask',
    title,
    who: client?.name ?? null,
    age: ageWords(s.asked_at, now),
    why_now: rule ? whyEmergency(rule, { client: client?.name }) : whySession({ since: waitedFor(s.asked_at, now) }),
    hard_date: null,
    effort: effortWords(minutes),
    minutes,
    opened: {
      summary: displayText(cardSummary(s.waiting_on)),
      summary_by: null,
      done_when: [],
      how: null,
      links,
      task_id: null,
      left_off_note: displayText(st?.left_off_note) || null,
    },
    source: { kind: 'session', id: s.id, ids: [s.id], task_status: null },
    client,
    project,
  };
  return {
    cand: {
      key: item.key,
      kind: 'session',
      item,
      rule,
      score,
      since: s.asked_at,
      personWaiting: true,
      hardDate: null,
      minutes,
      group: groupFor(client, project, arc, refs),
      arcId: arc ? arc.id : null,
    },
    ctx: { sessionUrl: s.remote_url },
  };
}

function buildWait(w: RawWait, now: Date, refs: Refs, st: RawItemState | undefined): Draft {
  const score = scoreWait(w, now);
  const client = refOf(w.client);
  const project = refOf(w.project);
  const rule = waitEmergencyRule({ blocks_client: w.blocks_client, client_waiting_since: w.client_waiting_since }, now);
  const since = waitClockStart(w, now) ?? w.started_at;
  const needsHuman = w.state === WAIT_IN_VIEW_STATE;
  const priceReview = w.template_key === PRICE_REVIEW_WAIT_TEMPLATE;
  const waitHref = priceReview && w.charter_id ? `/charters/${w.charter_id}` : null;
  const links: { label: string; href: string }[] = [];
  if (waitHref) links.push({ label: 'The charter', href: waitHref });
  if (project) links.push({ label: `Project: ${project.name}`, href: `/projects/${project.id}` });
  if (client) links.push({ label: `Client: ${client.name}`, href: `/clients/${client.id}` });
  const minutes = MINUTES.wait;
  const title = displayText(w.title) || 'A wait needs you';
  const item: HomeItem = {
    ...emptyItem(),
    key: waitKey(w.id),
    type: 'wait',
    title,
    who: client?.name ?? null,
    age: ageWords(since, now),
    why_now: rule ? whyEmergency(rule, { client: client?.name }) : whyWait({ needsHuman }),
    hard_date: null,
    effort: effortWords(minutes),
    minutes,
    opened: {
      summary: displayText(cardSummary(w.detail)) || title,
      summary_by: null,
      done_when: [],
      how: null,
      links,
      task_id: w.task_id,
      left_off_note: displayText(st?.left_off_note) || null,
    },
    source: { kind: 'wait', id: w.id, ids: [w.id], task_status: null },
    client,
    project,
  };
  return {
    cand: {
      key: item.key,
      kind: 'wait',
      item,
      rule,
      score,
      since,
      personWaiting: !!w.client || w.blocks_client,
      hardDate: null,
      minutes,
      group: groupFor(client, project, null, refs),
      arcId: null,
    },
    ctx: {
      waitInView: needsHuman || w.due_at.getTime() <= now.getTime(),
      waitNeedsHuman: needsHuman,
      waitPriceReview: priceReview,
      waitApprovable: !!w.approval_request_id,
      waitHref,
      hasTaskId: !!w.task_id,
    },
  };
}

function buildThread(
  th: RawThread,
  status: 'show' | 'older',
  now: Date,
  refs: Refs,
  st: RawItemState | undefined,
  owedRow: OwedRow | undefined,
  drafterFreshAt: Date | null,
  timezone: string,
  sendOn = false,
  bookOn = false,
): Draft {
  const owed = newestIsMeeting(th) ? undefined : owedRow;
  const score = scoreThread(th, now);
  const newest = th.asks[0];
  // Work stage B: a request for a time is a row of its own: no clock, no draft, no Waiting words. It closes when the meeting is booked.
  const meeting = newest.disposition === 'meeting';
  const clientRaw = threadClient(th);
  const projectRaw = threadProject(th);
  const client = refOf(clientRaw);
  const project = refOf(projectRaw);
  const person = nameOfAsk(newest);
  const hisDraftUrl = th.asks.find((a) => !!a.draft_url)?.draft_url ?? null;
  // Slice 4a: Bast's own draft sits in the same Gmail thread, so its link is the thread's link.
  const draftUrl = hisDraftUrl ?? (hasBastDraft(owed) && newest.deep_link ? newest.deep_link : null);
  const owedState = owedStatus(th, owed, now, drafterFreshAt);
  const lead = !meeting && isLeadNow(newest.intent, newest.received_at, owed);
  const clock = owedClock(newest.received_at, lead, owed, now);
  const leadAsk = lead && status === 'show' && !!clock.lead?.ask;
  const woke = !meeting && status === 'show' && wokeByNewMessage(st, newest.received_at, now);
  const cameBack = !meeting && status === 'show' && leadResurfacedPastPark(clock.lead, st, now);
  // His short holding draft is shown only while the full draft it came from still covers the newest message.
  const showShort = !!owed?.short_draft_id && !!owed.short_draft_text && owedState !== 'stale_draft' && owedState !== 'his_draft' && owedState !== 'his_draft_older';
  // Slice 4b: the Send buttons exist only while the owner's switch is on and the draft is Bast's current, untouched one with no blank left in it.
  const sendFull = sendOn && status === 'show' && owedState === 'draft_ready' && owed?.state === 'drafted' && !!owed.draft_id && !!owed.draft_text && !owed.draft_text.includes('[[');
  const sendShort = sendOn && status === 'show' && showShort && (owedState === 'draft_ready' || owedState === 'needs_thought') && !!owed?.short_draft_id && !(owed.short_draft_text ?? '').includes('[[');
  // Slice 4d: Book 30 minutes exists only while his switch is on, on a needs-thought row with no request or block already.
  const bookBtn = bookOn && status === 'show' && owedState === 'needs_thought' && !owed?.book_requested_at && !owed?.booked_event_id && !owed?.book_undo_requested_at;
  const bookedWords = owed?.booked_event_id && owed.booked_start && !owed.book_undo_requested_at ? bookedLine(owed.booked_start, timezone) : null;
  const minutes = draftUrl ? MINUTES.threadWithDraft : MINUTES.threadNoDraft;
  const said = stripEndPeriod(displayText(newest.gist) || displayText(newest.subject)) || 'a message';
  const links: { label: string; href: string }[] = [];
  if (draftUrl) links.push({ label: hisDraftUrl ? 'Your draft in Gmail' : 'The draft in Gmail', href: draftUrl });
  if (newest.deep_link) links.push({ label: 'The email thread', href: newest.deep_link });
  if (project) links.push({ label: `Project: ${project.name}`, href: `/projects/${project.id}` });
  if (client) links.push({ label: `Client: ${client.name}`, href: `/clients/${client.id}` });
  // His edited copy may differ from what Bast wrote, so only a draft he has not touched is shown.
  const showDraftText = owedState === 'draft_ready' || owedState === 'stale_draft';
  const thought = owedState === 'needs_thought' && owed;
  const autoDrafted = owedState === 'draft_ready' && !!owed?.auto_drafted_at;
  const stateLine = owedState === 'his_draft_older' ? NEW_MESSAGE_AFTER_DRAFT : autoDrafted ? AUTO_DRAFT_LINE : owedSecondLine(owedState);
  const dueLine = !meeting && lead && clock.lead && status === 'show' ? leadDueLine(weekdayIn(clock.lead.due, timezone), clock.lead.past) : null;
  const waitLine = !meeting && status === 'show' && clock.waiting ? waitingLine(clock.days) : null;
  // ONE state phrase on the meta line (the age is already on the row), by a fixed order: a booked block, they wrote again, a short draft,
  // Needs thought, the draft state, the lead's due day, then how long they have waited.
  const needsThoughtLine = owedState === 'needs_thought' ? stateLine : null;
  const owedLine = meeting
    ? HANDLED_MAIL.wantsATime
    : [bookedWords, woke || cameBack ? WOKE_LINE : null, showShort ? SHORT_READY_LINE : null, needsThoughtLine, stateLine, dueLine, waitLine].find((x) => !!x) ?? null;
  // Work stage B: the title reads "sender, client: subject" (the subject, not the gist), cut at 90 characters.
  const head = client && !sameName(client.name, person) ? `${person}, ${client.name}` : person;
  const fullTitle = `${head}: ${stripSubjectPrefix(displayText(newest.subject)) || said}`;
  const threadTitle = fullTitle.length > THREAD_TITLE_MAX ? `${fullTitle.slice(0, THREAD_TITLE_MAX - 1).trimEnd()}\u2026` : fullTitle;
  const item: HomeItem = {
    ...emptyItem(),
    key: threadKey(th.account, th.thread_id),
    type: lead ? 'lead' : 'owed_reply',
    title: threadTitle,
    who: client && !sameName(client.name, person) ? `${person}, ${client.name}` : person,
    age: ageWords(newest.received_at, now, 'arrived'),
    why_now: meeting ? HANDLED_MAIL.meetingWhy : leadAsk ? LEAD_ASK : whyThread({ lead, since: waitedFor(newest.received_at, now), draftReady: !!draftUrl }),
    hard_date: null,
    effort: effortWords(minutes, !!draftUrl),
    minutes,
    opened: {
      summary: newest.gist
        ? displayText(cardSummary(newest.gist))
        : `${person} wrote about "${displayText(newest.subject)}".`,
      summary_by: null,
      done_when: [],
      how: null,
      links,
      task_id: null,
      left_off_note: displayText(st?.left_off_note) || null,
      draft_text: showDraftText && hasBastDraft(owed) && owed?.draft_text ? owed.draft_text : null,
      bast_read: thought && owed.bast_read ? displayText(owed.bast_read) : null,
      suggested_answer: thought && owed.suggested_answer ? displayText(owed.suggested_answer) : null,
      short_draft_text: showShort && owed?.short_draft_text ? owed.short_draft_text : null,
    },
    source: { kind: 'thread', id: newest.id, ids: th.asks.map((a) => a.id), task_status: null },
    client,
    project,
    owed_state: owedState,
    owed_line: owedLine,
    ...(bookedWords ? { owed_booked: bookedWords } : {}),
    ...(sendFull || sendShort ? { owed_send: { draft_id: sendFull ? owed!.draft_id : null, short_draft_id: sendShort ? owed!.short_draft_id! : null } } : {}),
  };
  return {
    cand: {
      key: item.key,
      kind: 'thread',
      item,
      rule: null,
      score,
      since: newest.received_at,
      personWaiting: true,
      hardDate: null,
      minutes,
      group: groupFor(client, project, null, refs),
      arcId: null,
      clockDue: !meeting && status === 'show' && (lead ? !!clock.lead?.past : clock.waiting),
      unpark: woke || cameBack,
    },
    ctx: {
      draftUrl,
      threadUrl: newest.deep_link || null,
      lead,
      thread: { status },
      meeting: meeting || undefined,
      owedState,
      owedSuggestion: !!(thought && owed.suggested_answer),
      // Older threads (Everything else) keep the old line; the drafter does not work them.
      owedLead: lead,
      owedLeadAsk: leadAsk,
      owedShort: showShort,
      owedSend: sendFull || sendShort ? { full: sendFull, short: sendShort } : undefined,
      owedBook: bookBtn || undefined,
      owedIfIgnored:
        status !== 'show' || meeting
          ? null
          : leadAsk
            ? IF_IGNORED_4C.lead_ask
            : ifIgnoredLine(owedState, drafterFreshAt, now, {
                leadPast: !!clock.lead?.past && !!owed?.drafted_at && owed.drafted_at.getTime() < clock.lead.due.getTime(),
                shortReady: showShort,
                autoPending: !!owed && !owed.needs_commitment && !!owed.suggested_answer && !owed.auto_drafted_at,
              }),
    },
  };
}

const THREAD_TITLE_MAX = 90;

function newestIsMeeting(th: RawThread): boolean {
  return th.asks[0]?.disposition === 'meeting';
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function buildCrisis(a: RawEmailAsk, rule: EmergencyRule, now: Date, refs: Refs, st: RawItemState | undefined, muted = false): Draft {
  const score = scoreCrisis(a, now);
  const client = refOf(a.client);
  const project = refOf(a.project);
  const person = nameOfAsk(a);
  const minutes = a.draft_url ? MINUTES.threadWithDraft : MINUTES.threadNoDraft;
  const links: { label: string; href: string }[] = [];
  if (a.deep_link) links.push({ label: 'The email thread', href: a.deep_link });
  if (project) links.push({ label: `Project: ${project.name}`, href: `/projects/${project.id}` });
  if (client) links.push({ label: `Client: ${client.name}`, href: `/clients/${client.id}` });
  const item: HomeItem = {
    ...emptyItem(),
    key: crisisKey(a.id),
    type: 'emergency',
    title: displayText(a.subject) || 'Urgent email',
    who: client && !sameName(client.name, person) ? `${person}, ${client.name}` : person,
    age: ageWords(a.received_at, now, 'arrived'),
    why_now: whyEmergency(rule, { client: client?.name, sender: person }),
    hard_date: null,
    effort: effortWords(minutes, !!a.draft_url),
    minutes,
    opened: {
      summary: a.gist ? displayText(cardSummary(a.gist)) : `An urgent email from ${person}: "${displayText(a.subject)}".`,
      summary_by: null,
      done_when: [],
      how: null,
      links,
      task_id: null,
      left_off_note: displayText(st?.left_off_note) || null,
    },
    source: { kind: 'crisis', id: a.id, ids: [a.id], task_status: null },
    client,
    project,
    not_emergency_scopes: ruleScopesFor({ kind: 'crisis', from_email: a.from_email }).map((s) => ({ scope: s.scope, label: s.label })),
  };
  return {
    muted,
    cand: {
      key: item.key,
      kind: 'crisis',
      item,
      rule,
      score,
      since: a.received_at,
      personWaiting: true,
      hardDate: null,
      minutes,
      group: groupFor(client, project, null, refs),
      arcId: null,
    },
    ctx: { draftUrl: a.draft_url, threadUrl: a.deep_link || null },
  };
}

/** Slice 6a: a client site that is down (a watchdog incident 10 minutes old, or an uptime mail Bast's own check confirmed). */
function buildSite(it: SiteDownItem, inc: RawSiteIncident, now: Date, refs: Refs, st: RawItemState | undefined, muted: boolean): Draft {
  const client = inc.client_id ? (refs.clients.get(inc.client_id) ?? (inc.client_name ? { id: inc.client_id, name: displayText(inc.client_name) } : null)) : null;
  const score = scoreSite({ client: inc.client_id ? { status: 'active' } : null, started_at: inc.started_at }, now);
  const minutes = 5;
  const links: { label: string; href: string }[] = [...inc.mail_links.map((l) => ({ label: displayText(l.label) || 'The email thread', href: l.href }))];
  links.push({ label: 'The site', href: `https://${it.domain}/` });
  if (client) links.push({ label: `Client: ${client.name}`, href: `/clients/${client.id}` });
  const item: HomeItem = {
    ...emptyItem(),
    key: it.key,
    type: 'emergency',
    title: it.title,
    who: null,
    age: minutesWord(it.down_minutes),
    why_now: it.detail,
    hard_date: null,
    effort: effortWords(minutes, false),
    minutes,
    opened: {
      summary: siteSummary(it.source, it.domain),
      summary_by: null,
      done_when: [],
      how: null,
      links,
      task_id: null,
      left_off_note: displayText(st?.left_off_note) || null,
    },
    source: { kind: 'site', id: it.site_id, ids: [it.site_id], task_status: null },
    client,
    project: null,
    not_emergency_scopes: ruleScopesFor({ kind: 'site', host: it.domain }).map((s) => ({ scope: s.scope, label: s.label })),
  };
  return {
    muted,
    cand: {
      key: item.key,
      kind: 'site',
      item,
      rule: 'site_down',
      score,
      since: inc.started_at,
      personWaiting: false,
      hardDate: null,
      minutes,
      group: groupFor(client, null, null, refs),
      arcId: null,
    },
    ctx: { mailUrl: inc.mail_links[0]?.href ?? null, siteUrl: `https://${it.domain}/`, siteIfIgnored: it.default_if_ignored },
  };
}

/** Slice 6a: the Monday hands row (its jobs are filled in once the tasks are final). */
function buildHandsRow(count: number, minutes: number, title: string, taskIds: string[], now: Date): Draft {
  const item: HomeItem = {
    ...emptyItem(),
    key: HANDS_ITEM_KEY,
    type: 'hands',
    title,
    who: null,
    age: 'this week',
    why_now: HANDS_WHY_NOW,
    hard_date: null,
    effort: effortWords(minutes, false),
    minutes,
    opened: { summary: HANDS_SUMMARY, summary_by: null, done_when: [], how: null, links: [], task_id: null, left_off_note: null },
    source: { kind: 'hands', id: 'week', ids: taskIds, task_status: null },
    client: null,
    project: null,
    hands: { count, minutes, groups: [] },
  };
  return {
    cand: {
      key: item.key,
      kind: 'hands',
      item,
      rule: null,
      score: scoreHands(now),
      since: now,
      personWaiting: false,
      hardDate: null,
      minutes,
      group: { key: OWN_GROUP_KEY, name: OWN_GROUP_LABEL, client: null, project: null, arc: null },
      arcId: null,
    },
    ctx: {},
  };
}

/** Slice 8b: one project's next step as a row. The text is Bast's (or his own); a leading "Mike, " is dropped. */
function buildStep(step: RawProjectStep, now: Date, timeZone: string, still: boolean): Draft {
  const score = scoreStep({ client: step.client, project_name: step.project_name, last_activity_at: step.last_activity_at }, now);
  const client: HomeRef = { id: step.client.id, name: displayText(step.client.name) || step.client.name };
  const project: HomeRef = { id: step.project_id, name: displayText(step.project_name) || step.project_name };
  const minutes = MINUTES.taskDefault;
  const title = stepTitle(step.text);
  const links: { label: string; href: string }[] = [
    { label: `Project: ${project.name}`, href: `/projects/${project.id}` },
    { label: `Client: ${client.name}`, href: `/clients/${client.id}` },
  ];
  const wrote = nextStepSource({ source: step.source, at: step.step_at ? step.step_at.toISOString() : null }, now, timeZone);
  const item: HomeItem = {
    ...emptyItem(),
    key: stepKey(step.project_id),
    type: 'step',
    title,
    who: null,
    age: waitedFor(step.last_activity_at, now),
    why_now: stepWhyNow(project.name, step.last_activity_at, now, timeZone, still),
    hard_date: null,
    effort: effortWords(minutes),
    minutes,
    opened: {
      summary: wrote ? `${title} ${wrote}` : title,
      summary_by: null,
      done_when: [],
      how: null,
      links,
      task_id: null,
      left_off_note: null,
    },
    source: { kind: 'step', id: step.project_id, ids: [step.project_id], task_status: null },
    client,
    project,
  };
  return {
    cand: {
      key: item.key,
      kind: 'step',
      item,
      rule: null,
      score,
      since: step.last_activity_at,
      personWaiting: true,
      hardDate: null,
      minutes,
      group: groupFor(client, project, null, { clients: new Map([[client.id, client]]), projects: new Map([[project.id, project]]) }),
      arcId: null,
    },
    ctx: {},
  };
}

// ============================================================================
// Footer lines and buttons (need the final placement)
// ============================================================================

function ifIgnored(c: Candidate): string {
  if (c.botTask) return IF_IGNORED.botStopped;
  if (c.kind === 'step') return STEP_IF_IGNORED;
  if (c.kind === 'hands') return HANDS_IF_IGNORED;
  if (c.kind === 'finished') return c.key.startsWith('finished:s-') ? SESSION_FINISHED.ifIgnored : FINISHED_CARD.ifIgnored;
  if (c.kind === 'attach') return ATTACH_CARD.ifIgnored;
  if (c.rule) return c.kind === 'crisis' ? IF_IGNORED.crisis : IF_IGNORED.emergency;
  switch (c.kind) {
    case 'thread':
      return IF_IGNORED.thread;
    case 'review':
      return IF_IGNORED.signOff;
    case 'session':
      return IF_IGNORED.session;
    case 'wait':
      return IF_IGNORED.wait;
    default:
      return IF_IGNORED.stays;
  }
}

function reasonFor(c: Candidate, ctx: FinalizeCtx): string {
  if (c.pinned) return REASON.working;
  if (c.dayArrived) return ON_DAY_REASON;
  if (c.botTask && !c.boosted) return REASON.botStopped;
  if (c.kind === 'hands') return HANDS_REASON;
  if (c.kind === 'finished') return c.key.startsWith('finished:s-') ? SESSION_FINISHED.reason : FINISHED_CARD.reason;
  if (c.kind === 'attach') return ATTACH_CARD.reason;
  if (c.kind === 'step') return stepReason(c.item.project?.name ?? '');
  if (c.kind === 'proposal') return ctx.proposal?.why ?? '';
  if (c.rule) return reasonEmergency(c.rule, !!ctx.outsideDate);
  if (c.boosted) return REASON.boosted;
  switch (c.section) {
    case 'leads':
      return REASON.lead;
    case 'mail':
      return REASON.mail;
    case 'next':
      if (c.fresh) return REASON.fresh;
      if (c.arrived) return REASON.arrived;
      if (c.kind === 'review') return REASON.signOff;
      if (c.kind === 'session') return REASON.session;
      if (c.kind === 'wait') return REASON.wait;
      if (c.score.klass === 1) return REASON.class1;
      if (c.score.klass === 2) return REASON.class2;
      return REASON.class3;
    default:
      return REASON.rest;
  }
}

function itemType(c: Candidate): HomeItemType {
  if (c.rule) return 'emergency';
  return c.item.type === 'emergency' ? 'owed_reply' : c.item.type;
}

type FinalizeCtx = Draft['ctx'];

function finalize(c: Candidate, ctx: FinalizeCtx, filledFirst: boolean): void {
  const out = actionsFor({
    kind: c.kind,
    emergency: c.rule !== null,
    pinned: c.pinned,
    parkCount: c.state?.park_count ?? 0,
    filledFirst,
    pieceCount: ctx.pieceCount,
    sessionUrl: ctx.sessionUrl,
    draftUrl: ctx.draftUrl,
    threadUrl: ctx.threadUrl,
    waitPriceReview: ctx.waitPriceReview,
    waitApprovable: ctx.waitApprovable,
    waitHref: ctx.waitHref,
    hasTaskId: ctx.hasTaskId,
    botTask: c.botTask,
    owedThread:
      c.kind === 'thread' && ctx.thread?.status === 'show'
        ? { state: ctx.owedState ?? null, suggestion: !!ctx.owedSuggestion, lead: ctx.owedLead, leadAsk: ctx.owedLeadAsk, short: ctx.owedShort, send: ctx.owedSend, book: ctx.owedBook, meeting: ctx.meeting }
        : undefined,
    mailUrl: ctx.mailUrl,
    siteUrl: ctx.siteUrl,
    dayChoices: c.dayChoices,
    snoozeChoices: c.snoozeChoices,
    proposal: ctx.proposal ? { buttons: ctx.proposal.buttons, noDefault: ctx.proposal.noDefault } : undefined,
  });
  const finalItem: HomeItem = {
    ...c.item,
    type: itemType(c),
    pinned: c.pinned,
    why_now: c.dayArrived ? ON_DAY_WHY_NOW : c.snoozeBack ? SNOOZE_BACK_WHY : c.item.why_now,
    reason: c.learned && c.shown ? `${reasonFor(c, ctx)} ${learnedFooter(c.learned.key, c.learned.label, c.learned.dir)}` : reasonFor(c, ctx),
    default_if_ignored:
      c.kind === 'proposal' && ctx.proposal
        ? ctx.proposal.ifIgnored
        : c.kind === 'thread' && !c.rule && ctx.owedIfIgnored
        ? ctx.owedIfIgnored
        : c.kind === 'site' && c.rule && ctx.siteIfIgnored
          ? ctx.siteIfIgnored
          : ifIgnored(c),
    actions: out.actions,
    more_actions: out.more_actions,
  };
  // Slice 6a: only an emergency offers a rule; a task emergency says why it never can. The keys are left off otherwise.
  if (!c.rule || !finalItem.not_emergency_scopes || finalItem.not_emergency_scopes.length === 0) delete finalItem.not_emergency_scopes;
  if (c.rule && c.kind === 'task') finalItem.not_emergency_refusal = SECURITY_NEVER_RULE;
  c.item = finalItem;
}

// ============================================================================
// selectHome
// ============================================================================

/**
 * Whether an item qualifies for Next (before the cap): boosted, fresh (just made) or arrived
 * (its day from the nightly sort has come), or the class and urgency bands. Sessions, review
 * folds and waits always qualify (a wait's in-view check is the caller's).
 */
export function meetsNextRule(c: Pick<Candidate, 'boosted' | 'fresh' | 'arrived' | 'kind' | 'score'> & { botTask?: boolean }): boolean {
  if (c.boosted || c.fresh || c.arrived || c.botTask) return true;
  if (c.kind === 'session' || c.kind === 'review') return true;
  if (c.kind === 'wait') return true; // in view is checked by the caller
  const { klass, urgency } = c.score;
  if (klass === 1 && urgency >= NEXT_ENTRY.class1MinUrgency) return true;
  if ((klass === 2 || klass === 3) && urgency >= NEXT_ENTRY.class2or3MinUrgency) return true;
  return false;
}

const BRING_FORWARD_KINDS: readonly HomeSourceKind[] = ['task', 'session', 'wait', 'thread', 'step', 'proposal', 'finished', 'attach'];

/** One Everything else row for an item (check text per the plan's table). */
function restItemOf(c: Candidate, group: HomeRestGroupKey, ctx: FinalizeCtx, now: Date, timeZone: string): HomeRestItem {
  const vw = c.state?.view_at ?? null;
  let text: string;
  if (group === 'parked' && c.state?.snoozed_until && c.state.snoozed_until.getTime() > now.getTime() && c.parkedBy === 'user') {
    text = snoozeCheckText(c.state.snoozed_until, now, timeZone);
  } else if (group === 'parked' && c.state?.on_day && c.parkedBy === 'user') {
    text = onDayCheckText(c.state.on_day);
  } else if ((group === 'scheduled' || group === 'parked') && vw) {
    text = backOnText(vw);
  } else if (group === 'older_threads') {
    text = REST_CHECK.olderThread;
  } else if (group === 'bast_stopped') {
    text = REST_CHECK.botStopped;
  } else if (group === 'ventures') {
    text = REST_CHECK.venture;
  } else if (group === 'hands') {
    text = REST_CHECK.handsRow;
  } else if (group === 'from_sent_mail') {
    text = ctx.proposal?.why.includes('older mail') ? REST_CHECK.sentMailOlder : REST_CHECK.sentMailCard;
  } else if (group === 'project_steps') {
    text = c.boosted ? REST_CHECK.joinsNext : meetsNextRule(c) ? REST_CHECK.stepOneAtATime : REST_CHECK.stepHeld;
  } else if (c.kind === 'site') {
    text = SITE_RULED_CHECK;
  } else if (c.kind === 'crisis') {
    text = REST_CHECK.crisisCleared;
  } else if (c.kind === 'thread') {
    text = REST_CHECK.peopleOverflow;
  } else if (c.kind === 'wait' && !ctx.waitInView && !c.boosted) {
    text = REST_CHECK.waitNotDue;
  } else if (meetsNextRule(c)) {
    text = REST_CHECK.joinsNext;
  } else {
    text = REST_CHECK.getsDay;
  }
  return {
    key: c.key,
    title: c.item.title,
    owner: c.botTask ? BOT_WHO : group === 'ventures' ? REST_GROUP_COPY.ventures.owner : 'You',
    check_text: text,
    check_at: vw ? vw.toISOString() : null,
    past_check: !!vw && vw.getTime() <= now.getTime(),
    can_bring_forward: BRING_FORWARD_KINDS.includes(c.kind),
  };
}

/** Keeper lines that are reports or checks, not changes: they carry no Undo. */
const NO_UNDO_LINES: readonly string[] = ['keeper_owed_drafts', 'watch_site_cleared', 'watch_site_down', 'watch_site_scan', 'keeper_measures', 'keeper_guard'];

export function selectHome(input: SelectInput): SelectResult {
  const { raw, now } = input;
  const states = new Map(input.states.map((s) => [s.item_key, s]));
  const refs = collectRefs(raw);
  const owedByKey = new Map(raw.owed_rows.map((r) => [r.thread_key, r]));

  // ---- 1. Drafts ---------------------------------------------------------
  const drafts: Draft[] = [];
  // Slice 6c: the outside scan's result line goes on the row and card of the item it ran for.
  const outsideByKey = new Map((raw.outside_checks ?? []).map((o) => [o.item_key, outsideCheckLine(o.summary, o.at, raw.timezone)]));
  const push = (d: Draft) => {
    const line = outsideByKey.get(d.cand.key);
    if (line) d.cand.item.outside_check = line;
    drafts.push(d);
  };

  for (const task of raw.tasks) push(buildTask(task, now, refs, states.get(taskKey(task.id)), raw.user_id));
  for (const fold of raw.review_folds) push(buildReview(fold, now, refs, states.get(reviewKey(fold.project?.id ?? null))));
  // Work stage D: a source the guard found already carried by open work is never a row of its own (the loader left it out; this keeps
  // every path honest, the joined owed rows included).
  const keptOff = new Set(raw.handled_elsewhere ?? []);
  for (const s of raw.session_asks) {
    if (keptOff.has(sessionKey(s.external_id))) continue;
    push(buildSession(s, now, refs, states.get(sessionKey(s.external_id))));
  }
  for (const w of raw.waits) {
    if (!(OPEN_WAIT_STATES as readonly string[]).includes(w.state)) continue;
    push(buildWait(w, now, refs, states.get(waitKey(w.id))));
  }
  let youngThreads = 0;
  // Slice 4c: threads joined across inboxes are one conversation, and one that someone on our side already answered leaves.
  const joinedThreads = mergeJoinedThreads(raw.threads, raw.owed_rows);
  // Slice 4b: a thread whose reply is waiting out the hold, or already went, leaves People. A send that did not go brings it back.
  const sendingKeys = new Set((raw.owed_sends ?? []).filter((x) => x.status !== 'failed').map((x) => x.item_key));
  const sendOn = raw.owed_send === true;
  const bookOn = raw.book_blocks === true;
  for (const th of joinedThreads.threads) {
    const key = threadKey(th.account, th.thread_id);
    if (keptOff.has(key)) continue; // Work stage D: carried by open work
    const owedRow = owedByKey.get(key);
    const newestAsk = th.asks[0];
    const status = threadStatus(th, now, {
      notLead: newestAsk.intent === 'sales' && !isLeadNow(newestAsk.intent, newestAsk.received_at, owedRow),
      woke: wokeByNewMessage(states.get(key), newestAsk.received_at, now),
    });
    if (status === 'young') youngThreads += 1;
    if (status === 'show' || status === 'older') {
      if (repliedElsewhere(key, joinedThreads.members.get(key) ?? [], owedByKey as ReadonlyMap<string, JoinRow>, newestAsk.received_at)) continue;
      if (sendingKeys.has(key)) continue;
      push(buildThread(th, status, now, refs, states.get(key), owedRow, raw.drafter_fresh_at, raw.timezone, sendOn, bookOn));
    }
  }
  // Slice 6a: site down rows, and the mails an uptime check already covers.
  const incidentRows: IncidentRow[] = raw.site_incidents.map((i) => ({
    site_id: i.site_id,
    domain: i.domain,
    client_id: i.client_id,
    client_name: i.client_name,
    source: i.source,
    ask_ids: i.ask_ids,
    started_at: i.started_at,
    last_checked_at: i.last_checked_at,
    last_check_up: i.last_check_up,
    closed_at: i.closed_at,
  }));
  const incidentBySite = new Map<string, RawSiteIncident>();
  for (const i of raw.site_incidents) {
    const cur = incidentBySite.get(i.site_id);
    if (!i.closed_at && (!cur || i.started_at < cur.started_at)) incidentBySite.set(i.site_id, i);
  }
  const skipAsks = new Set<string>(); // merged into a visible site down row
  const muteAsks = new Set<string>(); // answered by a check, or covered by a rule on the site
  for (const i of raw.site_incidents) {
    if (i.source === 'uptime_mail' && i.closed_at && i.close_reason === 'answered') for (const id of i.ask_ids) muteAsks.add(id);
  }
  for (const it of siteDownItems(incidentRows, now)) {
    const inc = incidentBySite.get(it.site_id);
    if (!inc) continue;
    const ruled = matchesNotEmergencyRule({ kind: 'site', host: siteHostOf(`https://${it.domain}`) }, raw.not_emergency_rules);
    if (it.source === 'uptime_mail') for (const id of it.ask_ids) (ruled ? muteAsks : skipAsks).add(id);
    push(buildSite(it, inc, now, refs, states.get(siteKey(it.site_id)), ruled));
  }
  for (const a of raw.crises) {
    const rule = crisisEmergencyRule({ is_urgent: a.is_urgent, state: a.state, from_email: a.from_email, client: a.client });
    if (!rule) continue; // noise, or not urgent and open
    if (skipAsks.has(a.id)) continue; // its site down row carries the mail link
    const muted = muteAsks.has(a.id) || matchesNotEmergencyRule({ kind: 'crisis', from_email: a.from_email }, raw.not_emergency_rules);
    push(buildCrisis(a, rule, now, refs, states.get(crisisKey(a.id)), muted));
  }

  // ---- 2. State facts: boost, not-an-emergency, parked, pinned ----------
  const candidates: Candidate[] = [];
  const ctxByKey = new Map<string, FinalizeCtx>();

  // Slice 7b: learned weights. Absent or all at 100 changes nothing. Applied once per candidate, before placement, so the
  // class, Next bands, rank and Today's arc all read the weighted urgency. Never on an emergency, crisis, site, hands row or bot task.
  const weightMap = new Map<string, WeightRow>();
  for (const w of raw.weights ?? []) if (w.weight_pct !== 100 && isLearnableKey(w.evidence_key)) weightMap.set(w.evidence_key, w);
  const tasksByKey = new Map(raw.tasks.map((x) => [taskKey(x.id), x]));
  const senderByThread = new Map(joinedThreads.threads.map((th) => [threadKey(th.account, th.thread_id), th.asks[0].from_email]));
  const learn = (c: Candidate, lead: boolean): void => {
    if (weightMap.size === 0) return;
    const rt = c.kind === 'task' ? tasksByKey.get(c.key) : undefined;
    const keys = evidenceKeys({
      kind: c.kind,
      client_id: c.item.client?.id ?? null,
      project_id: c.item.project?.id ?? null,
      sop_id: rt?.sop?.id ?? null,
      sender: c.kind === 'thread' ? (senderByThread.get(c.key) ?? null) : null,
    });
    const res = applyWeights(
      c.score,
      {
        kind: c.kind,
        rule: c.rule !== null,
        botTask: c.botTask,
        lead,
        tags: rt?.tags ?? [],
        hardDate: c.hardDate !== null || c.score.hardDate !== null,
        keys,
        cap: c.kind === 'step' ? STEP_URGENCY_CAP : undefined,
      },
      weightMap,
    );
    if (!res) return;
    c.score = res.score;
    c.learned = { key: res.key, label: res.label, dir: res.dir };
  };
  for (const draft of drafts) {
    const st = states.get(draft.cand.key);
    // "Do it on a day": an emergency he set for a later day leaves Needs you now (and so Quick) until that day, then returns. A thread
    // that a new message woke early is not held (the existing 4c wake rule).
    const dayParked = (isDayParked(st, now) || isSnoozeParked(st, now)) && !draft.cand.unpark;
    const dayArrived = isDayArrived(st, now, raw.timezone);
    const emergencyRule = draft.cand.rule && !st?.not_emergency_at && !draft.muted && !dayParked ? draft.cand.rule : null;
    const c: Candidate = {
      ...draft.cand,
      rule: emergencyRule,
      dayArrived,
      snoozeBack: isSnoozeBack(st, now, raw.timezone),
      dayHeldRule: dayParked && draft.cand.rule && !st?.not_emergency_at && !draft.muted ? draft.cand.rule : null,
      boosted: !!st?.boosted_at || dayArrived,
      fresh: draft.cand.fresh ?? false,
      arrived: draft.cand.arrived ?? false,
      botTask: draft.cand.botTask ?? false,
      clockDue: draft.cand.clockDue ?? false,
      unpark: draft.cand.unpark ?? false,
      parkedBy: null,
      parked: false,
      pinned: false,
      shown: false,
      inView: false,
      section: 'rest',
      restGroup: 'waiting_turn',
      state: st,
    };
    learn(c, draft.ctx.lead === true);
    candidates.push(c);
    ctxByKey.set(c.key, draft.ctx);
  }

  // Slice 6a: Mike's open tasks tagged hands or credential-rotation, with no hard date, never sit in Next one by one.
  const taskRawByKey = new Map(raw.tasks.map((x) => [taskKey(x.id), x]));
  const handsTaskCands = candidates.filter((c) => {
    if (c.kind !== 'task' || c.botTask || c.rule !== null || c.boosted) return false;
    const rt = taskRawByKey.get(c.key);
    return !!rt && isHandsTask({ tags: rt.tags, status: rt.status, has_hard_date: c.hardDate !== null });
  });
  const handsTaskKeys = new Set(handsTaskCands.map((c) => c.key));

  // The pinned item: the newest working_since; only one at a time.
  let pinnedCand: Candidate | null = null;
  for (const c of candidates) {
    const ws = c.state?.working_since;
    if (!ws) continue;
    if (!pinnedCand || ws.getTime() > (pinnedCand.state?.working_since?.getTime() ?? 0)) pinnedCand = c;
  }
  if (pinnedCand) pinnedCand.pinned = true;

  for (const c of candidates) {
    const vw = c.state?.view_at;
    c.parked = !c.pinned && c.rule === null && !c.unpark && !!vw && vw.getTime() > now.getTime();
    c.parkedBy = c.parked ? (c.state?.view_set_by === 'keeper' ? 'keeper' : 'user') : null;
  }

  // ---- 3. Placement ------------------------------------------------------
  const needs: Candidate[] = [];
  const leads: Candidate[] = [];
  const mailAll: Candidate[] = [];
  const nextAll: Candidate[] = [];
  const working: Candidate[] = [];

  // Slice 3: of Bast's stopped tasks that are not boosted, the oldest holds a Next slot (one at a time); the rest wait in
  // their own drawer group. A boosted one (This matters more, Bring it forward) takes a Next slot like any boosted item,
  // beside the holder.
  const botHolder =
    candidates
      .filter((c) => c.botTask && !c.parked && !c.pinned && !c.boosted)
      .sort((a, b) => a.since.getTime() - b.since.getTime() || compareKey(a, b))[0] ?? null;

  for (const c of candidates) {
    const ctx = ctxByKey.get(c.key) ?? {};
    if (c.pinned) {
      c.section = 'working_on';
      c.restGroup = null;
      working.push(c);
    } else if (c.rule) {
      c.section = 'needs_you_now';
      c.restGroup = null;
      needs.push(c);
    } else if (c.parked) {
      c.restGroup = c.parkedBy === 'keeper' ? 'scheduled' : 'parked';
    } else if (handsTaskKeys.has(c.key)) {
      c.restGroup = HANDS_REST_GROUP; // Slice 6a: the Monday row holds these; the keeper never gives them a day
    } else if (c.kind === 'crisis' || c.kind === 'site') {
      c.restGroup = 'waiting_turn'; // marked "Not an emergency" (or ruled so): counted, not listed
    } else if (c.botTask && !c.boosted && c !== botHolder) {
      c.restGroup = 'bast_stopped';
    } else if (c.kind === 'thread' && ctx.thread?.status === 'older' && !c.boosted) {
      c.restGroup = 'older_threads';
    } else if (c.score.venture && !c.boosted && !c.fresh && !c.botTask) {
      c.restGroup = 'ventures';
    } else if (c.kind === 'thread' && ctx.meeting && !c.boosted) {
      // Work stage B: a request for a time is a row in Decisions ready ("Wants a time"), never counted as a client email waiting.
      c.section = 'next';
      c.restGroup = null;
      nextAll.push(c);
    } else if (c.kind === 'thread') {
      c.section = ctx.lead ? 'leads' : 'mail';
      c.restGroup = null;
      (ctx.lead ? leads : mailAll).push(c);
    } else if (c.kind === 'wait' && !ctx.waitInView && !c.boosted) {
      c.restGroup = 'waiting_turn';
    } else if (meetsNextRule(c)) {
      c.section = 'next';
      c.restGroup = null;
      nextAll.push(c);
    } else {
      c.restGroup = 'waiting_turn';
    }
  }

  // Slice 8b: a project's next step is a row only while the project has nothing else of his in view (one row per project). Steps
  // are placed after everyone else, so they never take a slot a real item qualified for and never change another item's place.
  const projectsInView = new Set<string>();
  for (const c of [...needs, ...working, ...leads, ...mailAll, ...nextAll]) if (c.item.project) projectsInView.add(c.item.project.id);
  const stepStill = new Set<string>();
  const unboostedSteps: Candidate[] = [];
  const stepRows = raw.project_steps.filter((s) => {
    const v = stepVisibility(s, states.get(stepKey(s.project_id)), now);
    if (v === 'still') stepStill.add(s.project_id);
    return v !== 'hidden';
  });
  for (const s of dedupeSteps(stepRows, projectsInView)) {
    const d = buildStep(s, now, raw.timezone, stepStill.has(s.project_id));
    const st = states.get(d.cand.key);
    const c: Candidate = {
      ...d.cand,
      rule: null,
      dayArrived: isDayArrived(st, now, raw.timezone),
      snoozeBack: isSnoozeBack(st, now, raw.timezone),
      boosted: !!st?.boosted_at || isDayArrived(st, now, raw.timezone),
      fresh: false,
      arrived: false,
      botTask: false,
      clockDue: false,
      unpark: false,
      parkedBy: null,
      parked: false,
      pinned: false,
      shown: false,
      inView: false,
      section: 'rest',
      restGroup: 'project_steps',
      state: st,
    };
    learn(c, false);
    const vw = st?.view_at;
    c.parked = !!vw && vw.getTime() > now.getTime();
    c.parkedBy = c.parked ? (st?.view_set_by === 'keeper' ? 'keeper' : 'user') : null;
    candidates.push(c);
    ctxByKey.set(c.key, d.ctx);
    if (c.parked) {
      c.restGroup = c.parkedBy === 'keeper' ? 'scheduled' : 'parked';
    } else if (c.score.venture && !c.boosted) {
      c.restGroup = 'ventures';
    } else if (c.boosted) {
      // Brought forward or "This matters more": a boosted step takes a Next slot in the boosted tier, as any boosted item does.
      c.section = 'next';
      c.restGroup = null;
      nextAll.push(c);
    } else if (meetsNextRule(c)) {
      unboostedSteps.push(c);
    }
  }
  // Like the bot-task rule: at most ONE unboosted step holds a Next slot at a time (the best by the normal rank among those that
  // qualify). The others wait in the Project next steps group. When the holder is done or parked, the next one takes the slot.
  unboostedSteps.sort(nextCompare);
  unboostedSteps.forEach((c, i) => {
    if (i === 0) {
      c.section = 'next';
      c.restGroup = null;
      nextAll.push(c);
    }
  });


  // Slice 9a: a card from his sent mail is a row of its own. One sits in Decisions ready at a time (security first, then Track it, then the
  // newest); the rest, and every look-back card, wait in the drawer group "From your sent mail". A card he brought forward takes a Next slot.
  // Cards are never part of Today and never score money, a date or a person waiting.
  const eligibleCards: (ProposalDraft & { id: string; at: Date; cand: Candidate })[] = [];
  for (const card of raw.reconcile_cards ?? []) {
    const d = buildProposalDraft(card, now, raw.timezone);
    const st = states.get(d.item.key);
    const c: Candidate = {
      key: d.item.key,
      kind: 'proposal',
      item: d.item,
      rule: null,
      score: scoreStep({ client: { status: 'active', name: null }, project_name: null, last_activity_at: card.created_at }, now),
      since: card.created_at,
      personWaiting: false,
      hardDate: null,
      minutes: d.item.minutes,
      group: { key: OWN_GROUP_KEY, name: OWN_GROUP_LABEL, client: null, project: null, arc: null },
      arcId: null,
      dayArrived: isDayArrived(st, now, raw.timezone),
      snoozeBack: isSnoozeBack(st, now, raw.timezone),
      boosted: !!st?.boosted_at || isDayArrived(st, now, raw.timezone),
      fresh: false,
      arrived: false,
      botTask: false,
      clockDue: false,
      unpark: false,
      parkedBy: null,
      parked: false,
      pinned: false,
      shown: false,
      inView: false,
      section: 'rest',
      restGroup: 'from_sent_mail',
      state: st,
    };
    const vw = st?.view_at;
    c.parked = !!vw && vw.getTime() > now.getTime();
    c.parkedBy = c.parked ? (st?.view_set_by === 'keeper' ? 'keeper' : 'user') : null;
    candidates.push(c);
    ctxByKey.set(c.key, { proposal: { ifIgnored: d.ifIgnored, why: d.why, buttons: d.buttons, noDefault: d.no_default } });
    if (c.parked) {
      c.restGroup = c.parkedBy === 'keeper' ? 'scheduled' : 'parked';
    } else if (c.boosted) {
      c.section = 'next';
      c.restGroup = null;
      nextAll.push(c);
    } else if (!d.look_back) {
      eligibleCards.push({ ...d, id: card.id, at: card.created_at, cand: c });
    }
  }
  eligibleCards.sort(proposalOrder);
  if (eligibleCards.length > 0) {
    const top = eligibleCards[0].cand;
    top.section = 'next';
    top.restGroup = null;
    nextAll.push(top);
  }

  // Work stage G: the one looks-finished card is a row of its own: one slot in Decisions ready, never part of Today, never scoring
  // money, a date or a person waiting. Not now parks it like any row. Closing waits for his tap.
  // Work stage E: each session's own looks-done card is the same kind of row, one per session, titled with its proof.
  const finishedCards: { key: string; fin: RawFinishedCard; title: string; whyNow: string }[] = [];
  if (raw.finished && raw.finished.rows.length > 0) finishedCards.push({ key: FINISHED_CARD_KEY, fin: raw.finished, title: FINISHED_CARD.title(raw.finished.rows.length), whyNow: FINISHED_CARD.whyNow });
  for (const sc of raw.session_finished ?? []) {
    if (sc.rows.length > 0) finishedCards.push({ key: sc.key, fin: sc, title: sessionCardTitle(sc.summary), whyNow: SESSION_FINISHED.whyNow });
  }
  for (const fc of finishedCards) {
    const fin = fc.fin;
    const key = fc.key;
    const st = states.get(key);
    const others = fin.others.filter((o) => o.count > 0).map((o) => FINISHED_CARD.others(o.count, o.name));
    const minutes = 2;
    const item: HomeItem = {
      ...emptyItem(),
      key,
      type: 'finished',
      title: fc.title,
      who: null,
      age: waitedFor(fin.since, now),
      why_now: fc.whyNow,
      hard_date: null,
      effort: effortWords(minutes),
      minutes,
      opened: { summary: '', summary_by: null, done_when: [], how: null, links: [], task_id: null, left_off_note: null },
      source: { kind: 'finished', id: key === FINISHED_CARD_KEY ? 'all' : key.slice('finished:'.length), ids: fin.rows.map((r) => r.task_id), task_status: null },
      client: null,
      project: null,
      finished: { count: fin.rows.length, rows: fin.rows, others },
    };
    const c: Candidate = {
      key,
      kind: 'finished',
      item,
      rule: null,
      score: scoreStep({ client: { status: 'active', name: null }, project_name: null, last_activity_at: fin.since }, now),
      since: fin.since,
      personWaiting: false,
      hardDate: null,
      minutes,
      group: { key: OWN_GROUP_KEY, name: OWN_GROUP_LABEL, client: null, project: null, arc: null },
      arcId: null,
      dayArrived: isDayArrived(st, now, raw.timezone),
      snoozeBack: isSnoozeBack(st, now, raw.timezone),
      boosted: !!st?.boosted_at || isDayArrived(st, now, raw.timezone),
      fresh: false,
      arrived: false,
      botTask: false,
      clockDue: false,
      unpark: false,
      parkedBy: null,
      parked: false,
      pinned: false,
      shown: false,
      inView: false,
      section: 'next',
      restGroup: null,
      state: st,
    };
    const vw = st?.view_at;
    c.parked = !!vw && vw.getTime() > now.getTime();
    c.parkedBy = c.parked ? (st?.view_set_by === 'keeper' ? 'keeper' : 'user') : null;
    candidates.push(c);
    ctxByKey.set(key, {});
    if (c.parked) {
      c.section = 'rest';
      c.restGroup = c.parkedBy === 'keeper' ? 'scheduled' : 'parked';
    } else {
      nextAll.push(c);
    }
  }

  // Work stage D: the one question about which work a source belongs to. One row per source, in Decisions ready; never part of Today and
  // never scoring money, a date or a person waiting. Not now parks it like any row. Nothing is attached until he answers.
  for (const q of raw.attach_questions ?? []) {
    const key = buildItemKey({ kind: 'attach', id: q.link_id });
    const st = states.get(key);
    const minutes = 1;
    const item: HomeItem = {
      ...emptyItem(),
      key,
      type: 'attach',
      title: q.title,
      who: q.who,
      age: waitedFor(q.since, now),
      why_now: ATTACH_CARD.whyNow,
      hard_date: null,
      effort: effortWords(minutes),
      minutes,
      opened: { summary: '', summary_by: null, done_when: [], how: null, links: q.candidates.map((c) => ({ label: c.label, href: c.href })), task_id: null, left_off_note: null },
      source: { kind: 'attach', id: q.link_id, ids: [], task_status: null },
      client: null,
      project: null,
      attach: {
        key,
        source_kind: q.kind,
        source_href: q.source_href,
        candidates: q.candidates.map((c) => ({ choice: c.target_key, label: c.label, href: c.href })),
        can_new_project: q.can_new_project,
        can_task: q.can_task,
      },
    };
    const c: Candidate = {
      key,
      kind: 'attach',
      item,
      rule: null,
      score: scoreStep({ client: { status: 'active', name: null }, project_name: null, last_activity_at: q.since }, now),
      since: q.since,
      personWaiting: false,
      hardDate: null,
      minutes,
      group: { key: OWN_GROUP_KEY, name: OWN_GROUP_LABEL, client: null, project: null, arc: null },
      arcId: null,
      dayArrived: isDayArrived(st, now, raw.timezone),
      snoozeBack: isSnoozeBack(st, now, raw.timezone),
      boosted: !!st?.boosted_at || isDayArrived(st, now, raw.timezone),
      fresh: false,
      arrived: false,
      botTask: false,
      clockDue: false,
      unpark: false,
      parkedBy: null,
      parked: false,
      pinned: false,
      shown: false,
      inView: false,
      section: 'next',
      restGroup: null,
      state: st,
    };
    const vw = st?.view_at;
    c.parked = !!vw && vw.getTime() > now.getTime();
    c.parkedBy = c.parked ? (st?.view_set_by === 'keeper' ? 'keeper' : 'user') : null;
    candidates.push(c);
    ctxByKey.set(key, {});
    if (c.parked) {
      c.section = 'rest';
      c.restGroup = c.parkedBy === 'keeper' ? 'scheduled' : 'parked';
    } else {
      nextAll.push(c);
    }
  }

  for (const c of [...needs, ...working, ...leads, ...mailAll, ...nextAll]) c.inView = true;

  needs.sort(emergencyCompare);
  leads.sort(peopleCompare);
  mailAll.sort(peopleCompare);
  nextAll.sort(nextCompare);

  const mail = mailAll.slice(0, CAPS.mail);
  for (const c of mailAll.slice(CAPS.mail)) {
    c.section = 'rest';
    c.restGroup = 'waiting_turn';
  }
  // Slice 6a: the Monday hands row takes the first Next slot (Monday 00:05 to Friday 23:59, until parked or done).
  const handsJobCands = handsTaskCands.filter((c) => !c.pinned && !c.parked);
  const handsJobs: HandsTask[] = handsJobCands.map((c) => {
    const rt = taskRawByKey.get(c.key) as RawTask;
    return {
      id: rt.id,
      title: c.item.title,
      tags: rt.tags,
      status: rt.status,
      has_hard_date: false,
      estimated_minutes: rt.estimated_minutes,
      sop: rt.sop,
    };
  });
  const handsSel = handsRow(handsJobs, now, raw.timezone, states.get(HANDS_ITEM_KEY)?.view_at ?? null);
  let handsCand: Candidate | null = null;
  if (handsSel) {
    const d = buildHandsRow(handsSel.count, handsSel.minutes, handsSel.title, handsJobs.map((j) => j.id), now);
    handsCand = {
      ...d.cand,
      rule: null,
      boosted: false,
      fresh: false,
      arrived: false,
      botTask: false,
      parkedBy: null,
      parked: false,
      pinned: false,
      shown: false,
      inView: false,
      section: 'next',
      restGroup: null,
      state: states.get(HANDS_ITEM_KEY),
    };
    candidates.push(handsCand);
    ctxByKey.set(handsCand.key, d.ctx);
  }
  const nextSlots = CAPS.next - (handsCand ? 1 : 0);
  const next = nextAll.slice(0, nextSlots);
  for (const c of nextAll.slice(nextSlots)) {
    c.section = 'rest';
    c.restGroup = c.kind === 'step' ? 'project_steps' : c.kind === 'proposal' ? 'from_sent_mail' : 'waiting_turn';
  }
  if (handsCand) next.unshift(handsCand);
  for (const c of [...needs, ...working, ...leads, ...mail, ...next]) c.shown = true;
  if (handsCand) handsCand.inView = true;

  // ---- 4. Final items (buttons, footer lines) ---------------------------
  const topNextKey = next[0]?.key ?? null;
  const dayPicks = dayChoices(now, raw.timezone);
  const snoozePicks = snoozeChoices(now, raw.timezone);
  for (const c of candidates) {
    c.dayChoices = dayPicks;
    c.snoozeChoices = snoozePicks;
  }
  for (const c of candidates) finalize(c, ctxByKey.get(c.key) ?? {}, c.key === topNextKey);
  if (handsCand && handsSel) {
    const byTask = new Map(handsJobCands.map((c) => [(taskRawByKey.get(c.key) as RawTask).id, c]));
    handsCand.item = {
      ...handsCand.item,
      hands: {
        count: handsSel.count,
        minutes: handsSel.minutes,
        groups: handsSel.groups.map((g) => ({
          sop_id: g.sop_id,
          label: displayText(g.label) || g.label,
          jobs: g.jobs.map((j) => ({ title: j.title, minutes: j.minutes, item: (byTask.get(j.task_id) as Candidate).item })),
        })),
      },
    };
  }

  // ---- 5. Everything else -----------------------------------------------
  const counts: Record<HomeRestGroupKey, number> = {
    waiting_turn: 0,
    scheduled: 0,
    parked: 0,
    held_projects: raw.held_project_task_count,
    review_pieces: raw.review_folds.reduce((n, f) => n + f.pieces.length, 0),
    new_mail: youngThreads,
    older_threads: 0,
    ventures: 0,
    bast_stopped: 0,
    hands: 0,
    project_steps: 0,
    from_sent_mail: 0,
  };
  for (const c of candidates) if (c.section === 'rest' && c.restGroup) counts[c.restGroup] += 1;

  const itemsByGroup: Record<HomeRestGroupKey, HomeRestItem[]> = {
    waiting_turn: [],
    scheduled: [],
    parked: [],
    held_projects: [],
    review_pieces: [],
    new_mail: [],
    older_threads: [],
    ventures: [],
    bast_stopped: [],
    hands: [],
    project_steps: [],
    from_sent_mail: [],
  };
  const restCands = candidates.filter((c) => c.section === 'rest' && c.restGroup !== null);
  const byDay = (a: Candidate, b: Candidate) =>
    t(a.state?.view_at ?? null) - t(b.state?.view_at ?? null) || compareKey(a, b);
  restCands.sort((a, b) => (a.restGroup === 'scheduled' || a.restGroup === 'parked' ? byDay(a, b) : rankCompare(a, b)));
  for (const c of restCands) {
    const group = c.restGroup as HomeRestGroupKey;
    itemsByGroup[group].push(restItemOf(c, group, ctxByKey.get(c.key) ?? {}, now, raw.timezone));
  }
  for (const hp of raw.held_projects) {
    const name = displayText(hp.project.name) || 'Untitled project';
    itemsByGroup.held_projects.push({
      key: null,
      title: name,
      owner: `The ${name} project`,
      check_text: whenProjectStarts(name),
      check_at: null,
      past_check: false,
      can_bring_forward: false,
    });
  }
  for (const fold of raw.review_folds) {
    const project = displayText(fold.project?.name) || null;
    const n = fold.pieces.length;
    itemsByGroup.review_pieces.push({
      key: null,
      title: `${n} finished ${n === 1 ? 'piece' : 'pieces'}${project ? ` for ${project}` : ''}`,
      owner: project ? `The ${project} sign-off` : 'The sign-off',
      check_text: withSignOff(project),
      check_at: null,
      past_check: false,
      can_bring_forward: false,
    });
  }
  if (youngThreads > 0) {
    itemsByGroup.new_mail.push({
      key: null,
      title: youngThreads === 1 ? '1 new message' : `${youngThreads} new messages`,
      owner: 'You',
      check_text: REST_CHECK.newMail,
      check_at: null,
      past_check: false,
      can_bring_forward: false,
    });
  }

  const order: HomeRestGroupKey[] = [
    'waiting_turn',
    'scheduled',
    'parked',
    'held_projects',
    'review_pieces',
    'new_mail',
    'older_threads',
    'ventures',
    'bast_stopped',
    'project_steps',
    'hands',
    'from_sent_mail',
  ];
  const groups: HomeEverythingElseGroup[] = order
    .filter((k) => counts[k] > 0)
    .map((k) => ({
      key: k,
      label: REST_GROUP_COPY[k].label,
      count: counts[k],
      owner: REST_GROUP_COPY[k].owner,
      items: itemsByGroup[k],
    }));
  const total = groups.reduce((n, g) => n + g.count, 0);
  const allRows = groups.flatMap((g) => g.items);
  const withDay = allRows.filter((i) => i.check_at !== null).length;
  const pastDay = allRows.filter((i) => i.past_check).length;

  // ---- 6. Handled for you -----------------------------------------------
  const closed: HomeQuietLine[] = raw.auto_handled.map((h) => ({
    id: h.id,
    text: handledLine({ who: displayText(h.from_name) || h.from_email, subject: h.subject }),
    href: h.deep_link || null,
    at: h.handled_at.toISOString(),
    undo_action_id: null,
    details: [],
  }));
  // Work stage B: mail recorded as handled at birth: a quiet line with Undo (the home act reopen_ask), the last day.
  const recorded: HomeQuietLine[] = (raw.intake_handled ?? []).map((h) => ({
    id: h.id,
    text: recordedLine({ from_name: h.from_name, from_email: h.from_email, subject: h.subject, kind: h.kind }),
    href: h.deep_link || null,
    at: h.handled_at.toISOString(),
    undo_action_id: null,
    reopen_item_key: askRef(h.id),
    details: [],
  }));
  const kept: HomeQuietLine[] = raw.keeper_lines.map((k) => ({
    id: k.id,
    text: displayText(k.text),
    href: k.href ?? null,
    at: k.at.toISOString(),
    undo_action_id: NO_UNDO_LINES.includes(k.action) ? null : k.id,
    details: k.details.map((x) => displayText(x)).filter((x) => x !== ''),
  }));
  // Slice 4b: Handled for you shows each press on Send the draft: sending (Undo until the hold ends), sent, or not sent.
  const sends: HomeQuietLine[] = (raw.owed_sends ?? []).map((x) => ({
    id: x.action_id,
    text:
      x.status === 'sent'
        ? sentLine(displayText(x.who))
        : x.status === 'failed'
          ? notSentLine(sendFailureReason(x.reason))
          : sendingLine(displayText(x.who), x.send_after, raw.timezone),
    href: null,
    at: x.pressed_at.toISOString(),
    undo_action_id: x.status === 'pending' && x.send_after.getTime() > now.getTime() ? x.action_id : null,
    details: [],
  }));
  // Slice 4d: Handled for you shows each tap on Book 30 minutes while its request or block still stands (Undo for 24 hours).
  const booksByKey = new Map(owedByKey as ReadonlyMap<string, OwedRow>);
  const books: HomeQuietLine[] = (raw.owed_books ?? []).flatMap((x) => {
    const row = booksByKey.get(x.item_key);
    if (!row || row.book_undo_requested_at || !(row.book_requested_at || row.booked_event_id)) return [];
    return [
      {
        id: x.action_id,
        text: bookLine(displayText(x.who), row.booked_start ?? x.start, raw.timezone),
        href: null,
        at: x.pressed_at.toISOString(),
        undo_action_id: x.undo_until && x.undo_until.getTime() > now.getTime() ? x.action_id : null,
        details: [],
      },
    ];
  });
  // Slice 9a: Handled for you shows each note written from his sent mail (Undo and "This was wrong" for 72 hours), and a task marked done
  // from a card with no time on it ("Log time? 30 min").
  const sentMail: HomeQuietLine[] = (raw.reconcile_lines ?? []).map((x) => {
    const open = !!x.undo_until && x.undo_until.getTime() > now.getTime();
    return {
      id: x.id,
      text: displayText(x.text),
      href: x.link,
      at: x.at.toISOString(),
      undo_action_id: open ? x.id : null,
      details: x.details.map((d) => displayText(d)).filter((d) => d !== ''),
      wrong_action_id: x.note && open ? x.id : null,
      time_prompt: x.time_prompt,
    };
  });
  const handledAll = [...closed, ...recorded, ...kept, ...sends, ...books, ...sentMail].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.id < b.id ? -1 : 1));
  const handled = handledAll.slice(0, CAPS.handled);
  const moreCount = Math.max(0, handledAll.length - CAPS.handled);

  const itemOf = (c: Candidate): HomeItem => c.item;
  // Only the top Next row's first button is filled: finalize() already did that for that one row.
  const sections: HomeSections = {
    needs_you_now: needs.map(itemOf),
    working_on: working.map(itemOf),
    leads: leads.map(itemOf),
    mail: mail.map(itemOf),
    next: next.map(itemOf),
    handled,
    handled_more: moreCount > 0 ? { count: moreCount, text: handledMoreText(moreCount) } : null,
  };

  const handledMail: HomeHandledMail[] = (raw.handled_mail ?? []).map((h) => {
    const who = displayText(h.from_name) || h.from_email;
    const head = h.client_name && h.client_name.trim().toLowerCase() !== who.trim().toLowerCase() ? `${who}, ${displayText(h.client_name)}` : who;
    return {
      id: h.id,
      key: askRef(h.id),
      title: `${head}: ${stripSubjectPrefix(displayText(h.subject)) || 'No subject'}`,
      reason: handledReason(h.kind, h.reason),
      href: h.deep_link || null,
      at: h.handled_at.toISOString(),
      kind: h.kind,
    };
  });

  return {
    handled_mail: handledMail,
    sections,
    everything_else: {
      count: total,
      line: everythingElseLine(total, withDay, pastDay),
      groups,
      with_day: withDay,
      past_day: pastDay,
      scope_line: scopeLine(raw.held_project_task_count),
    },
    candidates,
    byKey: new Map(candidates.map((c) => [c.key, c])),
  };
}
