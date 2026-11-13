/**
 * What Release does to a Triage card, decided in ONE place (Triage tab plan, decision 3).
 *
 * `planRelease` takes a card's kind, assignee and project and returns the effects Release will apply (as data) AND the sentence
 * that describes them. The sentence is built from the effects by describeRelease, and `release()` in triage.ts applies exactly those effects, so the
 * "On release" line can never promise something the action does not do. Pure: no database, no React.
 *
 *   project_setup                                     project queue -> ready, card -> not_started, assigned to Bast, tags kickoff + from-triage
 *   (every card that ends assigned to Bast also gets needs-pm-release while the worker hold is on: see pmReleaseHold)
 *   task | project_addition | reusable_tool | rule_proposal   card -> not_started, assigned to Bast when nobody is, tag from-triage
 *   question_only                                     card closed as done; its questions and answers stay on it
 *   null (not sorted yet)                             nothing: release is refused
 */

export const TRIAGE_KINDS = ['project_setup', 'task', 'project_addition', 'reusable_tool', 'rule_proposal', 'question_only'] as const;
export type TriageKindName = (typeof TRIAGE_KINDS)[number];

export const FROM_TRIAGE_TAG = 'from-triage';
export const KICKOFF_TAG = 'kickoff';
/** A tag the worker gate already parks on (gate.json blocking_tags). */
export const PM_RELEASE_TAG = 'needs-pm-release';

/**
 * THE one switch for keeping the merge inert for the unattended worker. While it is on, every card Release assigns to Bast also gets
 * `needs-pm-release`, which the worker gate parks on, so no session starts from a release until the office manager picks the card up.
 * The worker-side slice turns this off in this one place (or with TRIAGE_PM_RELEASE_HOLD=off in the server environment).
 */
export const PM_RELEASE_HOLD_DEFAULT = true;
export function pmReleaseHold(): boolean {
  const v = (process.env.TRIAGE_PM_RELEASE_HOLD ?? '').trim().toLowerCase();
  if (v === 'off' || v === 'false' || v === '0') return false;
  if (v === 'on' || v === 'true' || v === '1') return true;
  return PM_RELEASE_HOLD_DEFAULT;
}

export type ReleaseBlock = 'unsorted' | 'no_project' | 'still_quote' | 'project_closed';

export interface ReleaseInput {
  kind: TriageKindName | null;
  assignee_id: string | null;
  assignee_name: string | null;
  project: { id: string; name: string; status: string } | null;
  bast_id: string;
  /** The client site the card carries (null = none: internal work). Undefined is read as none. */
  site?: { id: string; name: string } | null;
  /** Open questions that follow go_with_recommendation (they go ahead) and the rest (they wait for him). Default 0. */
  open_go?: number;
  open_wait?: number;
  /** Add PM_RELEASE_TAG to a card that ends assigned to Bast. Callers pass pmReleaseHold(). Default false (pure). */
  pm_hold?: boolean;
  /**
   * Items in the card's Work to note section that count: not dropped, not marked wrong, no task made for them yet. Only the sentence about Dox reads it, and
   * only when the card is actually held for Dox. Part of release_version through triage_rev. Default 0.
   */
  noted_items?: number;
}

export interface ReleaseEffects {
  to_status: 'not_started' | 'done';
  /** Set the assignee to Bast. For a setup card this is always; for the other kinds only when nobody is assigned. */
  assign_bast: boolean;
  /** Tags Release makes sure are on the card. */
  add_tags: string[];
  /** The card's project goes queue -> ready. */
  project_to_ready: boolean;
  // ---- what matters to the owner, as data; the sentence is built from these and nothing else ----
  kind: TriageKindName;
  /** Who the card ends with: 'Bast' or a person's name. Null when the card is closed. */
  lands_on: string | null;
  lands_on_bast: boolean;
  /** The project the card belongs to (setup, or an addition). Null otherwise. */
  project_name: string | null;
  /** project_setup only: the project is made ready and set up by the office manager (Dox), who creates and assigns every task. */
  starts_project: boolean;
  /** The card waits until Dox picks it up (the worker hold, on a card that ends with Bast). */
  held_for_dox: boolean;
  /** The card is closed as done, its questions and answers kept. */
  closes_card: boolean;
  /** rule_proposal: releasing is the owner approving the wording on the card (no other change). */
  approves_wording: boolean;
  /** The client site the work is on. Null = none, and the sentence says nothing. */
  site_name: string | null;
  /** Open questions: go ahead with the recommendation, wait for him (card flagged), or stay as they are (closed card). */
  questions: { go: number; wait: number; stay: number };
}

