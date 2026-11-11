import type { HomeEverythingElseGroup, HomeItem, HomeResponse, HomeTile, HomeTileId } from '@/lib/home/types';
import { HANDLED_MAIL } from '@/lib/work/copy';
import type { OracleProjectCard } from '@/lib/hooks/use-oracle-projects';

/** Any em dash or en dash in text shown on this screen becomes ", " (display only). */
export function plain(text: string | null | undefined): string {
  if (!text) return '';
  return text.replace(/\s*[\u2013\u2014]\s*/g, ', ');
}

const LABELS: Record<Exclude<HomeTileId, 'today'>, { many: string; one: string }> = {
  needs_you_now: { many: 'need you now', one: 'needs you now' },
  working_on: { many: 'things in progress', one: 'thing in progress' },
  leads: { many: 'sales leads waiting', one: 'sales lead waiting' },
  mail: { many: 'client emails waiting', one: 'client email waiting' },
  next: { many: 'decisions ready', one: 'decision ready' },
  projects: { many: 'projects', one: 'project' },
  handled: { many: 'handled for you', one: 'handled for you' },
  everything_else: { many: 'everything else', one: 'everything else' },
};

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

export function todayLabel(quick: number, steps: number): string {
  const parts: string[] = [];
  if (quick > 0) parts.push(`${quick} quick`);
  if (steps > 0) parts.push(`${steps} ${plural(steps, 'step', 'steps')}`);
  return parts.length === 2 ? `${parts[0]}, then ${parts[1]}` : (parts[0] ?? '');
}

/** The tiles in the preview's order. Zero tiles render muted; only Needs you now can be hot. */
export function buildTiles(res: HomeResponse, projectCount: number | null): HomeTile[] {
  const t = res.today;
  const todayCount = t ? t.quick.length + t.steps.length : 0;
  const counts: Record<Exclude<HomeTileId, 'today'>, number> = {
    needs_you_now: res.sections.needs_you_now.length,
    working_on: res.sections.working_on.length,
    leads: res.sections.leads.length,
    mail: res.sections.mail.length,
    next: res.sections.next.length,
    projects: projectCount ?? 0,
    handled: res.sections.handled.length + (res.sections.handled_more?.count ?? 0),
    everything_else: res.everything_else.count,
  };
  const tiles: HomeTile[] = [
    {
      id: 'today',
      value: t ? `Today: ${plain(t.arc_name)}` : 'Today',
      label: t ? todayLabel(t.quick.length, t.steps.length) : '',
      count: todayCount,
      hot: false,
    },
  ];
  (Object.keys(LABELS) as Array<keyof typeof LABELS>).forEach((id) => {
    const n = counts[id];
    tiles.push({
      id,
      value: String(n),
      label: n === 1 ? LABELS[id].one : LABELS[id].many,
      count: n,
      hot: id === 'needs_you_now' && n > 0,
    });
  });
  return tiles;
}

/** The items behind a tile whose rows are real items (Today shows its own list). */
export function itemsForTile(res: HomeResponse, id: HomeTileId): HomeItem[] {
  switch (id) {
    case 'today':
      return res.today ? [...res.today.quick, ...res.today.steps] : [];
    case 'needs_you_now':
      return res.sections.needs_you_now;
    case 'working_on':
      return res.sections.working_on;
    case 'leads':
      return res.sections.leads;
    case 'mail':
      return res.sections.mail;
    case 'next':
      return res.sections.next;
    default:
      return [];
  }
}

export function isItemTile(id: HomeTileId): boolean {
  return id !== 'projects' && id !== 'handled' && id !== 'everything_else';
}

/** Every item in the payload, deduplicated by key, for lookups. */
export function allItems(res: HomeResponse): HomeItem[] {
  const seen = new Map<string, HomeItem>();
  const lists: HomeItem[][] = [
    res.today?.steps ?? [],
    res.today?.quick ?? [],
    res.sections.needs_you_now,
    res.sections.working_on,
    res.sections.leads,
    res.sections.mail,
    res.sections.next,
  ];
  for (const list of lists) for (const it of list) if (!seen.has(it.key)) seen.set(it.key, it);
  return [...seen.values()];
}

export function findItem(res: HomeResponse, key: string | null): HomeItem | null {
  if (!key) return null;
  return allItems(res).find((i) => i.key === key) ?? null;
}

