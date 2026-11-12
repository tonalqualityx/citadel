/**
 * Home Slice 9a: judge and save what the machine read from his sent mail.
 *
 * `evaluateReconcile` is read only and is the ONE place every validation runs: the dry and the real POST both call it with the same
 * body, so their decisions are identical (a test feeds one body to both and compares). `saveReconcile` with dry:true returns those
 * decisions and writes nothing; without dry it then writes, in one transaction per message: the message row (a second POST of the
 * same message_key answers `already` and writes nothing), the internal notes (each with a Handled line), and the cards.
 *
 * Evidence is decided here, from Citadel's own data, never from the machine's opinion. In 9a nothing changes a task's status on its
 * own: only an internal note on his OWN open task is automatic. A time entry, project, task or wait is created only by his tap.
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import { threadLink } from '@/lib/bast-chat/ops/start-common';
import { ownerOnHome } from '../keeper/run';
import { loadSessionAsksFor } from '../load';
import { appendHomeAction } from '../state';
import { decide, type Decision, type DecideCtx, type WhyCode } from './decide';
import { noteKey, doneKey, waitingKey, sessionKeyOf, waitKey, workKey } from './dedupe';
import { clampMinutes, basisWords } from './estimate';
import { recordMikeQuoteEvidence } from '@/lib/work/evidence-writers'; // Work stage D
import { checkQuote, commitmentHit, plainQuote, relatedSentences, tenseOf } from './evidence';
import {
  CARDS_PER_DAY,
  LOOKBACK_CARDS_TOTAL,
  MIKE_ACCOUNTS,
  NOTES_PER_DAY,
  OPEN_TASK_STATUSES,
  activeHolds,
  attachedWork,
  bastDraftHashes,
  displayWho,
  emailsIn,
  loadCounters,
  loadTasks,
  loadThread,
  normalizeBody,
  reconcileOn,
  resolveRecipients,
  sha256,
  type LoadedTask,
  type MessageForFacts,
} from './load';
import { place, type PlacementProject } from './placement';
import { TITLES, noteLine, noteText, plainLine, quoteLine, trackLines, whoLabel } from './copy';
import { writeNote } from './note';
import { parseAction, type ParsedAction, type ReconcileBody, type ReconcileMessage } from './schema';

export const NOTE_UNDO_HOURS = 72;
export const CARD_DAYS = 14;
const DAY_MS = 24 * 3600 * 1000;
const AUTO_REPLY = /^\s*(?:accepted|declined|tentatively accepted|automatic reply|out of office)\b/i;
export const RECONCILE_ACTION_NOTE = 'reconcile_note';

export interface EvalDecision {
  i: number;
  result: 'noted' | 'carded' | 'nothing' | 'refused';
  reason?: string;
}

type ChangeData = Omit<Prisma.HomeReconcileChangeUncheckedCreateInput, 'message_id'>;

interface PlannedCard {
  i: number;
  data: ChangeData;
  /** An open card for the same piece of work: this message adds to its evidence and makes no second card. */
  append_to: string | null;
}
interface PlannedNote {
  i: number;
  task_id: string;
  task_title: string;
  text: string;
  line: string;
  details: string[];
  link: string;
  data: ChangeData;
  fallback: PlannedCard;
}

export interface EvalMessage {
  message_key: string;
  outcome: string;
  decisions: EvalDecision[];
  write: null | {
    row: Omit<Prisma.HomeReconcileMessageUncheckedCreateInput, 'user_id'>;
    notes: PlannedNote[];
    cards: PlannedCard[];
  };
}

export type EvalResult = { skipped: 'home_off' | 'reconcile_off'; messages: [] } | { skipped?: undefined; messages: EvalMessage[] };

const clip = (s: string, n: number): string => (s.length <= n ? s : s.slice(0, n));

