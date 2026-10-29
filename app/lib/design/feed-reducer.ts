/**
 * Designer Portal: the browser-side feed reducer (design 7.1 feed, 8.9 event kinds).
 *
 * Pure. A page of events merges into a state keyed by seq: a repeated page never duplicates, a page that arrives
 * late or out of order never drops anything, and the timeline is always derived from the sorted set, so the
 * order of arrival does not matter. Payload shapes per kind (see 8.9; read defensively, the worker owns them):
 *   text {text} | thought {text} | action {tool, label, args_summary, tool_use_id?} | result {tool, ok, summary, duration_ms, tool_use_id?}
 *   screenshot {asset_ids[], widths[], purpose} | gate {gates:[{name, ok, summary, log_asset_id?}], blocking}
 *   cost {turn_usd, total_usd, budget_usd} | plan {items:[{text, status}]} (replaced whole) | status {text|message|summary}
 *   followup {task_id, title} | client_files {folder_id, items[]} | change {change_id} | publish {publish_id, kind, status, summary}
 */

export interface FeedEvent {
  seq: number;
  role: string;
  kind: string;
  payload: unknown;
  created_at: string;
}

export type PlanStatus = 'pending' | 'in_progress' | 'completed' | 'canceled';
export interface PlanItem {
  text: string;
  status: PlanStatus;
}
export interface TurnCost {
  turn_usd: number;
  total_usd: number;
  budget_usd: number | null;
}

export interface FeedState {
  /** Sorted by seq, unique by seq. */
  events: FeedEvent[];
  /** Highest seq seen: the cursor for the next page. */
  cursor: number;
  plan: PlanItem[] | null;
  planSeq: number;
  lastTurn: TurnCost | null;
  lastTurnSeq: number;
  clientFilesCount: number | null;
  clientFilesSeq: number;
}

export const initialFeedState: FeedState = {
  events: [],
  cursor: 0,
  plan: null,
  planSeq: 0,
  lastTurn: null,
  lastTurnSeq: 0,
  clientFilesCount: null,
  clientFilesSeq: 0,
};

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const numOf = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

const PLAN_STATUSES: readonly string[] = ['pending', 'in_progress', 'completed', 'canceled'];

export function parsePlan(payload: unknown): PlanItem[] {
  const items = rec(payload).items;
  if (!Array.isArray(items)) return [];
  return items.flatMap((raw) => {
    const r = rec(raw);
    const text = str(r.text) ?? str(r.content);
    if (!text) return [];
    const status = PLAN_STATUSES.includes(String(r.status)) ? (r.status as PlanStatus) : 'pending';
    return [{ text, status }];
  });
}

export function parseCost(payload: unknown): TurnCost | null {
  const r = rec(payload);
  const turn = numOf(r.turn_usd);
  const total = numOf(r.total_usd);
  if (turn === null && total === null) return null;
  return { turn_usd: turn ?? 0, total_usd: total ?? 0, budget_usd: numOf(r.budget_usd) };
}

/** Merge one page. Returns the same state object when the page adds nothing. */
export function mergeFeedPage(state: FeedState, page: readonly FeedEvent[]): FeedState {
  if (page.length === 0) return state;
  const known = new Set(state.events.map((e) => e.seq));
  const fresh: FeedEvent[] = [];
  for (const e of page) {
    if (!Number.isInteger(e.seq) || e.seq <= 0 || known.has(e.seq)) continue;
    known.add(e.seq);
    fresh.push(e);
  }
  if (fresh.length === 0) return state;

  const next: FeedState = { ...state, events: [...state.events, ...fresh].sort((a, b) => a.seq - b.seq) };
  next.cursor = Math.max(state.cursor, ...fresh.map((e) => e.seq));
  // Latest-by-seq wins for these, whatever order the pages arrived in.
  for (const e of fresh) {
    if (e.kind === 'plan' && e.seq > next.planSeq) {
      next.plan = parsePlan(e.payload);
      next.planSeq = e.seq;
    } else if (e.kind === 'cost' && e.seq > next.lastTurnSeq) {
      const c = parseCost(e.payload);
      if (c) {
        next.lastTurn = c;
        next.lastTurnSeq = e.seq;
      }
    } else if (e.kind === 'client_files' && e.seq > next.clientFilesSeq) {
      const items = rec(e.payload).items;
      next.clientFilesCount = Array.isArray(items) ? items.length : 0;
      next.clientFilesSeq = e.seq;
    }
  }
  return next;
}

