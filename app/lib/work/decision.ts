/**
 * Work stage B: the one decision per message. Pure, no database.
 *
 * The classifier (the only place mail bodies exist) returns one disposition per message and applies the body-level floors
 * itself. This file holds the floors that need only state, so they are code and not a model's choice:
 *
 * - An urgent ask, an admin ask (money mail is always shown) and a sales ask can never be no_action or waiting_them. A refused
 *   value is stored as reply_mike and reported in adjusted[]. The floors only raise, never lower.
 * - An emergency with no urgent flag has no emergency path to land on, so it is stored as reply_mike (the ask stays on his
 *   screen as an owed reply) and reported.
 *
 * - One narrow exemption from the admin floor: a routine provider receipt (floor_exempt 'provider_receipt'). The server does not
 *   trust the claim: isVerifiedProviderReceipt re-checks the subject against a closed list, the sender's domain against the
 *   provider, and the absence of any trouble wording. Anything that fails keeps the floor exactly as it was.
 *
 * It also holds the birth state (what row an intake decision creates) and the owner of a decision. Nothing here sends,
 * drafts or changes mail.
 */

export const DISPOSITIONS = ['no_action', 'reply_mike', 'work', 'meeting', 'waiting_them', 'emergency'] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

export const OWNERS = ['mike', 'bast', 'sabeen', 'nobody'] as const;
export type DecisionOwner = (typeof OWNERS)[number];

export const DISPOSITION_REASON_MAX = 120;

/** A where fragment: asks Mike has not decided himself (a reopen puts decided_by 'mike' on the ask, which holds it open). */
export const notHeldByMike: { OR: ({ decided_by: null } | { decided_by: { not: string } })[] } = { OR: [{ decided_by: null }, { decided_by: { not: 'mike' } }] };

export function isDisposition(v: unknown): v is Disposition {
  return typeof v === 'string' && (DISPOSITIONS as readonly string[]).includes(v);
}

