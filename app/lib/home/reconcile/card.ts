/**
 * Home Slice 9a: a card from his sent mail as a home screen row (type 'proposal'). Pure: built from the stored home_reconcile_change
 * row the loader read. Plain text, no red. The card never says it will do anything on its own.
 *
 * Buttons by kind (the owner's project rule on Track it):
 *   done      Mark it done, Not yet, No
 *   note      Add the note, Not yet, No
 *   waiting   Wait on them, Not yet, No          (and wait)
 *   session   Clear the question, Not yet, No
 *   track     'add':  Add to {project}, Start a new project, Not now, No leave it
 *             'ask':  the same buttons with no default (the card line asks "Add to {X} or start a new project?")
 *             'new':  Start a project for it, Not now, No leave it
 *             'loose' (a single finished one-off): Track it, Not now, No leave it
 */
import { effortWords, waitedFor } from '../copy';
import { proposalKey } from '../item-key';
import type { HomeItem, HomeItemAction, HomeProposal, RawReconcileCard } from '../types';
import { BUTTONS, IF_IGNORED_CARD, IF_IGNORED_TRACK, shortDay, whyAsk } from './copy';
import type { WhyCode } from './decide';
import { TIME_CHOICES } from './estimate';

export interface ProposalDraft {
  item: HomeItem;
  ifIgnored: string;
  why: string;
  buttons: HomeItemAction[];
  security: boolean;
  track: boolean;
  look_back: boolean;
  /** No button is the default (the card asks "add to X or start a new project?"). */
  no_default: boolean;
}

const btn = (id: HomeItemAction['id'], label: string, extra: Partial<HomeItemAction> = {}): HomeItemAction => ({ id, label, filled: false, href: null, ...extra });
const planObj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export function proposalButtons(card: Pick<RawReconcileCard, 'kind' | 'plan'>): { buttons: HomeItemAction[]; no_default: boolean } {
  const notYet = btn('not_now', BUTTONS.notYet);
  const no = btn('proposal_no', BUTTONS.no);
  switch (card.kind) {
    case 'done':
      return { buttons: [btn('proposal_yes', BUTTONS.markDone), notYet, no], no_default: false };
    case 'note':
      return { buttons: [btn('proposal_yes', BUTTONS.addNote), notYet, no], no_default: false };
    case 'waiting':
    case 'wait':
      return { buttons: [btn('proposal_yes', BUTTONS.waitOnThem), notYet, no], no_default: false };
    case 'session':
      return { buttons: [btn('proposal_yes', BUTTONS.clear), notYet, no], no_default: false };
    case 'track': {
      const pl = planObj(planObj(card.plan).placement);
      const kind = pl.kind;
      const name = typeof pl.project_name === 'string' ? pl.project_name : '';
      const notNow = btn('not_now', BUTTONS.notNow);
      const noLeave = btn('proposal_no', BUTTONS.noLeaveIt);
      if ((kind === 'add' || kind === 'ask') && name) {
        return {
          buttons: [btn('track_it', BUTTONS.addTo(name), { placement: 'project' }), btn('track_it', BUTTONS.startNewProject, { placement: 'new_project' }), notNow, noLeave],
          no_default: kind === 'ask',
        };
      }
      if (kind === 'loose') return { buttons: [btn('track_it', BUTTONS.trackIt, { placement: 'none' }), notNow, noLeave], no_default: false };
      return { buttons: [btn('track_it', BUTTONS.startProject, { placement: 'new_project' }), notNow, noLeave], no_default: false };
    }
  }
}

export function buildProposalDraft(card: RawReconcileCard, now: Date, timezone: string): ProposalDraft {
  const plan = card.plan;
  const reason = (card.reason ?? 'manual') as WhyCode;
  const { buttons, no_default } = proposalButtons(card);
  const link = card.link;
  const placementPlan = planObj(plan.placement);
  const timePlan = planObj(plan.time);
  let time: HomeProposal['time'] = null;
  if (card.kind === 'track') {
    time = { default: card.minutes_estimate ?? 30, choices: [...TIME_CHOICES], basis: card.estimate_basis, billable_choice: true };
  } else if (card.kind === 'done' && timePlan.offer === true) {
    time = { default: typeof timePlan.default === 'number' ? timePlan.default : 30, choices: [...TIME_CHOICES], basis: null, billable_choice: false };
  }
  const proposal: HomeProposal = {
    kind: card.kind,
    lines: card.lines,
    why: whyAsk(reason, { owner: typeof plan.owner_name === 'string' ? plan.owner_name : undefined }),
    link,
    look_back: card.look_back,
    time,
    placement:
      card.kind === 'track'
        ? {
            kind: (['add', 'ask', 'new', 'loose'] as const).find((k) => k === placementPlan.kind) ?? 'new',
            project_id: typeof placementPlan.project_id === 'string' ? placementPlan.project_id : null,
            project_name: typeof placementPlan.project_name === 'string' ? placementPlan.project_name : null,
          }
        : null,
  };
  const whyNow = card.who && card.quote_at ? `Your email to ${card.who}, ${shortDay(card.quote_at, timezone)}.` : 'From your sent mail.';
  const minutes = 2;
  const item: HomeItem = {
    key: proposalKey(card.id),
    type: 'proposal',
    title: card.title,
    who: card.who,
    age: waitedFor(card.created_at, now),
    why_now: whyNow,
    hard_date: null,
    effort: effortWords(minutes),
    minutes,
    actions: [],
    more_actions: [],
    default_if_ignored: '',
    reason: '',
    pinned: false,
    opened: {
      // The card lines are shown by the proposal block (ItemCard), not repeated here.
      summary: '',
      summary_by: null,
      done_when: [],
      how: null,
      links: link ? [{ label: BUTTONS.openEmail, href: link }] : [],
      task_id: typeof plan.task_id === 'string' ? plan.task_id : null,
      left_off_note: null,
    },
    source: { kind: 'proposal', id: card.id, ids: [card.id], task_status: null },
    client: null,
    project: null,
    proposal,
  };
  return {
    item,
    ifIgnored: card.kind === 'track' ? IF_IGNORED_TRACK : IF_IGNORED_CARD,
    why: proposal.why,
    buttons,
    security: reason === 'security',
    track: card.kind === 'track',
    look_back: card.look_back,
    no_default,
  };
}

/** Which open card takes the one Decisions ready slot: security first, then Track it, then the newest. */
export function proposalOrder(a: ProposalDraft & { id: string; at: Date }, b: ProposalDraft & { id: string; at: Date }): number {
  if (a.security !== b.security) return a.security ? -1 : 1;
  if (a.track !== b.track) return a.track ? -1 : 1;
  if (a.at.getTime() !== b.at.getTime()) return b.at.getTime() - a.at.getTime();
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
