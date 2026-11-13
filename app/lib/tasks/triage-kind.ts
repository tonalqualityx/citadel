/**
 * What Release does to a Triage card, decided in ONE place (Triage tab plan, decision 3).
 *
 * `planRelease` takes a card's kind, assignee and project and returns the effects Release will apply AND the sentence that
 * describes them. The sentence is built from the effects, and `release()` in triage.ts applies exactly those effects, so the
 * "On release" line can never promise something the action does not do. Pure: no database, no React.
 *
 *   project_setup                                     project queue -> ready, card -> not_started, assigned to Bast, tags kickoff + from-triage
 *   task | project_addition | reusable_tool | rule_proposal   card -> not_started, assigned to Bast when nobody is, tag from-triage
 *   question_only                                     card closed as done; its questions and answers stay on it
 *   null (not sorted yet)                             nothing: release is refused
 */

export const TRIAGE_KINDS = ['project_setup', 'task', 'project_addition', 'reusable_tool', 'rule_proposal', 'question_only'] as const;
export type TriageKindName = (typeof TRIAGE_KINDS)[number];

export const FROM_TRIAGE_TAG = 'from-triage';
export const KICKOFF_TAG = 'kickoff';

export type ReleaseBlock = 'unsorted' | 'no_project' | 'still_quote' | 'project_closed';

export interface ReleaseInput {
  kind: TriageKindName | null;
  assignee_id: string | null;
  assignee_name: string | null;
  project: { id: string; name: string; status: string } | null;
  bast_id: string;
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

export function planRelease(input: ReleaseInput): ReleasePlan {
  const { kind, project } = input;
  const blocked = (block: ReleaseBlock, line: string): ReleasePlan => ({ ready: false, block, line, effects: null });
  if (kind === null) return blocked('unsorted', NOT_SORTED_LINE);

  if (kind === 'question_only') {
    return {
      ready: true,
      block: null,
      line: 'Closes the card as done. The questions and answers stay on it.',
      effects: { to_status: 'done', assign_bast: false, add_tags: [], project_to_ready: false },
    };
  }

  if (kind === 'project_setup') {
    if (!project) return blocked('no_project', 'Needs its project linked before it can be released.');
    if (project.status === 'quote') return blocked('still_quote', `${project.name} is still a quote, so release is refused.`);
    if (['cancelled', 'done', 'suspended'].includes(project.status)) return blocked('project_closed', `${project.name} is ${words(project.status)}, so release is refused.`);
    const toReady = project.status === 'queue';
    const lead = toReady ? `Makes ${project.name} ready and hands the setup to Bast` : `Hands the setup to Bast (${project.name} is already ${words(project.status)})`;
    return {
      ready: true,
      block: null,
      line: `${lead}, who refines the plan and creates every task. The card moves to Not started, assigned to Bast, tagged ${KICKOFF_TAG} and ${FROM_TRIAGE_TAG}.`,
      effects: { to_status: 'not_started', assign_bast: true, add_tags: [KICKOFF_TAG, FROM_TRIAGE_TAG], project_to_ready: toReady },
    };
  }

  // task, project_addition, reusable_tool, rule_proposal: the old rule holds, a task on a quote project is never released.
  if (project?.status === 'quote') return blocked('still_quote', `${project.name} is still a quote, so release is refused.`);
  const assignBast = input.assignee_id === null;
  const who = assignBast || input.assignee_id === input.bast_id ? 'Bast' : (input.assignee_name ?? 'its assignee');
  const where = kind === 'project_addition' && project ? ` on ${project.name}` : '';
  return {
    ready: true,
    block: null,
    line: `Moves to Not started${where}, assigned to ${who}, tagged ${FROM_TRIAGE_TAG}.`,
    effects: { to_status: 'not_started', assign_bast: assignBast, add_tags: [FROM_TRIAGE_TAG], project_to_ready: false },
  };
}
