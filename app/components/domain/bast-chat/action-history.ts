import { undoOpen, type ActionOutcome, type ChatAction, type TimelineItem } from '@/lib/hooks/use-bast-chat';

/**
 * Where the chat's action results are shown. Nothing here changes how an action works: the feed still sends every
 * action as its own row and Undo, More, release and decline still go through the same handlers. This only decides
 * which tab a row is drawn in and how the quiet ones are summed up.
 */

/** A row that needs Mike where he reads: a failure, or a proposal still waiting for his tap. */
export function isPinned(action: ChatAction, outcome: ActionOutcome | null | undefined): boolean {
  if (action.status === 'failed') return true;
  if (action.status === 'proposed') return !(outcome === 'released' || outcome === 'declined');
  return false;
}

/** The item the Chat tab draws in place of a turn's finished actions. */
export interface ActionsSummaryItem {
  type: 'actions';
  key: string;
  /** The turn: the key of Mike's message that came before these actions, or 'start'. */
  turnKey: string;
  actions: ChatAction[];
}
export type ChatTabItem = TimelineItem | ActionsSummaryItem;

/**
 * The Chat tab's feed: the timeline with every finished, undoable or informational action taken out and one summary
 * item put at the end of its turn (after the turn's text). Failures and proposals waiting for a tap stay where they were.
 */
export function buildChatItems(timeline: TimelineItem[], outcomeOf: (id: string) => ActionOutcome | null): ChatTabItem[] {
  const out: ChatTabItem[] = [];
  let turnKey = 'start';
  let quiet: ChatAction[] = [];
  const flush = () => {
    if (quiet.length > 0) out.push({ type: 'actions', key: `sum-${turnKey}-${quiet[0].id}`, turnKey, actions: quiet });
    quiet = [];
  };
  for (const item of timeline) {
    if (item.type === 'message' && item.message.role === 'mike') {
      flush();
      turnKey = item.message.key;
    }
    if (item.type === 'action' && !isPinned(item.action, outcomeOf(item.action.id))) {
      quiet.push(item.action);
      continue;
    }
    out.push(item);
  }
  flush();
  return out;
}

export interface HistoryEntry {
  action: ChatAction;
  /** Position in the whole timeline: "Undo everything since here" counts from it, as it always did. */
  index: number;
  at: string | null;
}
export interface HistoryTurn {
  turnKey: string;
  /** Mike's words that started the turn, or null for actions with no message before them. */
  quote: string | null;
  /** Newest first. */
  entries: HistoryEntry[];
}

const QUOTE_CHARS = 90;
/** A short quote of Mike's message: one line, cut at a word where it can be. */
export function shortQuote(text: string, max = QUOTE_CHARS): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s.,;:]+$/, '')}...`;
}

/** The finished actions of the conversation grouped by turn, newest turn first and newest entry first. */
export function buildHistory(timeline: TimelineItem[], outcomeOf: (id: string) => ActionOutcome | null): HistoryTurn[] {
  const turns: HistoryTurn[] = [];
  let current: HistoryTurn | null = null;
  let turnKey = 'start';
  let quote: string | null = null;
  timeline.forEach((item, index) => {
    if (item.type === 'message' && item.message.role === 'mike') {
      turnKey = item.message.key;
      quote = shortQuote(item.message.text);
      current = null;
      return;
    }
    if (item.type !== 'action' || isPinned(item.action, outcomeOf(item.action.id))) return;
    if (!current) {
      current = { turnKey, quote, entries: [] };
      turns.push(current);
    }
    current.entries.push({ action: item.action, index, at: item.at ?? null });
  });
  for (const t of turns) t.entries.reverse();
  return turns.reverse();
}

/** How many finished actions can still be undone right now (window open, not already undone). */
export function undoableCount(timeline: TimelineItem[], outcomeOf: (id: string) => ActionOutcome | null, now: number): number {
  let n = 0;
  for (const item of timeline) {
    if (item.type !== 'action' || isPinned(item.action, outcomeOf(item.action.id))) continue;
    if (undoOpen(item.action, now)) n++;
  }
  return n;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The phrase for one kind of action, e.g. "added 2 notes". `who` is who a task went to, when the line says. */
function phrase(kind: string, n: number, who: string | null): string {
  switch (kind) {
    case 'note':
      return `added ${plural(n, 'note', 'notes')}`;
    case 'hid_note':
      return `hid ${plural(n, 'note', 'notes')}`;
    case 'gave':
      return `gave ${plural(n, 'task', 'tasks')} to ${who ?? 'someone'}`;
    case 'handed':
      return `handed ${plural(n, 'task', 'tasks')} to ${who ?? 'Bast'}`;
    case 'kept':
      return `kept ${plural(n, 'proposal', 'proposals')} as ${n === 1 ? 'it was' : 'they were'}`;
    case 'created':
      return `created ${plural(n, 'task', 'tasks')}`;
    case 'task':
      return `changed ${plural(n, 'task', 'tasks')}`;
    case 'today':
      return `changed today's list ${n === 1 ? 'once' : `${n} times`}`;
    case 'home':
      return `made ${plural(n, 'home screen change', 'home screen changes')}`;
    case 'email':
      return `closed ${plural(n, 'email card', 'email cards')}`;
    case 'project_started':
      return `started ${plural(n, 'project', 'projects')}`;
    case 'quote':
      return `started ${plural(n, 'quote', 'quotes')}`;
    case 'project':
      return `changed ${plural(n, 'project', 'projects')}`;
    case 'wait':
      return `changed ${plural(n, 'wait', 'waits')}`;
    default:
      return `made ${plural(n, 'other change', 'other changes')}`;
  }
}