/** The add box searches these first: every item in the payload that is not already a step. */
export function addCandidates(res: HomeResponse): HomeItem[] {
  const steps = new Set((res.today?.steps ?? []).map((s) => s.key));
  return allItems(res).filter((i) => !steps.has(i.key));
}

/** What opens in the card when a tile is picked: Today opens its first arc step. */
export function initialKey(res: HomeResponse, tile: HomeTileId): string | null {
  if (tile === 'today') {
    const t = res.today;
    if (!t) return null;
    return (t.steps[0] ?? t.quick[0])?.key ?? null;
  }
  if (isItemTile(tile)) return itemsForTile(res, tile)[0]?.key ?? null;
  return null;
}

/**
 * Keep the selection steady across a refetch. If the selected row is gone (Not now, Done),
 * open the row now at the same place, or the last one. Nothing else moves.
 */
export function resolveKey(keys: string[], selected: string | null, lastIndex: number): string | null {
  if (keys.length === 0) return null;
  if (selected && keys.includes(selected)) return selected;
  return keys[Math.min(Math.max(lastIndex, 0), keys.length - 1)];
}

/** One line standing in for the collapsed lists while an item is pinned. */
export function collapsedLine(res: HomeResponse, pinnedKey: string | null): string | null {
  const keys = new Set<string>();
  const lists: HomeItem[][] = [
    res.today?.quick ?? [],
    res.today?.steps ?? [],
    res.sections.needs_you_now,
    res.sections.leads,
    res.sections.mail,
    res.sections.next,
  ];
  for (const l of lists) for (const i of l) if (i.key !== pinnedKey) keys.add(i.key);
  const n = keys.size;
  if (n === 0) return null;
  return n === 1 ? "1 more is waiting. It'll keep." : `${n} more are waiting. They'll keep.`;
}

// ---------------------------------------------------------------- rows

export interface ListRow {
  key: string;
  title: string;
  meta: string;
  /** Muted gold rule on the row edge (needs you now). */
  rule: boolean;
}

export function rowsFromItems(items: HomeItem[]): ListRow[] {
  return items.map((i) => ({
    key: i.key,
    title: plain(i.title),
    meta: [i.who, i.age, i.owed_line, i.hard_date].filter(Boolean).map((s) => plain(s)).join('  ·  '),
    rule: i.type === 'emergency',
  }));
}

export interface DetailInfo {
  title: string;
  lines: string[];
  link?: { label: string; href: string };
  button?: { label: string; projectId: string };
  /** A keeper line's home_actions id: shows "Undo" on the card. */
  undoActionId?: string;
  /** Slice 9a, a note from his sent mail: the id "This was wrong" posts to /api/home/undo with wrong: true. */
  wrongActionId?: string;
  /** Slice 9a: "Log time? 30 min" on a task marked done from a card with no time on it. */
  timePrompt?: { task_id: string; minutes: number; day: string };
  /** Work stage B: `ask:<id>` of a mail recorded as handled: shows "Undo", which is the home act reopen_ask. */
  reopenKey?: string;
  /** Work stage B: the 30-day list "Mail recorded as handled": each row with Bast's reason and its own Undo. */
  mailList?: { key: string; title: string; reason: string; href: string | null; at: string }[];
}

/** The row key of the "Mail recorded as handled" list in the Handled tile. */
export const HANDLED_MAIL_KEY = 'handled-mail';

export function rowsFromHandled(res: HomeResponse): ListRow[] {
  const rows: ListRow[] = res.sections.handled.map((q) => ({ key: q.id, title: plain(q.text), meta: '', rule: false }));
  if (res.sections.handled_more) rows.push({ key: 'handled-more', title: plain(res.sections.handled_more.text), meta: '', rule: false });
  const mail = res.handled_mail ?? [];
  if (mail.length > 0) rows.push({ key: HANDLED_MAIL_KEY, title: `${HANDLED_MAIL.title} (${mail.length}). ${HANDLED_MAIL.showAll}`, meta: '', rule: false });
  return rows;
}