function keyOf(a: ParsedAction, ctx: { threadRoot: string; clientKey: string; askText: (k: string) => string | null; messageKey: string }): string | null {
  switch (a.type) {
    case 'note':
      return noteKey(a.task_id, ctx.messageKey);
    case 'done':
      return doneKey(a.task_id);
    case 'waiting':
      return waitingKey(a.task_id);
    case 'session': {
      const t = ctx.askText(a.session_key);
      return t === null ? null : sessionKeyOf(a.session_key, t);
    }
    case 'wait':
      return waitKey(ctx.threadRoot, a.wait_on.email);
    case 'track':
      return workKey(ctx.clientKey, ctx.threadRoot);
  }
}

/** Every rule, read only. Never writes a row. */
export async function evaluateReconcile(db: PrismaClient, ownerId: string, body: ReconcileBody, now: Date): Promise<EvalResult> {
  const { ok, timezone } = await ownerOnHome(db, ownerId);
  if (!ok) return { skipped: 'home_off', messages: [] };
  if (!(await reconcileOn(db, ownerId))) return { skipped: 'reconcile_off', messages: [] };

  const counters = await loadCounters(db, ownerId, now, timezone);
  const holds = new Set(await activeHolds(db, ownerId, now));
  const hashes = new Set(await bastDraftHashes(db, ownerId, now));
  const keys = body.messages.map((m) => m.message_key);
  const existing = new Set((await db.homeReconcileMessage.findMany({ where: { user_id: ownerId, message_key: { in: keys } }, select: { message_key: true } })).map((r) => r.message_key));
  const needsAsks = body.messages.some((m) => m.actions.some((a) => (a as { type?: unknown })?.type === 'session'));
  const asks = needsAsks ? await loadSessionAsksFor(db, ownerId) : [];
  const askByKey = new Map(asks.map((a) => [a.external_id, a]));

  const out: EvalMessage[] = [];
  const seen = new Set<string>();
  const usedKeys = new Set<string>();
  const mem = { notes: counters.notes_today, cards: counters.cards_today, look: counters.lookback_cards };

  for (const m of body.messages) {
    if (existing.has(m.message_key) || seen.has(m.message_key)) {
      out.push({ message_key: m.message_key, outcome: 'already', decisions: [], write: null });
      continue;
    }
    seen.add(m.message_key);
    out.push(await evaluateOne(db, ownerId, m, now, { holds, hashes, askByKey, mem, usedKeys }));
  }
  return { messages: out };
}

interface Shared {
  holds: Set<string>;
  hashes: Set<string>;
  askByKey: Map<string, { external_id: string; title: string | null; waiting_on: string }>;
  mem: { notes: number; cards: number; look: number };
  usedKeys: Set<string>;
}

