/**
 * What Release does to a Triage card, decided in ONE place (Triage tab plan, decision 3).
 *
 * `planRelease` takes a card's kind, assignee and project and returns the effects Release will apply AND the sentence that
 * describes them. The sentence is built from the effects, and `release()` in triage.ts applies exactly those effects, so the
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
}

export interface ReleaseEffects {
  to_status: 'not_started' | 'done';
  /** Set the assignee to Bast. For a setup card this is always; for the other kinds only when nobody is assigned. */
  assign_bast: boolean;
  /** Tags Release makes sure are on the card. */
  add_tags: string[];
  /** The card's project goes queue -> ready. */
  project_to_ready: boolean;
}

export interface ReleasePlan {
  /** False when Release would be refused. The line then says why. */
  ready: boolean;
  block: ReleaseBlock | null;
  /** The plain sentence for the card ("On release: ..."). */
  line: string;
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

function listOf(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** The sentence part about open questions, '' when there are none. */
function questionsClause(go: number, wait: number): string {
  const parts: string[] = [];
  if (go > 0) parts.push(`${go} open ${plural(go, 'question goes', 'questions go')} ahead with the recommendation.`);
  if (wait > 0) parts.push(`${wait} will wait for you, and the card is flagged for you until ${plural(wait, 'it is', 'they are')} answered.`);
  return parts.length > 0 ? ` ${parts.join(' ')}` : '';
}

export const WAITS_FOR_PM_SENTENCE = 'It waits for the office manager to pick it up.';

export function planRelease(input: ReleaseInput): ReleasePlan {
  const { kind, project } = input;
  const go = input.open_go ?? 0;
  const wait = input.open_wait ?? 0;
  const blocked = (block: ReleaseBlock, line: string): ReleasePlan => ({ ready: false, block, line, effects: null });
  if (kind === null) return blocked('unsorted', NOT_SORTED_LINE);

  if (kind === 'question_only') {
    const open = go + wait;
    return {
      ready: true,
      block: null,
      line: `Closes the card as done. The questions and answers stay on it${open > 0 ? `, and ${open === 1 ? 'its 1 open question stays' : `its ${open} open questions stay`} unanswered` : ''}.`,
      effects: { to_status: 'done', assign_bast: false, add_tags: [], project_to_ready: false },
    };
  }

  const siteClause = input.site ? ` The work will be on ${input.site.name}.` : ' No site: internal work.';
  const hold = input.pm_hold === true;

  if (kind === 'project_setup') {
    if (!project) return blocked('no_project', 'Needs its project linked before it can be released.');
    if (project.status === 'quote') return blocked('still_quote', `${project.name} is still a quote, so release is refused.`);
    if (['cancelled', 'done', 'suspended'].includes(project.status)) return blocked('project_closed', `${project.name} is ${words(project.status)}, so release is refused.`);
    const toReady = project.status === 'queue';
    const lead = toReady ? `Makes ${project.name} ready and hands the setup to Bast` : `Hands the setup to Bast (${project.name} is already ${words(project.status)})`;
    const tags = [KICKOFF_TAG, FROM_TRIAGE_TAG, ...(hold ? [PM_RELEASE_TAG] : [])];
    const body = hold
      ? `${lead}. The card moves to Not started, assigned to Bast, tagged ${listOf(tags)}. ${WAITS_FOR_PM_SENTENCE}`
      : `${lead}, who refines the plan and creates every task. The card moves to Not started, assigned to Bast, tagged ${listOf(tags)}.`;
    return {
      ready: true,
      block: null,
      line: `${body}${siteClause}${questionsClause(go, wait)}`,
      effects: { to_status: 'not_started', assign_bast: true, add_tags: tags, project_to_ready: toReady },
    };
  }

  // task, project_addition, reusable_tool, rule_proposal: the old rule holds, a task on a quote project is never released.
  if (project?.status === 'quote') return blocked('still_quote', `${project.name} is still a quote, so release is refused.`);
  const assignBast = input.assignee_id === null;
  const endsBast = assignBast || input.assignee_id === input.bast_id;
  const who = endsBast ? 'Bast' : (input.assignee_name ?? 'its assignee');
  const where = kind === 'project_addition' && project ? ` on ${project.name}` : '';
  const tags = [FROM_TRIAGE_TAG, ...(hold && endsBast ? [PM_RELEASE_TAG] : [])];
  const waits = hold && endsBast ? ` ${WAITS_FOR_PM_SENTENCE}` : '';
  return {
    ready: true,
    block: null,
    line: `Moves to Not started${where}, assigned to ${who}, tagged ${listOf(tags)}.${waits}${siteClause}${questionsClause(go, wait)}`,
    effects: { to_status: 'not_started', assign_bast: assignBast, add_tags: tags, project_to_ready: false },
  };
}