export function detailForHandled(res: HomeResponse, key: string | null): DetailInfo | null {
  if (!key) return null;
  if (key === 'handled-more' && res.sections.handled_more) {
    return { title: plain(res.sections.handled_more.text), lines: ['The system closed these itself. Nothing needs you.'] };
  }
  if (key === HANDLED_MAIL_KEY && (res.handled_mail ?? []).length > 0) {
    return {
      title: HANDLED_MAIL.title,
      lines: [HANDLED_MAIL.intro],
      mailList: (res.handled_mail ?? []).map((m) => ({ key: m.key, title: plain(m.title), reason: plain(m.reason), href: m.href, at: m.at })),
    };
  }
  const q = res.sections.handled.find((l) => l.id === key);
  if (!q) return null;
  // Work stage B: a mail recorded as handled at birth: one quiet line, Undo puts it back as a reply he owes.
  if (q.reopen_item_key) {
    return {
      title: plain(q.text),
      lines: ['Bast read this and decided no reply from you is needed. Undo puts it back as a reply you owe.', ...(q.details ?? []).map((d) => plain(d)).filter(Boolean)],
      link: q.href ? { label: 'Open the email', href: q.href } : undefined,
      reopenKey: q.reopen_item_key,
    };
  }
  const keeper = q.undo_action_id !== null && q.undo_action_id !== undefined;
  const details = (q.details ?? []).map((d) => plain(d)).filter(Boolean);
  // Slice 9a: a line from his sent mail (a note, or a card marked done).
  if (q.wrong_action_id || q.time_prompt) {
    return {
      title: plain(q.text),
      lines: [q.wrong_action_id ? 'Bast added this note from your sent mail. Undo hides it. Nothing is deleted.' : 'You marked this done from a card.', ...details],
      link: q.href ? { label: 'Open the email', href: q.href } : undefined,
      undoActionId: keeper ? (q.undo_action_id as string) : undefined,
      wrongActionId: q.wrong_action_id ?? undefined,
      timePrompt: q.time_prompt ?? undefined,
    };
  }
  return {
    title: plain(q.text),
    lines: [keeper ? 'The nightly sort did this for you. You can put it back.' : 'The system closed this itself. Nothing needs you.', ...details],
    link: q.href ? { label: 'Open the thread', href: q.href } : undefined,
    undoActionId: keeper ? (q.undo_action_id as string) : undefined,
  };
}

export function rowsFromRest(res: HomeResponse): ListRow[] {
  return res.everything_else.groups.map((g) => ({ key: g.key, title: `${g.count}  ${plain(g.label)}`, meta: '', rule: false }));
}

/** The two heading lines of the Everything else card, plus the scope line when there is one. */
export function restHeadingLines(res: HomeResponse): string[] {
  const e = res.everything_else;
  const n = e.count;
  const d = e.with_day;
  const first = `${n} other ${plural(n, 'item is', 'items are')} counted here. ${d} ${plural(d, 'has', 'have')} a day to come back.`;
  const second = e.past_day > 0 ? `${e.past_day} ${plural(e.past_day, 'is', 'are')} past their day.` : 'None is past its day.';
  const lines = [first, second];
  if (e.scope_line) lines.push(plain(e.scope_line));
  return lines;
}

export function restGroup(res: HomeResponse, key: string | null): HomeEverythingElseGroup | null {
  return res.everything_else.groups.find((x) => x.key === key) ?? null;
}

export function detailForRest(res: HomeResponse, key: string | null): DetailInfo | null {
  const g = res.everything_else.groups.find((x) => x.key === key);
  if (!g) return null;
  return {
    title: plain(g.label),
    lines: [`${g.count} ${plural(g.count, 'item', 'items')}`, `Held by: ${plain(g.owner)}`, plain(res.everything_else.line)],
  };
}

export function rowsFromProjects(projects: OracleProjectCard[]): ListRow[] {
  return projects.map((p) => ({ key: p.id, title: plain(p.name), meta: plain(p.client?.name), rule: false }));
}

export function detailForProject(projects: OracleProjectCard[], key: string | null): DetailInfo | null {
  const p = projects.find((x) => x.id === key);
  if (!p) return null;
  const lines = [plain(p.client?.name)];
  if (p.next_step?.text) lines.push(`Next step: ${plain(p.next_step.text)}`);
  return { title: plain(p.name), lines: lines.filter(Boolean), button: { label: 'Open the project', projectId: p.id } };
}
