import { describe, it, expect } from 'vitest';
import { decide, type DecideCtx, type TaskFacts } from '../decide';

const facts = (over: Partial<TaskFacts> = {}): TaskFacts => ({
  candidate: true,
  mine: true,
  open: true,
  deleted: false,
  created_before_sent: true,
  held: false,
  protected_tag: false,
  client_visible: false,
  portal: false,
  approval_open: false,
  tied: false,
  reach_tap: false,
  ...over,
});
const ctx = (over: Partial<DecideCtx> = {}): DecideCtx => ({
  lookback: false,
  bast_words: false,
  quote: { ok: true },
  tense: 'done',
  commitment: false,
  task: facts(),
  session_ok: true,
  duplicate: 'none',
  caps: { notes_left: 20, cards_left: 10, lookback_cards_left: 25 },
  ...over,
});
const A = (type: 'note' | 'done' | 'waiting' | 'session' | 'wait' | 'track', confidence: 'high' | 'medium' | 'low' = 'high') => ({ type, confidence });

describe('decide: the binding table in 9a', () => {
  it('a note on his own open task is the one automatic change', () => {
    expect(decide(A('note'), ctx())).toEqual({ result: 'note' });
    expect(decide(A('note', 'medium'), ctx())).toEqual({ result: 'note' });
  });
  it('nothing changes a task status by itself: a clean done is still a card', () => {
    expect(decide(A('done'), ctx())).toMatchObject({ result: 'card', card_kind: 'done' });
    expect(decide(A('waiting'), ctx())).toMatchObject({ result: 'card', card_kind: 'waiting' });
    expect(decide(A('session'), ctx())).toMatchObject({ result: 'card', card_kind: 'session' });
    expect(decide(A('wait'), ctx({ task: null }))).toMatchObject({ result: 'card', card_kind: 'wait' });
    expect(decide(A('track'), ctx({ task: null }))).toMatchObject({ result: 'card', card_kind: 'track', why: 'new_work' });
  });
  it('a protected task may get a note but its done is a card that says it is a security task', () => {
    const c = ctx({ task: facts({ protected_tag: true }) });
    expect(decide(A('note'), c)).toEqual({ result: 'note' });
    expect(decide(A('done'), c)).toMatchObject({ result: 'card', card_kind: 'done', why: 'security' });
  });
  it("someone else's task is a card only, even for a note, and a done on it only offers a note", () => {
    const c = ctx({ task: facts({ mine: false }) });
    expect(decide(A('note'), c)).toMatchObject({ result: 'card', card_kind: 'note', why: 'someone_else' });
    expect(decide(A('done'), c)).toMatchObject({ result: 'card', card_kind: 'note', why: 'someone_else' });
  });
  it('look-back mail never notes: cards only', () => {
    expect(decide(A('note'), ctx({ lookback: true }))).toMatchObject({ result: 'card', why: 'older' });
    expect(decide(A('done'), ctx({ lookback: true }))).toMatchObject({ result: 'card', why: 'older' });
  });
  it('a hold turns a note into a card (after "This was wrong" or Undo)', () => {
    expect(decide(A('note'), ctx({ task: facts({ held: true }) }))).toMatchObject({ result: 'card', why: 'wrong_hold' });
  });
  it('a reach check, a client visible task or an open approval turns a note into a card', () => {
    for (const over of [{ reach_tap: true }, { client_visible: true }, { portal: true }, { approval_open: true }]) {
      expect(decide(A('note'), ctx({ task: facts(over) }))).toMatchObject({ result: 'card', why: 'reach' });
    }
  });
  it('the 21st note of a day is a card', () => {
    expect(decide(A('note'), ctx({ caps: { notes_left: 0, cards_left: 10, lookback_cards_left: 25 } }))).toMatchObject({ result: 'card', why: 'cap' });
  });
  it('past the daily card cap a card is nothing; an addition to an open card is not counted', () => {
    const capped = ctx({ caps: { notes_left: 0, cards_left: 0, lookback_cards_left: 25 }, task: null });
    expect(decide(A('track'), capped)).toEqual({ result: 'nothing', reason: 'cap' });
    expect(decide(A('track'), { ...capped, duplicate: 'open' })).toMatchObject({ result: 'card', append: true });
    expect(decide(A('track'), ctx({ task: null, lookback: true, caps: { notes_left: 20, cards_left: 10, lookback_cards_left: 0 } }))).toEqual({ result: 'nothing', reason: 'cap' });
  });
  it('low confidence and hedged statements are nothing', () => {
    expect(decide(A('note', 'low'), ctx())).toEqual({ result: 'nothing', reason: 'low_confidence' });
    expect(decide(A('done'), ctx({ tense: 'hedged' }))).toEqual({ result: 'nothing', reason: 'hedged' });
  });
  it('medium confidence, no past tense or a commitment make a done a card with its own reason', () => {
    expect(decide(A('done', 'medium'), ctx())).toMatchObject({ result: 'card', why: 'unsure' });
    expect(decide(A('done'), ctx({ tense: 'none' }))).toMatchObject({ result: 'card', why: 'unsure' });
    expect(decide(A('done'), ctx({ commitment: true }))).toMatchObject({ result: 'card', why: 'commitment' });
  });
  it('a quote that is not his new words is refused, before anything else', () => {
    expect(decide(A('note'), ctx({ quote: { ok: false, reason: 'quote_not_new' } }))).toEqual({ result: 'refused', reason: 'quote_not_new' });
    expect(decide(A('track'), ctx({ quote: { ok: false, reason: 'quote_long' } }))).toEqual({ result: 'refused', reason: 'quote_long' });
  });
  it('Bast words: only Track it survives, and it is a card that says so', () => {
    expect(decide(A('note'), ctx({ bast_words: true }))).toEqual({ result: 'refused', reason: 'bast_words' });
    expect(decide(A('done'), ctx({ bast_words: true }))).toEqual({ result: 'refused', reason: 'bast_words' });
    expect(decide(A('track'), ctx({ bast_words: true, task: null }))).toMatchObject({ result: 'card', why: 'bast_words' });
  });
  it('a target that is not a candidate, or not open, is refused', () => {
    expect(decide(A('note'), ctx({ task: null }))).toEqual({ result: 'refused', reason: 'not_candidate' });
    expect(decide(A('note'), ctx({ task: facts({ candidate: false }) }))).toEqual({ result: 'refused', reason: 'not_candidate' });
    expect(decide(A('done'), ctx({ task: facts({ open: false }) }))).toEqual({ result: 'refused', reason: 'not_open' });
    expect(decide(A('done'), ctx({ task: facts({ created_before_sent: false }) }))).toEqual({ result: 'refused', reason: 'not_open' });
    expect(decide(A('session'), ctx({ session_ok: false }))).toEqual({ result: 'refused', reason: 'not_candidate' });
  });
  it('a piece of work already proposed (or dismissed) is refused as a duplicate', () => {
    expect(decide(A('done'), ctx({ duplicate: 'closed' }))).toEqual({ result: 'refused', reason: 'duplicate' });
  });
  it('the 9b auto switch is never set in 9a', () => {
    expect(decide(A('done'), ctx({ auto: undefined }))).toMatchObject({ result: 'card' });
  });
});
