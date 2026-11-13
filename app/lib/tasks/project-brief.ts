/**
 * A project card describes the PROJECT (what the end result is, why it matters, when it is done), never the setting up. When the card's work is
 * finished (the card moves to done while linked to its project), its what / why / done-when become the project's own description, so every worker
 * reads the why of the project and the Plan tab shows it at the top.
 *
 * The copy is marked: its first paragraph is BRIEF_MARKER. A project whose description is empty, or whose description starts with the marker (so it
 * was written by this same copy), takes the card's text; a description a person wrote is never overwritten. Pure helpers plus one database step.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { serializeRichText, type BlockNoteBlock } from '@/lib/api/blocknote';

type Db = PrismaClient | Prisma.TransactionClient;

export const BRIEF_MARKER = 'From the Triage card:';

export interface CardBrief {
  what: string;
  why: string;
  done_when: string[];
}

interface Block {
  type?: string;
  content?: unknown;
}

function inlineText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((c) => {
      const o = c as { type?: string; text?: string; content?: unknown };
      if (o && o.type === 'link') return inlineText(o.content);
      return typeof o?.text === 'string' ? o.text : '';
    })
    .join('');
}

/** A stored description (a JSON string of BlockNote blocks, or plain text) as lines: [type, text]. */
function linesOf(raw: string | null | undefined): { type: string; text: string }[] {
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  if (Array.isArray(parsed)) {
    return (parsed as Block[]).map((b) => ({ type: typeof b?.type === 'string' ? b.type : 'paragraph', text: inlineText(b?.content).trim() })).filter((l) => l.text !== '');
  }
  return raw.split(/\r?\n/).map((t) => t.trim()).filter(Boolean).map((t) => (/^[-*•]\s+/.test(t) ? { type: 'bulletListItem', text: t.replace(/^[-*•]\s+/, '') } : { type: 'paragraph', text: t }));
}

/** The card's What's wanted, Why it matters and Done when, from its description. null when it has none of the three. */
export function briefFromCard(description: string | null | undefined): CardBrief | null {
  const out: CardBrief = { what: '', why: '', done_when: [] };
  let inDone = false;
  for (const l of linesOf(description)) {
    const t = l.text;
    const labelled = /^(What['’]s wanted|Why it matters|Done when|Context|Where to look|Out of scope|Related skill or shape|Links|Ask|Source|Attachments)\b[^:]*:\s*(.*)$/i.exec(t);
    if (labelled) {
      const key = labelled[1].toLowerCase();
      inDone = key === 'done when';
      if (key.startsWith('what')) out.what = labelled[2];
      else if (key === 'why it matters') out.why = labelled[2];
      else if (inDone && labelled[2]) out.done_when.push(labelled[2]);
      continue;
    }
    if (inDone && l.type === 'bulletListItem') out.done_when.push(t);
    else inDone = false;
  }
  return out.what || out.why || out.done_when.length ? out : null;
}

const para = (text: string): BlockNoteBlock => ({ id: crypto.randomUUID(), type: 'paragraph', content: [{ type: 'text', text, styles: {} }] });
const bullet = (text: string): BlockNoteBlock => ({ id: crypto.randomUUID(), type: 'bulletListItem', content: [{ type: 'text', text, styles: {} }] });

/** The project description this brief becomes: the marker line, then the three parts. */
export function briefBlocks(b: CardBrief): BlockNoteBlock[] {
  const blocks: BlockNoteBlock[] = [para(BRIEF_MARKER)];
  if (b.what) blocks.push(para(`What this project is: ${b.what}`));
  if (b.why) blocks.push(para(`Why it matters: ${b.why}`));
  if (b.done_when.length) {
    blocks.push(para('Done when:'));
    for (const d of b.done_when) blocks.push(bullet(d));
  }
  return blocks;
}

/** A description this copy may replace: none, or one that starts with the marker. */
export function mayReplaceDescription(description: string | null | undefined): boolean {
  const lines = linesOf(description);
  if (lines.length === 0) return true;
  return lines[0].text === BRIEF_MARKER;
}

/** A project description as plain lines for the Plan tab (the marker line dropped), or null when empty. */
export function descriptionLines(description: string | null | undefined): string[] | null {
  const lines = linesOf(description).filter((l, i) => !(i === 0 && l.text === BRIEF_MARKER));
  return lines.length ? lines.map((l) => (l.type === 'bulletListItem' ? `• ${l.text}` : l.text)) : null;
}

/**
 * The card is done: copy its brief into the project's description when that is empty or was written by this copy. Returns true when it wrote.
 * Only a project card (kind project_setup) linked to a project.
 */
export async function carryCardIntoProject(db: Db, taskId: string): Promise<boolean> {
  const card = await db.task.findUnique({ where: { id: taskId }, select: { triage_kind: true, project_id: true, description: true } });
  if (!card || card.triage_kind !== 'project_setup' || !card.project_id) return false;
  const brief = briefFromCard(card.description);
  if (!brief) return false;
  const project = await db.project.findFirst({ where: { id: card.project_id, is_deleted: false }, select: { description: true } });
  if (!project || !mayReplaceDescription(project.description)) return false;
  await db.project.update({ where: { id: card.project_id }, data: { description: serializeRichText(briefBlocks(brief)) } });
  return true;
}