async function evaluateOne(db: PrismaClient, ownerId: string, m: ReconcileMessage, now: Date, sh: Shared): Promise<EvalMessage> {
  const sent = new Date(m.sent_at);
  const decisions: EvalDecision[] = [];
  const notes: PlannedNote[] = [];
  const cards: PlannedCard[] = [];
  const cost = Number(m.filter.cost_usd) + Number(m.match?.cost_usd ?? 0);
  const link = threadLink(m.account, m.thread_id);
  const row = (outcome: string, refusal: string | null): NonNullable<EvalMessage['write']>['row'] => ({
    message_key: m.message_key,
    account: m.account,
    gmail_id: m.gmail_id,
    thread_id: m.thread_id,
    sent_at: sent,
    to_label: clip(m.to_label, 300) || null,
    subject: clip(m.subject, 500) || null,
    outcome,
    refusal: refusal ? clip(refusal, 200) : null,
    lookback: m.lookback,
    filter_model: m.filter.model,
    match_model: m.match?.model ?? null,
    cost_usd: cost.toFixed(4),
  });
  const finish = (outcome: string, refusal: string | null = null): EvalMessage => ({
    message_key: m.message_key,
    outcome,
    decisions,
    write: { row: row(outcome, refusal), notes, cards },
  });

  // Rule 1: his mailbox, and not an automatic answer.
  if (!(MIKE_ACCOUNTS as readonly string[]).includes(m.account.toLowerCase()) || AUTO_REPLY.test(m.subject)) {
    m.actions.forEach((_a, i) => decisions.push({ i, result: 'nothing', reason: 'skipped' }));
    return finish('skipped');
  }
  if (m.actions.length === 0) return finish('nothing');

  const given = [...(m.to ?? []), ...(m.cc ?? [])].map((a) => a.email.toLowerCase());
  const recipients = given.length > 0 ? [...new Set(given)] : emailsIn(m.to_label);
  const { clients, names } = await resolveRecipients(db, recipients);
  const who = whoLabel(displayWho(recipients, names)) || 'someone';
  const thread = await loadThread(db, [m.thread_id, m.thread_root], [m.message_key, ...(m.thread_rfc_ids ?? [])]);
  const bastWords = m.bast_words || sh.hashes.has(sha256(normalizeBody(m.new_part)));
  const parsed = m.actions.map((a) => parseAction(a));
  const taskIds = parsed.flatMap((a) => (a && 'task_id' in a ? [a.task_id] : []));
  const msg: MessageForFacts = { message_key: m.message_key, thread_ids: thread.thread_ids, recipients, subject: m.subject, new_part: m.new_part, sent_at: sent };
  const tasks = await loadTasks(db, ownerId, taskIds, msg, thread, sh.holds, now);
  const clientKey = clients[0]?.id ?? (recipients[0]?.split('@')[1] ?? 'none');

  // Dedupe keys, then which of them already exist.
  const ctxKey = { threadRoot: m.thread_root, clientKey, askText: (k: string) => sh.askByKey.get(k)?.waiting_on ?? null, messageKey: m.message_key };
  const dkeys = parsed.map((a) => (a ? keyOf(a, ctxKey) : null));
  const found = await db.homeReconcileChange.findMany({
    where: { user_id: ownerId, dedupe_key: { in: dkeys.filter((k): k is string => !!k) } },
    select: { id: true, dedupe_key: true, state: true, shown_until: true },
  });
  const existing = new Map(found.map((f) => [f.dedupe_key, f]));

  let lastRefusal: string | null = null;
  for (let i = 0; i < parsed.length; i++) {
    const a = parsed[i];
    if (!a) {
      decisions.push({ i, result: 'refused', reason: 'bad_shape' });
      lastRefusal = 'bad_shape';
      continue;
    }
    const dkey = dkeys[i];
    const task: LoadedTask | undefined = 'task_id' in a ? tasks.get(a.task_id) : undefined;
    const ask = a.type === 'session' ? sh.askByKey.get(a.session_key) : undefined;
    const quote = checkQuote(a.quote, m.new_part);
    const prior = dkey ? existing.get(dkey) : undefined;
    let duplicate: DecideCtx['duplicate'] = 'none';
    if (dkey && sh.usedKeys.has(dkey)) duplicate = 'closed';
    else if (prior) duplicate = prior.state === 'open' && (!prior.shown_until || prior.shown_until > now) ? 'open' : 'closed';
    const commitment = relatedSentences(a.quote, m.new_part).some((s) => commitmentHit(s) !== null) || commitmentHit(a.quote) !== null;
    const ctx: DecideCtx = {
      lookback: m.lookback,
      bast_words: bastWords,
      quote,
      tense: tenseOf(a.quote),
      commitment,
      task: task ? task.facts : null,
      session_ok: !!ask,
      duplicate,
      caps: { notes_left: NOTES_PER_DAY - sh.mem.notes, cards_left: CARDS_PER_DAY - sh.mem.cards, lookback_cards_left: LOOKBACK_CARDS_TOTAL - sh.mem.look },
    };
    // Track it needs a client Citadel can see in the recipients (ids must be among the message's candidates).
    let trackClient: (typeof clients)[number] | null = null;
    if (a.type === 'track') {
      trackClient = a.client_id ? clients.find((c) => c.id === a.client_id) ?? null : clients[0] ?? null;
    }
    let d: Decision = decide({ type: a.type, confidence: a.confidence }, ctx);
    if (a.type === 'track' && !trackClient && d.result !== 'refused') d = { result: 'refused', reason: 'not_candidate' };
    // Work stage D: never propose Track it for a conversation open work already carries.
    if (a.type === 'track' && d.result !== 'refused' && (await attachedWork(db, m.thread_id))) d = { result: 'refused', reason: 'already' };

    if (d.result === 'refused') {
      decisions.push({ i, result: 'refused', reason: d.reason });
      lastRefusal = d.reason;
      continue;
    }
    if (d.result === 'nothing') {
      decisions.push({ i, result: 'nothing', reason: d.reason });
      continue;
    }
    if (dkey) sh.usedKeys.add(dkey);
    const quoteText = plainQuote(a.quote);
    const base = {
      user_id: ownerId,
      quote: clip(quoteText, 400),
      quote_to: clip(who, 300),
      quote_at: sent,
      link,
      confidence: a.confidence === 'high' ? 'high' : 'medium',
      basis: task?.basis ?? [],
      shown_until: new Date(now.getTime() + CARD_DAYS * DAY_MS),
    };

    if (d.result === 'note') {
      const t = task as LoadedTask;
      const text = noteText({ who, sent, quote: a.quote, link });
      sh.mem.notes += 1;
      decisions.push({ i, result: 'noted' });
      const fallbackData = noteCard(t, who, sent, a.quote, text, base, 'reach', dkey as string, true);
      notes.push({
        i,
        task_id: t.id,
        task_title: t.title,
        text,
        line: noteLine(t.title, who, sent),
        details: [quoteLine(who, sent, a.quote)],
        link,
        data: { ...base, kind: 'note', mode: 'auto', state: 'applied', target_key: `task:${t.id}`, dedupe_key: dkey as string, title: clip(noteLine(t.title, who, sent), 300), lines: [quoteLine(who, sent, a.quote)], plan: { type: 'note', task_id: t.id }, reason: null },
        fallback: { i, data: fallbackData, append_to: null },
      });
      continue;
    }

    // A card (or an addition to an open one).
    let data: ChangeData | null = null;
    if (d.card_kind === 'note') data = noteCard(task as LoadedTask, who, sent, a.quote, noteText({ who, sent, quote: a.quote, link }), base, d.why, dkey as string, false);
    else if (d.card_kind === 'done' && a.type === 'done') data = doneCard(task as LoadedTask, a.did_phrase, who, sent, a.quote, base, d.why, dkey as string, ownerId);
    else if (d.card_kind === 'waiting' && a.type === 'waiting') data = waitCard('waiting', a.wait_on, task as LoadedTask, who, sent, a.quote, base, d.why, dkey as string, m);
    else if (d.card_kind === 'wait' && a.type === 'wait') data = waitCard('wait', a.wait_on, null, who, sent, a.quote, base, d.why, dkey as string, m);
    else if (d.card_kind === 'session' && a.type === 'session' && ask) data = sessionCard(ask, who, sent, a.quote, base, d.why, dkey as string);
    else if (d.card_kind === 'track' && a.type === 'track' && trackClient) data = await trackCard(db, a, trackClient, who, sent, base, d.why, dkey as string, m);
    if (!data) {
      decisions.push({ i, result: 'refused', reason: 'bad_shape' });
      lastRefusal = 'bad_shape';
      continue;
    }
    if (!d.append) {
      if (m.lookback) sh.mem.look += 1;
      else sh.mem.cards += 1;
    }
    cards.push({ i, data, append_to: d.append && prior ? prior.id : null });
    decisions.push({ i, result: 'carded' });
  }

  const any = (r: EvalDecision['result']) => decisions.some((d) => d.result === r);
  const outcome = any('noted') ? 'noted' : any('carded') ? 'proposed' : any('refused') && bastWords && decisions.every((d) => d.result !== 'carded') && decisions.some((d) => d.reason === 'bast_words') ? 'bast_words' : any('refused') ? 'refused' : 'nothing';
  return finish(outcome, outcome === 'refused' || outcome === 'bast_words' ? lastRefusal : null);
}

