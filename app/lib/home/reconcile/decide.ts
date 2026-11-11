/**
 * Home Slice 9a: decide what one action becomes (the binding table), from facts Citadel read itself. Pure.
 *
 * In 9a NOTHING changes a task's status on its own. The only automatic change is an internal note on his OWN open task
 * (each with a Handled line, Undo and "This was wrong"). Everything else is a card, or nothing. The 9b auto branch sits
 * behind `ctx.auto`, which 9a never sets.
 *
 * Refused (the machine drops these and never retries): quote_not_new, quote_long, not_open, not_candidate, duplicate, bast_words, held.
 * Nothing (valid but not worth a line): low confidence, a hedged or future statement, a daily cap reached.
 */
import type { QuoteCheck } from './evidence';

export type ActionType = 'note' | 'done' | 'waiting' | 'session' | 'wait' | 'track';
export type Confidence = 'high' | 'medium' | 'low';
export type RefusalCode = 'quote_not_new' | 'quote_long' | 'not_open' | 'not_candidate' | 'held' | 'duplicate' | 'already' | 'bad_shape' | 'bast_words';
export type WhyCode =
  | 'security'
  | 'someone_else'
  | 'unsure'
  | 'older'
  | 'commitment'
  | 'bast_words'
  | 'wrong_hold'
  | 'cap'
  | 'reach'
  | 'manual'
  | 'new_work';

export interface TaskFacts {
  /** The task was among the message's recomputed candidates (valid basis). */
  candidate: boolean;
  mine: boolean;
  open: boolean;
  deleted: boolean;
  created_before_sent: boolean;
  /** A reconcile hold is on it (after Undo, "This was wrong" or No). */
  held: boolean;
  protected_tag: boolean;
  client_visible: boolean;
  portal: boolean;
  approval_open: boolean;
  /** A task waits on it, or an open wait is linked to it. */
  tied: boolean;
  /** The reach check says a tap is needed for a note (Bast holds it, or its last comment decides a wake). */
  reach_tap: boolean;
}

export interface DecideCtx {
  lookback: boolean;
  bast_words: boolean;
  quote: QuoteCheck;
  tense: 'done' | 'hedged' | 'none';
  commitment: boolean;
  /** note, done, waiting: the task facts, or null when the id is not a known task. */
  task: TaskFacts | null;
  /** session: the key names an ask parked on him. */
  session_ok: boolean;
  duplicate: 'none' | 'open' | 'closed';
  caps: { notes_left: number; cards_left: number; lookback_cards_left: number };
  /** 9b only. Never true in 9a. */
  auto?: boolean;
}

export interface DecideAction {
  type: ActionType;
  confidence: Confidence;
}

export type Decision =
  | { result: 'refused'; reason: RefusalCode }
  | { result: 'nothing'; reason: string }
  | { result: 'note' }
  | { result: 'card'; card_kind: 'note' | 'done' | 'waiting' | 'session' | 'wait' | 'track'; why: WhyCode; append: boolean };

const card = (card_kind: Extract<Decision, { result: 'card' }>['card_kind'], why: WhyCode, append = false): Decision => ({ result: 'card', card_kind, why, append });

export function decide(action: DecideAction, ctx: DecideCtx): Decision {
  // Rule 5: the quote is his own new words.
  if (!ctx.quote.ok) return { result: 'refused', reason: ctx.quote.reason };
  // Bast's own words are never evidence that he did something (fact 11): only Track it survives.
  if (ctx.bast_words && action.type !== 'track') return { result: 'refused', reason: 'bast_words' };
  if (action.confidence === 'low') return { result: 'nothing', reason: 'low_confidence' };
  if (ctx.tense === 'hedged') return { result: 'nothing', reason: 'hedged' };

  const t = action.type;
  if (t === 'note' || t === 'done' || t === 'waiting') {
    const task = ctx.task;
    if (!task || !task.candidate) return { result: 'refused', reason: 'not_candidate' };
    if (task.deleted || !task.open || !task.created_before_sent) return { result: 'refused', reason: 'not_open' };
  }
  if (t === 'session' && !ctx.session_ok) return { result: 'refused', reason: 'not_candidate' };

  if (ctx.duplicate === 'closed') return { result: 'refused', reason: 'duplicate' };
  const append = ctx.duplicate === 'open';

  const capped = (d: Decision): Decision => {
    if (d.result !== 'card' || d.append) return d;
    if (ctx.lookback ? ctx.caps.lookback_cards_left <= 0 : ctx.caps.cards_left <= 0) return { result: 'nothing', reason: 'cap' };
    return d;
  };

  if (t === 'note') {
    const task = ctx.task as TaskFacts;
    if (!task.mine) return capped(card('note', 'someone_else', append));
    if (ctx.lookback) return capped(card('note', 'older', append));
    if (task.held) return capped(card('note', 'wrong_hold', append));
    if (task.reach_tap || task.client_visible || task.portal || task.approval_open) return capped(card('note', 'reach', append));
    if (ctx.caps.notes_left <= 0) return capped(card('note', 'cap', append));
    return { result: 'note' };
  }

  if (t === 'done' || t === 'waiting') {
    const task = ctx.task as TaskFacts;
    // Someone else's task, or a done or waiting statement about it: a card that offers a note, never a status change.
    if (!task.mine) return capped(card('note', 'someone_else', append));
    const kind = t;
    if (task.protected_tag) return capped(card(kind, 'security', append));
    if (ctx.lookback) return capped(card(kind, 'older', append));
    if (task.held) return capped(card(kind, 'wrong_hold', append));
    if (ctx.commitment) return capped(card(kind, 'commitment', append));
    if (action.confidence !== 'high' || ctx.tense !== 'done') return capped(card(kind, 'unsure', append));
    return capped(card(kind, 'manual', append));
  }

  if (t === 'session' || t === 'wait') {
    if (ctx.lookback) return capped(card(t, 'older', append));
    if (ctx.commitment) return capped(card(t, 'commitment', append));
    return capped(card(t, action.confidence === 'high' ? 'manual' : 'unsure', append));
  }

  // track: never a status change, never any write until his tap.
  if (ctx.bast_words) return capped(card('track', 'bast_words', append));
  if (ctx.lookback) return capped(card('track', 'older', append));
  return capped(card('track', 'new_work', append));
}