export interface ReleasePlan {
  /** False when Release would be refused. The line then says why. */
  ready: boolean;
  block: ReleaseBlock | null;
  /** The plain sentence for the card ("On release: ..."), built from `effects` by describeRelease. */
  line: string;
  /** The technical detail (status, tags, project status) for the card page's Details disclosure. Never shown on the tab card. */
  details: string[];
  /** Null when blocked. */
  effects: ReleaseEffects | null;
}

/** Why a blocked release is refused: HTTP status, code and sentence (the quote sentence is the one the old Release plan used). */
export const RELEASE_REFUSALS: Record<ReleaseBlock, { status: number; code: string; message: string }> = {
  unsorted: { status: 409, code: 'not_sorted', message: 'Not sorted yet. Nothing was released.' },
  no_project: { status: 409, code: 'no_project', message: 'This card needs its project linked first. Nothing was released.' },
  still_quote: { status: 409, code: 'still_a_quote', message: 'That project is still a quote. Nothing was released.' },
  project_closed: { status: 409, code: 'project_closed', message: 'That project is closed. Nothing was released.' },
};

export const NOT_SORTED_LINE = 'Not sorted yet';

const words = (status: string) => status.replace(/_/g, ' ');

export const PM_NAME = 'Dox';

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** The sentence for the owner. Every phrase comes from one field of `effects`, so a test can check each one both ways. */
export function describeRelease(fx: ReleaseEffects): string {
  const parts: string[] = [];
  if (fx.closes_card) {
    parts.push('Closes this card. The questions and your answers stay on it.');
    if (fx.questions.stay > 0) parts.push(`${fx.questions.stay} open ${plural(fx.questions.stay, 'question stays', 'questions stay')} unanswered.`);
    return parts.join(' ');
  }
  if (fx.kind === 'project_setup') {
    parts.push(
      fx.starts_project
        ? `Starts the project: ${PM_NAME} sets up ${fx.project_name}, creating and assigning every task.`
        : `Hands the setup of ${fx.project_name} to ${PM_NAME}, who creates and assigns every task.`,
    );
  } else {
    const to = fx.lands_on_bast ? 'Bast' : (fx.lands_on ?? 'its assignee');
    const tail = fx.held_for_dox || !fx.lands_on_bast ? '.' : ' to do.';
    if (fx.project_name) parts.push(`Adds this to ${fx.project_name} and hands it to ${to}${tail}`);
    else parts.push(`Hands this to ${to}${tail}`);
  }
  if (fx.held_for_dox) parts.push(`Nothing begins until ${PM_NAME} picks it up.`);
  if (fx.approves_wording) parts.push('Releasing approves the wording on this card.');
  if (fx.site_name) parts.push(`The work is on ${fx.site_name}.`);
  if (fx.questions.go > 0) parts.push(`${fx.questions.go} open ${plural(fx.questions.go, 'question goes', 'questions go')} ahead with the recommendation.`);
  if (fx.questions.wait > 0) parts.push(`${fx.questions.wait} open ${plural(fx.questions.wait, 'question waits', 'questions wait')} for you; the card stays flagged for you until you answer.`);
  return parts.join(' ');
}

/**
 * The sentence about what Dox does with the plan. Only when the card is actually held for Dox (it ends with Bast and the worker hold is on): a card that
 * lands on a person, or a release with the hold off, says nothing about Dox. The plan is not a task list: Dox builds the routine tasks from the shape and the
 * sitemap, and sets up the few things noted in the plan.
 */