type Base = { user_id: string; quote: string; quote_to: string; quote_at: Date; link: string; confidence: string; basis: string[]; shown_until: Date };

function cardCommon(base: Base, kind: string, dedupe: string, target: string | null, title: string, lines: string[], plan: unknown, why: WhyCode): ChangeData {
  return {
    ...base,
    kind,
    mode: 'card',
    state: 'open',
    target_key: target,
    dedupe_key: dedupe,
    title: clip(title, 300),
    lines: lines as Prisma.InputJsonValue,
    plan: plan as Prisma.InputJsonValue,
    reason: why,
  };
}

function noteCard(t: LoadedTask, who: string, sent: Date, quote: string, text: string, base: Base, why: WhyCode, dedupe: string, fallback: boolean): ChangeData {
  const title = t.mine ? TITLES.noteOwn(who, t.title) : TITLES.note(who, t.assignee_name ?? 'someone else', t.title);
  const data = cardCommon(base, 'note', dedupe, `task:${t.id}`, title, [quoteLine(who, sent, quote)], { type: 'note', task_id: t.id, text, owner_name: t.assignee_name }, why);
  // A fallback card shares the note's dedupe key, which is unique; give it its own so both may exist in a race.
  return fallback ? { ...data, dedupe_key: `${dedupe}:card` } : data;
}