// ---------------------------------------------------------------------------------------------------------
// Labels: "Searching the web" -> "Searched the web"
// ---------------------------------------------------------------------------------------------------------

const IRREGULAR: Record<string, string> = {
  reading: 'Read', writing: 'Wrote', running: 'Ran', taking: 'Took', making: 'Made', getting: 'Got', finding: 'Found', setting: 'Set',
  building: 'Built', sending: 'Sent', opening: 'Opened', editing: 'Edited', listing: 'Listed', adding: 'Added', updating: 'Updated',
  creating: 'Created', saving: 'Saved', recording: 'Recorded', fixing: 'Fixed', loading: 'Loaded',
};

/** Past tense of a leading "-ing" word; a label that does not start with one is returned unchanged. */
export function pastTenseLabel(label: string): string {
  const m = /^([A-Za-z]+ing)\b([\s\S]*)$/.exec(label.trim());
  if (!m) return label.trim();
  const lower = m[1].toLowerCase();
  let past = IRREGULAR[lower];
  if (!past) {
    const stem = m[1].slice(0, -3);
    if (stem.length < 2) return label.trim();
    past = stem + 'ed'; // the -ing form already doubles its consonant (Stopping -> Stopped)
    past = past[0].toUpperCase() + past.slice(1);
  }
  return past + m[2];
}

// ---------------------------------------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------------------------------------

export type ToolState = 'running' | 'ok' | 'failed';

export interface GateRow {
  name: string;
  ok: boolean;
  summary: string | null;
  log_asset_id: string | null;
}

export type TimelineItem =
  | { type: 'message'; seq: number; from: 'designer' | 'assistant'; text: string; created_at: string }
  | { type: 'thought'; seq: number; text: string; created_at: string }
  | { type: 'tool'; seq: number; tool: string; label: string; state: ToolState; summary: string | null; args_summary: string | null; duration_ms: number | null; created_at: string }
  | { type: 'screenshot'; seq: number; asset_ids: string[]; widths: number[]; purpose: string; created_at: string }
  | { type: 'gate'; seq: number; gates: GateRow[]; blocking: boolean; created_at: string }
  | { type: 'status'; seq: number; text: string; created_at: string }
  | { type: 'followup'; seq: number; task_id: string | null; title: string; created_at: string }
  | { type: 'publish'; seq: number; publish_id: string | null; kind: string; status: string; summary: string | null; created_at: string }
  | { type: 'client_files'; seq: number; count: number; created_at: string }
  | { type: 'apply'; seq: number; pins: number; note: string | null; created_at: string }
  | { type: 'change'; seq: number; change_id: string | null; created_at: string };

const toolKey = (payload: unknown): string | null => {
  const r = rec(payload);
  return str(r.tool_use_id) ?? str(r.tool_id) ?? str(r.id) ?? str(r.call_id);
};

/**
 * The visible timeline, derived from the sorted events. A `result` joins the `action` with the same tool-use id
 * (payload.tool_use_id, tool_id, id or call_id); with no id on either side it joins the oldest still-open action of
 * the same tool. A joined action reads in past tense; an unmatched action is "running"; an unmatched result shows
 * on its own. cost, plan are state, not rows.
 */