function kindOf(a: ChatAction): { kind: string; who: string | null } {
  const gave = /^Gave .+ to ([^.]+)\.?$/.exec(a.summary.trim());
  switch (a.tool) {
    case 'comment_on_task':
      return { kind: /^Hid /.test(a.summary) ? 'hid_note' : 'note', who: null };
    case 'update_task':
      return gave ? { kind: 'gave', who: gave[1].trim() } : { kind: 'task', who: null };
    case 'create_task':
      return { kind: 'created', who: null };
    case 'add_to_arc':
    case 'remove_from_arc':
      return { kind: 'today', who: null };
    case 'home_change':
      return { kind: 'home', who: null };
    case 'propose_handoff':
      return a.status === 'declined' ? { kind: 'kept', who: null } : { kind: 'handed', who: a.proposed_assignee ?? null };
    case 'close_email_ask':
      return { kind: 'email', who: null };
    case 'start_project':
      return { kind: 'project_started', who: null };
    case 'start_quote':
      return { kind: 'quote', who: null };
    case 'change_project':
      return { kind: 'project', who: null };
    case 'change_wait':
      return { kind: 'wait', who: null };
    default:
      if (a.status === 'declined') return { kind: 'kept', who: null };
      if (a.status === 'released' && a.proposal_kind) return { kind: 'handed', who: a.proposed_assignee ?? null };
      return { kind: 'other', who: null };
  }
}

const MAX_PHRASES = 3;

/**
 * One quiet line for a turn's finished actions: "3 actions: added 2 notes, gave 1 task to Bast". Kinds come in the
 * order they first happened; past three kinds the rest are folded into "and N other".
 */
export function summarizeActions(actions: ChatAction[]): string {
  const groups: { id: string; kind: string; who: string | null; n: number }[] = [];
  for (const a of actions) {
    const { kind, who } = kindOf(a);
    const id = `${kind}|${who ?? ''}`;
    const g = groups.find((x) => x.id === id);
    if (g) g.n++;
    else groups.push({ id, kind, who, n: 1 });
  }
  const shown = groups.slice(0, MAX_PHRASES).map((g) => phrase(g.kind, g.n, g.who));
  const rest = groups.slice(MAX_PHRASES).reduce((n, g) => n + g.n, 0);
  if (rest > 0) shown.push(`and ${rest} other`);
  const undone = actions.filter((a) => a.status === 'undone').length;
  const tail = undone > 0 ? ` (${undone} undone)` : '';
  return `${plural(actions.length, 'action', 'actions')}: ${shown.join(', ')}${tail}`;
}