function doneCard(t: LoadedTask, did: string, who: string, sent: Date, quote: string, base: Base, why: WhyCode, dedupe: string, ownerId: string): ChangeData {
  const lines = [quoteLine(who, sent, quote)];
  if (t.open_items.length > 0) lines.push(`Still open on this task: ${t.open_items.slice(0, 6).map((x) => plainLine(x, 80)).join('; ')}`);
  const plan = {
    type: 'done',
    task_id: t.id,
    assignee_id: ownerId,
    status: t.status,
    did_phrase: did,
    time: { offer: !t.has_time, default: clampMinutes(t.estimated_minutes) },
  };
  return cardCommon(base, 'done', dedupe, `task:${t.id}`, TITLES.done(did), lines, plan, why);
}

function waitCard(kind: 'wait' | 'waiting', w: { email: string; name: string; what: string }, t: LoadedTask | null, who: string, sent: Date, quote: string, base: Base, why: WhyCode, dedupe: string, m: ReconcileMessage): ChangeData {
  const name = w.name.trim() || w.email;
  const plan = { type: kind, task_id: t?.id ?? null, wait_on: w, thread_id: m.thread_id, thread_root: m.thread_root, account: m.account, subject: clip(m.subject, 200), sent_at: sent.toISOString() };
  return cardCommon(base, kind, dedupe, t ? `task:${t.id}` : null, TITLES.waiting(name, w.what), [quoteLine(who, sent, quote)], plan, why);
}

function sessionCard(ask: { external_id: string; title: string | null; waiting_on: string }, who: string, sent: Date, quote: string, base: Base, why: WhyCode, dedupe: string): ChangeData {
  const lines = [quoteLine(who, sent, quote), `The question: ${plainLine(ask.waiting_on, 200)}`];
  return cardCommon(base, 'session', dedupe, `session:${ask.external_id}`, TITLES.session(who, ask.title ?? 'a session'), lines, { type: 'session', session_key: ask.external_id, ask_hash: sha256(ask.waiting_on) }, why);
}