export function doxBuildsSentence(fx: ReleaseEffects, noted: number): string {
  if (!fx.held_for_dox || fx.closes_card) return '';
  const things = `${noted} ${plural(noted, 'thing', 'things')}`;
  if (fx.kind === 'project_setup') return ` ${PM_NAME} builds the tasks from the shape and the sitemap${noted > 0 ? `, including the ${things} noted in the plan` : ''}.`;
  return noted > 0 ? ` ${PM_NAME} sets up the ${things} noted in the plan.` : '';
}

/** The technical lines for the Details disclosure on the card page. */
function detailsOf(fx: ReleaseEffects, project: { name: string; status: string } | null): string[] {
  const out = [`Status: ${fx.to_status === 'done' ? 'Done' : 'Not started'}`];
  if (fx.assign_bast) out.push('Assigned to Bast');
  else if (fx.lands_on) out.push(`Stays with ${fx.lands_on}`);
  if (fx.add_tags.length > 0) out.push(`Tags added: ${fx.add_tags.join(', ')}`);
  if (fx.project_to_ready && project) out.push(`${project.name} goes from queue to ready`);
  return out;
}

export function planRelease(input: ReleaseInput): ReleasePlan {
  const { kind, project } = input;
  const go = input.open_go ?? 0;
  const wait = input.open_wait ?? 0;
  const blocked = (block: ReleaseBlock, line: string): ReleasePlan => ({ ready: false, block, line, details: [], effects: null });
  if (kind === null) return blocked('unsorted', NOT_SORTED_LINE);
  const hold = input.pm_hold === true;
  const noted = input.noted_items ?? 0;
  const finish = (effects: ReleaseEffects): ReleasePlan => ({
    ready: true,
    block: null,
    line: describeRelease(effects) + doxBuildsSentence(effects, noted),
    details: detailsOf(effects, project),
    effects,
  });
  const common = { kind, approves_wording: false, starts_project: false, project_name: null, site_name: input.site?.name ?? null };

  if (kind === 'question_only') {
    return finish({
      ...common,
      to_status: 'done',
      assign_bast: false,
      add_tags: [],
      project_to_ready: false,
      lands_on: null,
      lands_on_bast: false,
      held_for_dox: false,
      closes_card: true,
      site_name: null,
      questions: { go: 0, wait: 0, stay: go + wait },
    });
  }

  if (kind === 'project_setup') {
    if (!project) return blocked('no_project', 'Needs its project linked before it can be released.');
    if (project.status === 'quote') return blocked('still_quote', `${project.name} is still a quote, so release is refused.`);
    if (['cancelled', 'done', 'suspended'].includes(project.status)) return blocked('project_closed', `${project.name} is ${words(project.status)}, so release is refused.`);
    const toReady = project.status === 'queue';
    return finish({
      ...common,
      to_status: 'not_started',
      assign_bast: true,
      add_tags: [KICKOFF_TAG, FROM_TRIAGE_TAG, ...(hold ? [PM_RELEASE_TAG] : [])],
      project_to_ready: toReady,
      lands_on: 'Bast',
      lands_on_bast: true,
      project_name: project.name,
      starts_project: toReady,
      held_for_dox: hold,
      closes_card: false,
      questions: { go, wait, stay: 0 },
    });
  }

  // task, project_addition, reusable_tool, rule_proposal: the old rule holds, a task on a quote project is never released.
  if (project?.status === 'quote') return blocked('still_quote', `${project.name} is still a quote, so release is refused.`);
  const assignBast = input.assignee_id === null;
  const endsBast = assignBast || input.assignee_id === input.bast_id;
  const heldForDox = hold && endsBast;
  return finish({
    ...common,
    to_status: 'not_started',
    assign_bast: assignBast,
    add_tags: [FROM_TRIAGE_TAG, ...(heldForDox ? [PM_RELEASE_TAG] : [])],
    project_to_ready: false,
    lands_on: endsBast ? 'Bast' : (input.assignee_name ?? 'its assignee'),
    lands_on_bast: endsBast,
    project_name: kind === 'project_addition' && project ? project.name : null,
    held_for_dox: heldForDox,
    closes_card: false,
    approves_wording: kind === 'rule_proposal',
    questions: { go, wait, stay: 0 },
  });
}
