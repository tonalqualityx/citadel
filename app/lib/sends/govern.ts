/**
 * The governing record of a send (Fleet item 4). Every message that can leave the building carries a
 * `govern` block saying which fact it reports. Right before the send, `recheckSend` (recheck.ts) reads
 * that fact again and drops the send when the state made it wrong.
 */
export type GovernIntent =
  | 'approval_request'
  | 'approval_mail'
  | 'golive'
  | 'magic_link'
  | 'invite'
  | 'proposal'
  | 'contract'
  | 'chat'
  | 'notice_internal'
  | 'owed_reply'
  | 'none';

/** The outbox `kind` of "Send the draft" (Home Slice 4b). Rows of this kind are made only by lib/home/owed/send.ts. */
export const OWED_REPLY_KIND = 'owed_reply';

export type Govern =
  /** `snapshot.claimed` is true when the producer holds the preview claim (or is an explicit staff resend). */
  | { intent: 'approval_request'; task_id: string; snapshot: { preview_url: string | null; claimed?: boolean; holder?: string } }
  | { intent: 'approval_mail'; task_id: string; approval_request_id?: string }
  /**
   * `snapshot.claimed` is true when the producer already took the go-live-notified claim for this row.
   * `snapshot.before_live` is true for a worker's own note sent before it calls /live: the task is then
   * approved but not yet done, which is the right state for that note.
   */
  | { intent: 'golive'; task_id: string; snapshot?: { claimed?: boolean; before_live?: boolean; holder?: string } }
  | { intent: 'magic_link' | 'invite'; snapshot: { expires_at: string } }
  | { intent: 'proposal'; proposal_id: string }
  | { intent: 'contract'; contract_id: string }
  /** `staff` marks a message a person wrote; it still goes after the conversation is closed. */
  | { intent: 'chat'; task_id: string; snapshot?: { staff?: boolean } }
  | { intent: 'notice_internal'; task_id: string }
  /**
   * Home Slice 4b: Mike's own press on "Send the draft". `home_action_id` is the home_actions row of that press (the claim route
   * reads it again), `user_id` is whose press it was, `ask_ids` are the open mails it answers.
   */
  | { intent: 'owed_reply'; home_action_id: string; user_id: string; ask_ids: string[]; account: string; thread_id: string; draft_id: string }
  | { intent: 'none'; reason: string };

const INTENTS: readonly string[] = ['approval_request', 'approval_mail', 'golive', 'magic_link', 'invite', 'proposal', 'contract', 'chat', 'notice_internal', 'owed_reply', 'none'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

/** Validate an untrusted govern block (API body or a stored JSON value). Returns null when it is not usable. */
export function parseGovern(raw: unknown): Govern | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const g = raw as Record<string, unknown>;
  const intent = g.intent;
  if (typeof intent !== 'string' || !INTENTS.includes(intent)) return null;
  const snap = g.snapshot && typeof g.snapshot === 'object' ? (g.snapshot as Record<string, unknown>) : {};
  switch (intent) {
    case 'approval_request':
      if (!isUuid(g.task_id)) return null;
      return { intent, task_id: g.task_id, snapshot: { preview_url: typeof snap.preview_url === 'string' ? snap.preview_url : null, claimed: snap.claimed === true, ...(typeof snap.holder === 'string' ? { holder: snap.holder } : {}) } };
    case 'approval_mail':
      if (!isUuid(g.task_id)) return null;
      return { intent, task_id: g.task_id, ...(isUuid(g.approval_request_id) ? { approval_request_id: g.approval_request_id } : {}) };
    case 'golive':
      if (!isUuid(g.task_id)) return null;
      return { intent, task_id: g.task_id, snapshot: { claimed: snap.claimed === true, before_live: snap.before_live === true, ...(typeof snap.holder === 'string' ? { holder: snap.holder } : {}) } };
    case 'magic_link':
    case 'invite':
      if (typeof snap.expires_at !== 'string' || Number.isNaN(Date.parse(snap.expires_at))) return null;
      return { intent, snapshot: { expires_at: snap.expires_at } };
    case 'proposal':
      return isUuid(g.proposal_id) ? { intent, proposal_id: g.proposal_id } : null;
    case 'contract':
      return isUuid(g.contract_id) ? { intent, contract_id: g.contract_id } : null;
    case 'chat':
      return isUuid(g.task_id) ? { intent, task_id: g.task_id, ...(snap.staff === true ? { snapshot: { staff: true } } : {}) } : null;
    case 'notice_internal':
      return isUuid(g.task_id) ? { intent, task_id: g.task_id } : null;
    case 'owed_reply': {
      const ids = Array.isArray(g.ask_ids) ? g.ask_ids : [];
      if (!isUuid(g.home_action_id) || !isUuid(g.user_id) || ids.length === 0 || ids.length > 50 || !ids.every(isUuid)) return null;
      if (typeof g.account !== 'string' || !g.account || typeof g.thread_id !== 'string' || !g.thread_id || typeof g.draft_id !== 'string' || !g.draft_id) return null;
      return { intent, home_action_id: g.home_action_id, user_id: g.user_id, ask_ids: ids as string[], account: g.account, thread_id: g.thread_id, draft_id: g.draft_id };
    }
    case 'none':
      return typeof g.reason === 'string' && g.reason.trim() ? { intent, reason: g.reason.trim().slice(0, 200) } : null;
    default:
      return null;
  }
}

/** The task a govern block is about, when it has one. */
export function governTaskId(g: Govern): string | null {
  return 'task_id' in g ? g.task_id : null;
}