async function trackCard(
  db: PrismaClient,
  a: Extract<ParsedAction, { type: 'track' }>,
  client: { id: string; name: string; retainer_hours: number | null },
  who: string,
  sent: Date,
  base: Base,
  why: WhyCode,
  dedupe: string,
  m: ReconcileMessage
): Promise<ChangeData> {
  const projects = await db.project.findMany({
    where: { client_id: client.id, is_deleted: false },
    select: { id: true, name: true, status: true, type: true, is_retainer: true, tasks: { where: { is_deleted: false, status: { in: [...OPEN_TASK_STATUSES] } }, select: { title: true }, take: 6 } },
    take: 40,
  });
  const list: PlacementProject[] = projects.map((p) => ({ id: p.id, name: p.name, status: p.status, type: p.type, is_retainer: p.is_retainer, open_task_titles: p.tasks.map((t) => t.title) }));
  const placement = place({
    client_name: client.name,
    projects: list,
    named_project_id: a.project_id,
    work: { title: a.title, done_title: a.done_title, next_step: a.next_step, later: a.later },
  });
  const sites = await db.site.findMany({ where: { client_id: client.id }, select: { id: true, name: true }, take: 10 });
  const minutes = clampMinutes(a.minutes);
  const basis = basisWords(a.minutes, a.estimate_basis);
  const lines = trackLines({
    who,
    sent,
    quote: a.quote,
    done_title: a.done_title,
    minutes,
    estimate_basis: basis,
    retainer_hours: client.retainer_hours,
    client_name: client.name,
    placement,
    next_step: a.next_step,
    later: a.later,
  });
  const plan = {
    type: 'track',
    client_id: client.id,
    client_name: client.name,
    retainer: client.retainer_hours !== null,
    site_id: sites.length === 1 ? sites[0].id : null,
    placement: placement.kind === 'add' || placement.kind === 'ask' ? { kind: placement.kind, project_id: placement.project.id, project_name: placement.project.name } : { kind: placement.kind, project_id: null, project_name: null },
    title: a.title,
    done_title: a.done_title,
    next_step: a.next_step,
    later: a.later,
    minutes,
    account: m.account,
    thread_id: m.thread_id,
    sent_at: sent.toISOString(),
    evidence: [m.message_key],
  };
  const data = cardCommon(base, 'track', dedupe, null, TITLES.track(a.title), lines, plan, why);
  return { ...data, minutes_estimate: minutes, estimate_basis: clip(basis, 300) };
}

// ============================================================================
// The save
// ============================================================================

export interface SaveReply {
  skipped?: 'home_off' | 'reconcile_off';
  dry?: boolean;
  lookback_end?: 'set' | 'would_set' | 'already';
  messages: { message_key: string; outcome: string; decisions: EvalDecision[] }[];
}

const plain = (e: EvalMessage) => ({ message_key: e.message_key, outcome: e.outcome, decisions: e.decisions });

export async function saveReconcile(db: PrismaClient, ownerId: string, body: ReconcileBody, now: Date): Promise<SaveReply> {
  // The end marker: nothing to evaluate, but the same owner and switch checks apply, dry or real.
  if (body.lookback_end) {
    const { ok } = await ownerOnHome(db, ownerId);
    if (!ok) return { skipped: 'home_off', messages: [] };
    if (!(await reconcileOn(db, ownerId))) return { skipped: 'reconcile_off', messages: [] };
    const done = await db.homeKeeperRun.findFirst({ where: { user_id: ownerId, kind: 'reconcile_lookback' }, select: { id: true } });
    if (done) return { dry: body.dry, lookback_end: 'already', messages: [] };
    if (body.dry) return { dry: true, lookback_end: 'would_set', messages: [] };
    const { timezone } = await ownerOnHome(db, ownerId);
    const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    await db.homeKeeperRun.upsert({
      where: { user_id_date_kind: { user_id: ownerId, date: new Date(`${dateStr}T00:00:00.000Z`), kind: 'reconcile_lookback' } },
      create: { user_id: ownerId, date: new Date(`${dateStr}T00:00:00.000Z`), kind: 'reconcile_lookback', started_at: now, finished_at: now },
      update: {},
    });
    return { lookback_end: 'set', messages: [] };
  }

  const ev = await evaluateReconcile(db, ownerId, body, now);
  if (ev.skipped) return { skipped: ev.skipped, dry: body.dry, messages: [] };
  if (body.dry) return { dry: true, messages: ev.messages.map(plain) };

  const out: SaveReply['messages'] = [];
  for (const e of ev.messages) {
    if (!e.write) {
      out.push(plain(e));
      continue;
    }
    try {
      out.push(plain(await persistMessage(db, ownerId, e, now)));
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        out.push({ message_key: e.message_key, outcome: 'already', decisions: [] });
        continue;
      }
      throw err;
    }
  }
  // Cards past their two weeks go quietly (the evaluate step already treated them as closed).
  await db.homeReconcileChange.updateMany({ where: { user_id: ownerId, mode: 'card', state: 'open', shown_until: { lt: now } }, data: { state: 'expired', resolved_at: now } });
  return { messages: out };
}

