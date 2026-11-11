/**
 * Home Slice 9a: the match basis, recomputed by Citadel from its own records (the machine's opinion is never trusted).
 * Pure: the caller loads the facts. Rule 4:
 *   thread:   the task's source_ref is an RFC id in the thread's set, or an EmailAsk with this task sits on the thread,
 *             or origin_url names the thread.
 *   client + subject: a recipient is a contact of the task's client, or a recipient's domain is a site domain of that
 *             client, AND the subject and new text share at least 2 distinctive tokens with the task title (0.3 overlap).
 *   site + subject:   a site domain of the task appears in the new text, with the same overlap.
 */

export type Basis = 'thread' | 'client' | 'site' | 'subject';

/** Words that carry no meaning for a match. */
export const STOP_WORDS: ReadonlySet<string> = new Set(
  (
    'a an and are as at be but by can do does for from had has have he her his how i if in into is it its just me my no not of on or our ' +
    'out please so than that the their them then there these they this to up us was we were what when which who will with you your ' +
    're fwd fw new old get got set add make made fix fixed work works working task thing things site website page pages ' +
    'monday tuesday wednesday thursday friday saturday sunday hello thanks thank regards best hi hey'
  ).split(/\s+/)
);

/** Distinctive tokens: lowercase words of 3 or more letters or digits, not in the stop list, each once. */
export function tokens(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const w of text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []) {
    if (STOP_WORDS.has(w) || seen.has(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return out;
}

export const MIN_SHARED_TOKENS = 2;
export const MIN_OVERLAP = 0.3;

/** Shared tokens between the title and the message text, and the overlap (shared over the title's distinctive tokens). */
export function titleOverlap(title: string, messageText: string): { shared: number; overlap: number } {
  const t = tokens(title);
  if (t.length === 0) return { shared: 0, overlap: 0 };
  const m = new Set(tokens(messageText));
  const shared = t.filter((w) => m.has(w)).length;
  return { shared, overlap: shared / t.length };
}

export function overlapOk(title: string, messageText: string): boolean {
  const o = titleOverlap(title, messageText);
  return o.shared >= MIN_SHARED_TOKENS && o.overlap >= MIN_OVERLAP;
}

export interface BasisTask {
  title: string;
  source_ref: string | null;
  origin_url: string | null;
  /** True when an EmailAsk with this task_id sits on the message's thread. */
  ask_on_thread: boolean;
  /** Domains of the task's own site and of its client's sites, lowercase. */
  site_domains: string[];
  /** Emails of the task's client's contacts, lowercase. */
  client_contact_emails: string[];
}

export interface BasisMessage {
  thread_ids: string[];
  /** Lowercase RFC ids of the thread (message ids). */
  rfc_ids: string[];
  /** Lowercase recipient emails. */
  recipients: string[];
  subject: string;
  new_part: string;
}

const domainOf = (email: string): string => (email.split('@')[1] ?? '').toLowerCase();

/** The basis that holds, or [] when none does. 'thread' stands alone; 'client' and 'site' always come with 'subject'. */
export function basisFor(task: BasisTask, msg: BasisMessage): Basis[] {
  const out: Basis[] = [];
  const rfc = new Set(msg.rfc_ids.map((x) => x.toLowerCase()));
  const ref = (task.source_ref ?? '').trim().replace(/^<|>$/g, '').toLowerCase();
  const origin = task.origin_url ?? '';
  const named = msg.thread_ids.some((id) => id.length >= 8 && origin.includes(id));
  if (task.ask_on_thread || (ref !== '' && (rfc.has(ref) || msg.thread_ids.includes(ref))) || named) out.push('thread');

  const text = `${msg.subject}\n${msg.new_part}`;
  const subjectOk = overlapOk(task.title, text);
  const contacts = new Set(task.client_contact_emails.map((e) => e.toLowerCase()));
  const sites = new Set(task.site_domains.map((d) => d.toLowerCase()));
  const clientHit = msg.recipients.some((r) => contacts.has(r.toLowerCase()) || sites.has(domainOf(r)));
  if (clientHit && subjectOk) out.push('client', 'subject');
  const lowText = text.toLowerCase();
  const siteHit = [...sites].some((d) => d !== '' && lowText.includes(d));
  if (siteHit && subjectOk) {
    out.push('site');
    if (!out.includes('subject')) out.push('subject');
  }
  return out;
}

/** True when the basis is enough to name the task a target. */
export function basisValid(basis: readonly Basis[]): boolean {
  return basis.includes('thread') || ((basis.includes('client') || basis.includes('site')) && basis.includes('subject'));
}