export function deriveTimeline(state: Pick<FeedState, 'events'>): TimelineItem[] {
  const items: TimelineItem[] = [];
  const openById = new Map<string, Extract<TimelineItem, { type: 'tool' }>>();
  const openByTool = new Map<string, Array<Extract<TimelineItem, { type: 'tool' }>>>();

  for (const e of state.events) {
    const p = rec(e.payload);
    const base = { seq: e.seq, created_at: e.created_at };
    switch (e.kind) {
      case 'text': {
        const text = str(p.text);
        if (text) items.push({ type: 'message', ...base, from: e.role === 'designer' ? 'designer' : 'assistant', text });
        break;
      }
      case 'thought': {
        const text = str(p.text);
        if (text) items.push({ type: 'thought', ...base, text });
        break;
      }
      case 'action': {
        const tool = str(p.tool) ?? 'tool';
        const item: Extract<TimelineItem, { type: 'tool' }> = {
          type: 'tool', ...base, tool, label: str(p.label) ?? tool, state: 'running', summary: null, args_summary: str(p.args_summary), duration_ms: null,
        };
        const id = toolKey(e.payload);
        if (id) openById.set(id, item);
        openByTool.set(tool, [...(openByTool.get(tool) ?? []), item]);
        items.push(item);
        break;
      }
      case 'result': {
        const tool = str(p.tool) ?? 'tool';
        const id = toolKey(e.payload);
        let target: Extract<TimelineItem, { type: 'tool' }> | undefined;
        if (id && openById.has(id)) target = openById.get(id);
        else if (!id) target = (openByTool.get(tool) ?? []).find((t) => t.state === 'running');
        if (target && target.state === 'running') {
          target.state = p.ok === false ? 'failed' : 'ok';
          target.label = pastTenseLabel(target.label);
          target.summary = str(p.summary);
          target.duration_ms = numOf(p.duration_ms);
        } else {
          items.push({
            type: 'tool', ...base, tool, label: tool, state: p.ok === false ? 'failed' : 'ok', summary: str(p.summary), args_summary: null, duration_ms: numOf(p.duration_ms),
          });
        }
        break;
      }
      case 'screenshot': {
        const ids = Array.isArray(p.asset_ids) ? p.asset_ids.filter((x): x is string => typeof x === 'string') : [];
        if (ids.length === 0) break;
        const widths = Array.isArray(p.widths) ? p.widths.filter((x): x is number => typeof x === 'number') : [];
        items.push({ type: 'screenshot', ...base, asset_ids: ids, widths, purpose: str(p.purpose) ?? 'after' });
        break;
      }
      case 'gate': {
        const gates = (Array.isArray(p.gates) ? p.gates : []).map((g): GateRow => {
          const r = rec(g);
          return { name: str(r.name) ?? 'gate', ok: r.ok === true, summary: str(r.summary), log_asset_id: str(r.log_asset_id) };
        });
        items.push({ type: 'gate', ...base, gates, blocking: p.blocking === true || gates.some((g) => !g.ok && p.blocking !== false) });
        break;
      }
      case 'status': {
        const text = str(p.text) ?? str(p.message) ?? str(p.summary) ?? str(p.status);
        if (text) items.push({ type: 'status', ...base, text });
        break;
      }
      case 'followup':
        items.push({ type: 'followup', ...base, task_id: str(p.task_id), title: str(p.title) ?? 'Follow-up task' });
        break;
      case 'publish':
        items.push({ type: 'publish', ...base, publish_id: str(p.publish_id), kind: str(p.kind) ?? 'publish', status: str(p.status) ?? 'queued', summary: str(p.summary) });
        break;
      case 'client_files': {
        items.push({ type: 'client_files', ...base, count: Array.isArray(p.items) ? p.items.length : 0 });
        break;
      }
      case 'apply': {
        const pins = Array.isArray(p.pins) ? p.pins.length : Array.isArray(p.pin_ids) ? p.pin_ids.length : 0;
        items.push({ type: 'apply', ...base, pins, note: str(p.note) });
        break;
      }
      case 'change':
        items.push({ type: 'change', ...base, change_id: str(p.change_id) });
        break;
      default:
        break; // cost, plan: state only
    }
  }
  return items;
}

// ---------------------------------------------------------------------------------------------------------
// Worker silence
// ---------------------------------------------------------------------------------------------------------

export const HEARTBEAT_STALE_MS = 30_000;
export const PENDING_SILENT_MS = 60_000;

/** True when the worker looks gone: heartbeat older than 30 s on a live session, or pending for more than 60 s. */
export function isWorkerSilent(input: { status: string; lastHeartbeatAt: string | null; pendingSinceMs?: number | null; now?: number }): boolean {
  const now = input.now ?? Date.now();
  if (input.status === 'pending' && input.pendingSinceMs != null && now - input.pendingSinceMs > PENDING_SILENT_MS) return true;
  if (input.status !== 'pending' && input.status !== 'active' && input.status !== 'awaiting_input') return false;
  const hb = input.lastHeartbeatAt ? Date.parse(input.lastHeartbeatAt) : NaN;
  if (!Number.isFinite(hb)) return input.status !== 'pending';
  return now - hb > HEARTBEAT_STALE_MS;
}