async function persistMessage(db: PrismaClient, ownerId: string, e: EvalMessage, now: Date): Promise<EvalMessage> {
  const w = e.write as NonNullable<EvalMessage['write']>;
  return db.$transaction(
    async (txc) => {
      const tx = txc as unknown as PrismaClient;
      const msg = await tx.homeReconcileMessage.create({ data: { ...w.row, user_id: ownerId }, select: { id: true } });
      const decisions = e.decisions.map((d) => ({ ...d }));

      for (const n of w.notes) {
        // The note is written under the task's locks; a refused note (the task moved, or now needs a tap) becomes its card.
        const res = await writeNote(tx, ownerId, n.task_id, n.text, now);
        if (!res.ok) {
          const dec = decisions.find((d) => d.i === n.i);
          await tx.homeReconcileChange.create({ data: { ...n.fallback.data, message_id: msg.id } });
          if (dec) {
            dec.result = 'carded';
            dec.reason = undefined;
          }
          continue;
        }
        const change = await tx.homeReconcileChange.create({ data: { ...n.data, message_id: msg.id, comment_id: res.comment_id } });
        const action = await appendHomeAction(tx, ownerId, {
          item_key: `task:${n.task_id}`,
          action: RECONCILE_ACTION_NOTE,
          before: { states: [], reconcile: { kind: 'note', change_id: change.id, message_id: msg.id, comment_id: res.comment_id, task_id: n.task_id } },
          after: { states: [], line: n.line, details: n.details, link: n.link, reconcile: { kind: 'note', change_id: change.id, message_id: msg.id, comment_id: res.comment_id, task_id: n.task_id } },
          undo_until: new Date(now.getTime() + NOTE_UNDO_HOURS * 3600 * 1000),
          source: 'reconcile',
        });
        await tx.homeReconcileChange.update({ where: { id: change.id }, data: { home_action_id: action.id } });
        // Work stage D: his own sent words about this task are evidence on its work.
        await recordMikeQuoteEvidence(tx, { task_id: n.task_id, message_key: e.message_key, at: (n.data as { quote_at?: Date | null }).quote_at ?? now, href: n.link });
      }

      for (const c of w.cards) {
        if (c.append_to) {
          const cur = await tx.homeReconcileChange.findUnique({ where: { id: c.append_to }, select: { plan: true, state: true } });
          if (cur && cur.state === 'open') {
            const plan = (cur.plan && typeof cur.plan === 'object' && !Array.isArray(cur.plan) ? { ...(cur.plan as Record<string, unknown>) } : {}) as Record<string, unknown>;
            const ev = Array.isArray(plan.evidence) ? (plan.evidence as string[]) : [];
            plan.evidence = [...ev, e.message_key].slice(-20);
            await tx.homeReconcileChange.update({ where: { id: c.append_to }, data: { plan: plan as Prisma.InputJsonValue } });
          }
          continue;
        }
        await tx.homeReconcileChange.create({ data: { ...c.data, message_id: msg.id } });
      }
      return { ...e, decisions };
    },
    { timeout: 30_000, maxWait: 10_000 }
  );
}