/** A reason as stored: one plain line of at most 120 characters, no dashes (a dash from a model becomes a comma). */
export function cleanReason(v: string | null | undefined): string | null {
  const s = (v ?? '')
    .replace(/[\u2013\u2014]/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
  if (s === '') return null;
  return s.length > DISPOSITION_REASON_MAX ? s.slice(0, DISPOSITION_REASON_MAX - 1).trimEnd() : s;
}

// ----------------------------------------------------------------------------
// The one floor exemption: a routine provider receipt
// ----------------------------------------------------------------------------

export const FLOOR_EXEMPTIONS = ['provider_receipt'] as const;
export type FloorExempt = (typeof FLOOR_EXEMPTIONS)[number];

export interface ReceiptFacts {
  subject: string | null | undefined;
  from_email: string | null | undefined;
  gist: string | null | undefined;
  is_urgent: boolean;
  intent: string | null | undefined;
}

interface ReceiptRule {
  /** Sender domains. An entry matches that domain exactly, or a subdomain of it when `sub` is true. */
  domains: readonly string[];
  sub: boolean;
  subjects: readonly RegExp[];
  /** When set, only these exact sender addresses match (the domain alone is not enough). */
  senders?: readonly string[];
}

/**
 * The closed list. Same shape as the classifier's provider_receipt rule (PROVIDER_ROUTINE_RECEIPTS in email-classifier.py): the
 * money-in receipts of the two invoicing tools, and the "your invoice is available" notices of three providers. The Intuit and
 * Wave invoice rows name the owner's own businesses, so an invoice a vendor sends him is never in the list.
 */
export const PROVIDER_RECEIPT_RULES: readonly ReceiptRule[] = [
  {
    domains: ['intuit.com'],
    sub: true,
    subjects: [/^payment received:\s+invoice\s+#?\d+/i, /^invoice\s+#?\d+\s+from\s+indelible\b/i],
  },
  {
    domains: ['waveapps.com'],
    sub: true,
    subjects: [/^congrats, you just got paid!?\s*$/i, /^invoice\s+#?\d+\s+from\s+who is mike dion\b/i],
  },
  {
    domains: ['cloudflare.com', 'notify.cloudflare.com'],
    sub: false,
    subjects: [/^your invoice is available\s*$/i],
  },
  {
    domains: ['google.com'],
    sub: false,
    subjects: [/^google workspace:\s+your invoice is available(?:\s+for\s+[a-z0-9][a-z0-9.-]*\.[a-z]{2,})?\s*$/i, /^your invoice is available\s*$/i],
  },
  {
    domains: ['aws.com', 'amazon.com'],
    sub: false,
    subjects: [
      /^amazon web services billing statement available(?:\s*\[account:\s*\d+\])?\s*$/i,
      /^aws billing statement available(?:\s*\[account:\s*\d+\])?\s*$/i,
      /^your (?:amazon web services|aws) invoice is available\s*$/i,
      /^your invoice is available\s*$/i,
    ],
  },
  {
    domains: ['cloudways.com'],
    sub: false,
    subjects: [/^\[cloudways\]\s+your\s+\d{4}-\d{2}\s+invoice\s+for\s+team:\s+.+?\s+is\s+available\s*$/i],
  },
  {
    domains: ['billtrust.com'],
    sub: false,
    subjects: [/^Acct No\. \d+: Your Invoice from AmeriGas Propane is Available\b.*$/i],
  },
  {
    domains: ['sendgrid.com'],
    sub: false,
    subjects: [/^you have a new invoice from sendgrid\s*\(INV\d+\)\s*$/i],
  },
  {
    domains: ['smarthub.coop'],
    sub: false,
    subjects: [/^your bill is available to view online\s*$/i],
  },
  {
    domains: ['mail.nexudus.com'],
    sub: false,
    subjects: [/^new invoice from black river innovation campus\s*$/i, /^payment confirmation for invoice\s+#?[A-Za-z0-9-]+\s*$/i],
  },
  {
    // Our own support group relays the AWS statement. Only this exact sender and this exact subject shape.
    domains: ['becomeindelible.com'],
    sub: false,
    senders: ['support@becomeindelible.com'],
    subjects: [/^amazon web services billing statement available(?:\s*\[account:\s*\d+\])?\s*$/i],
  },
];

/** Trouble wording: any hit in the subject or the gist and the receipt is not routine. Mirrors PROVIDER_RECEIPT_VETO_RE. */
export const RECEIPT_VETO_RE = new RegExp(
  '(past due|overdue|owed|owe\\b|unpaid|balance due|amount due|due (?:on|by|today|soon)|failed|failure|declin|refund' +
    '|dispute|charge ?back|suspend|expir|renew|cancel|terminat|delinquen|final notice|action required|action needed' +
    '|attention|warning|alert|security|suspicious|unusual|unauthori[sz]ed|compromis|breach|risk|problem|error|issue' +
    '|unable|could not|couldn\'t|locked|verify|confirm your|exceed|limit|outage|\\bdown\\b|payment request' +
    '|request for payment|please (?:pay|pay now)|pay now|update your)',
  'i',
);

/** The domain of one plain address, lowercased, or null when the value is not exactly one address. */
export function senderDomain(addr: string | null | undefined): string | null {
  const a = (addr ?? '').trim().toLowerCase();
  if (!/^[^\s@<>,;]+@[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(a)) return null;
  return a.slice(a.indexOf('@') + 1);
}

/**
 * The server's own check of a floor_exempt claim. True only when the ask is not urgent, its intent is admin, the subject is on the
 * closed list for the provider whose domain sent it, and neither the subject nor the gist carries trouble wording. A lookalike
 * domain (a longer name that merely contains the provider's) never matches.
 */
export function isVerifiedProviderReceipt(f: ReceiptFacts): boolean {
  if (f.is_urgent || f.intent !== 'admin') return false;
  const subject = (f.subject ?? '').trim();
  const domain = senderDomain(f.from_email);
  if (!subject || !domain) return false;
  if (RECEIPT_VETO_RE.test(`${subject} ${f.gist ?? ''}`)) return false;
  const addr = (f.from_email ?? '').trim().toLowerCase();
  return PROVIDER_RECEIPT_RULES.some(
    (r) => (!r.senders || r.senders.includes(addr)) && r.domains.some((d) => domain === d || (r.sub && domain.endsWith('.' + d))) && r.subjects.some((re) => re.test(subject)),
  );
}

export interface FloorFacts {
  is_urgent: boolean;
  intent: string | null;
  /** A claim that this is a routine provider receipt, with what the server needs to check it. Never trusted on its own. */
  exempt?: { kind: FloorExempt | null | undefined; subject: string | null | undefined; from_email: string | null | undefined; gist: string | null | undefined };
}

export interface FloorResult {
  disposition: Disposition;
  /** Why the value was changed, or null when it stands. */
  adjusted: string | null;
  /** Set when a verified provider receipt was let through the admin floor. */
  exempted?: FloorExempt;
}

/** True when a no_action may skip the admin floor: the claim names a known exemption and the server's own check passes. */
export function floorExemptHolds(f: FloorFacts): boolean {
  const e = f.exempt;
  if (!e || e.kind !== 'provider_receipt') return false;
  return isVerifiedProviderReceipt({ subject: e.subject, from_email: e.from_email, gist: e.gist, is_urgent: f.is_urgent, intent: f.intent });
}

/** The structural floors. */
export function applyFloors(disposition: Disposition, facts: FloorFacts): FloorResult {
  if (disposition === 'no_action' || disposition === 'waiting_them') {
    if (facts.is_urgent) return { disposition: 'reply_mike', adjusted: `${disposition}_refused_urgent` };
    if (facts.intent === 'admin') {
      if (disposition === 'no_action' && floorExemptHolds(facts)) return { disposition, adjusted: null, exempted: 'provider_receipt' };
      return { disposition: 'reply_mike', adjusted: `${disposition}_refused_admin` };
    }
    if (facts.intent === 'sales') return { disposition: 'reply_mike', adjusted: `${disposition}_refused_sales` };
  }
  if (disposition === 'emergency' && !facts.is_urgent) return { disposition: 'reply_mike', adjusted: 'emergency_without_urgent_flag' };
  return { disposition, adjusted: null };
}

/** The owner of a decision. `work` takes the task's assignee when the ask is already linked; else it is not known yet. */
export function ownerFor(disposition: Disposition, taskOwner?: DecisionOwner | null): DecisionOwner | null {
  switch (disposition) {
    case 'work':
      return taskOwner ?? null;
    case 'reply_mike':
    case 'meeting':
    case 'emergency':
      return 'mike';
    case 'no_action':
    case 'waiting_them':
      return 'nobody';
  }
}

/** What a newly created ask looks like for a disposition (rule 5: set only when the row is created). */
export interface BirthState {
  state: 'open' | 'handled';
  closed_reason: 'no_action' | 'waiting_them' | null;
  closed_by: 'intake' | null;
  /** waiting_them also opens one mail.awaiting_reply wait. */
  wait: boolean;
}

export function birthState(disposition: Disposition): BirthState {
  if (disposition === 'no_action') return { state: 'handled', closed_reason: 'no_action', closed_by: 'intake', wait: false };
  if (disposition === 'waiting_them') return { state: 'handled', closed_reason: 'waiting_them', closed_by: 'intake', wait: true };
  return { state: 'open', closed_reason: null, closed_by: null, wait: false };
}

/** The idempotency key of the wait a waiting_them birth opens: one wait per conversation. */
export function waitKeyFor(conversationKey: string | null | undefined, messageId: string): string {
  const k = (conversationKey ?? '').trim();
  return k ? `conv:${k}` : `msg:${messageId}`;
}

/** The assignee of a task as an owner word: Bast's bot users are 'bast', the home owner is 'mike', anyone else 'sabeen'. */
export function ownerOfAssignee(assigneeId: string | null | undefined, ownerId: string | null, botIds: readonly string[]): DecisionOwner {
  if (assigneeId && botIds.includes(assigneeId)) return 'bast';
  if (!assigneeId || assigneeId === ownerId) return 'mike';
  return 'sabeen';
}

// ----------------------------------------------------------------------------
// The replay: what a decided disposition would do to an open legacy ask
// ----------------------------------------------------------------------------

export interface ReplayAsk {
  id: string;
  state: string;
  disposition: string | null;
  decided_by: string | null;
  is_urgent: boolean;
  intent: string | null;
  task_id: string | null;
  /** The linked task is security tagged (its asks are never closed by inference). */
  task_security: boolean;
  /** What the provider-receipt check reads (all optional: absent means the check cannot pass). */
  subject?: string | null;
  from_email?: string | null;
  gist?: string | null;
}

/** decided_by values that mean a machine decided (the replay or the intake), never the owner. */
export const MACHINE_DECIDERS = ['intake', 'bast', 'other_copy'] as const;

export type ReplayVerdict = 'close' | 'set' | 'leave' | 'refused';

export interface ReplayDecision {
  ask_id: string;
  verdict: ReplayVerdict;
  /** The disposition that would be stored (after floors), or null when nothing is written. */
  disposition: Disposition | null;
  /** Why nothing is written or the value changed. */
  why: string | null;
}

/**
 * ONE function for both the dry read (decision-replay) and the real run (apply-decisions), so dry and real decide
 * identically. Only an ask that is open, undecided (no disposition) and not held by Mike's own reopen is touched. Only no_action
 * closes; reply_mike, meeting and (urgent only) emergency are stored without closing; work is stored only on an ask already linked
 * to a task; waiting_them is never applied by the replay (it would need a wait), so it is left.
 */
export function decideReplay(ask: ReplayAsk | null, item: { disposition: string; reason?: string | null; floor_exempt?: FloorExempt | null }): ReplayDecision {
  if (!ask) return { ask_id: '', verdict: 'refused', disposition: null, why: 'ask_not_found' };
  const out = (verdict: ReplayVerdict, disposition: Disposition | null, why: string | null): ReplayDecision => ({ ask_id: ask.id, verdict, disposition, why });
  if (!isDisposition(item.disposition)) return out('refused', null, 'not_a_disposition');
  if (ask.state !== 'open') return out('leave', null, 'not_open');
  const exemptFacts = { kind: item.floor_exempt, subject: ask.subject, from_email: ask.from_email, gist: ask.gist };
  if (ask.disposition !== null) {
    // The one way a stored decision changes: a verified routine provider receipt that an earlier machine pass left as reply_mike
    // is recorded as handled. Never one he decided himself, never any other stored value, never without the server's own check.
    const redo =
      item.disposition === 'no_action' &&
      ask.disposition === 'reply_mike' &&
      ask.decided_by !== null &&
      (MACHINE_DECIDERS as readonly string[]).includes(ask.decided_by) &&
      floorExemptHolds({ is_urgent: ask.is_urgent, intent: ask.intent, exempt: exemptFacts });
    if (!redo) return out('leave', null, 'already_decided');
    if (ask.task_security) return out('leave', null, 'security_task');
    return out('close', 'no_action', 'provider_receipt_redecided');
  }
  if (ask.decided_by === 'mike') return out('leave', null, 'held_by_mike');
  const floored = applyFloors(item.disposition, { is_urgent: ask.is_urgent, intent: ask.intent, exempt: exemptFacts });
  const d = floored.disposition;
  if (d === 'no_action') {
    if (ask.task_security) return out('leave', null, 'security_task');
    return out('close', 'no_action', floored.exempted ? 'provider_receipt' : null);
  }
  if (d === 'waiting_them') return out('leave', null, 'waiting_not_applied');
  if (d === 'work') return ask.task_id ? out('set', 'work', null) : out('leave', null, 'work_without_task');
  return out('set', d, floored.adjusted);
}

// ----------------------------------------------------------------------------
// The email-sync decision: what a posted disposition does to a new or existing row
// ----------------------------------------------------------------------------

export interface SyncExisting {
  disposition: string | null;
  decided_by: string | null;
  intent: string | null;
  task_id: string | null;
  state: string;
  closed_by: string | null;
  is_urgent: boolean;
  /** The owner word of the linked task's assignee, when the row is linked. */
  task_owner?: DecisionOwner | null;
}

export interface SyncPosted {
  disposition: Disposition;
  reason: string | null;
  owner?: DecisionOwner | null;
  is_urgent: boolean;
  intent: string | null;
  /** The posted claim and the mail facts the server checks it against (a new row only; see planSync). */
  floor_exempt?: FloorExempt | null;
  subject?: string | null;
  from_email?: string | null;
  gist?: string | null;
}

export interface SyncPlan {
  /** The value after the floors (what is stored on a new row, or on an old one that takes a value). Null when nothing is stored. */
  disposition: Disposition | null;
  /** Columns to write (create: all; update: only these). Empty when nothing is written. */
  fields: Record<string, unknown>;
  /** A birth close: the row is created handled; waiting_them also opens a wait. */
  birth: BirthState | null;
  /** An update that reopens an intake close because the ask is now urgent. */
  reopen: boolean;
  adjusted: string | null;
  /** Set when a verified provider receipt was recorded as handled although its intent is admin. */
  exempted?: FloorExempt;
  prior: { disposition: string | null; task_id: string | null } | null;
}

/**
 * ONE function for the sync's rules. A new row takes the decision (floors applied) and the birth state. An existing row is never
 * closed by a later sync: it takes a value only when it has none and Mike has not decided it, and never no_action or waiting_them
 * (those are only a birth). An existing intake close that turns urgent reopens as an emergency (the floors only raise).
 */
export function planSync(existing: SyncExisting | null, posted: SyncPosted): SyncPlan {
  const floor = applyFloors(posted.disposition, {
    is_urgent: posted.is_urgent,
    intent: posted.intent ?? existing?.intent ?? null,
    exempt: { kind: posted.floor_exempt, subject: posted.subject, from_email: posted.from_email, gist: posted.gist },
  });
  const d = floor.disposition;
  const reason = cleanReason(posted.reason);
  const owner = ownerFor(d, existing?.task_owner ?? null) ?? posted.owner ?? null;
  const base = { disposition: d, disposition_reason: reason, owner, decided_by: 'intake' };

  if (!existing) {
    const birth = birthState(d);
    const fields: Record<string, unknown> = { ...base };
    if (birth.state === 'handled') {
      fields.state = 'handled';
      fields.closed_reason = birth.closed_reason;
      fields.closed_by = birth.closed_by;
    }
    return { disposition: d, fields, birth, reopen: false, adjusted: floor.adjusted, ...(floor.exempted ? { exempted: floor.exempted } : {}), prior: null };
  }

  const prior = { disposition: existing.disposition, task_id: existing.task_id };
  const none = (adjusted: string | null): SyncPlan => ({ disposition: null, fields: {}, birth: null, reopen: false, adjusted, prior });
  if (posted.is_urgent && existing.state === 'handled' && existing.closed_by === 'intake' && existing.decided_by !== 'mike') {
    return {
      disposition: 'emergency',
      fields: { state: 'open', disposition: 'emergency', disposition_reason: reason, owner: 'mike', decided_by: 'intake', closed_at: null, closed_reason: null, closed_by: null },
      birth: null,
      reopen: true,
      adjusted: 'reopened_urgent',
      prior,
    };
  }
  if (existing.decided_by === 'mike') return none('held_by_mike');
  if (existing.disposition !== null) return none(null);
  if (d === 'no_action' || d === 'waiting_them') return none('close_only_at_birth');
  if (d === 'work' && !existing.task_id) return none('work_without_task');
  return { disposition: d, fields: base, birth: null, reopen: false, adjusted: floor.adjusted, prior };
}
