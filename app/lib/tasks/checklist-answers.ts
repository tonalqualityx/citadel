/**
 * Pure helpers for the answers saved on a "Done when" item (no database): the comment text, how to read it back, and which
 * item the latest answer belongs to. The writer is lib/tasks/checklist.ts.
 */
export const ANSWER_MAX = 2000;
/** What the chat lane's comments start with (lib/bast-chat/worker-reads.ts CHAT_COMMENT_PREFIX). */
export const CHAT_ANSWER_PREFIX = 'From Mike, through the chat: ';

export function answerContent(itemText: string, answer: string): string {
  return `Answer on "${itemText}": ${answer}`;
}

/** Parse a comment as an answer: its item text and answer, or null. Tolerates the chat prefix. */
export function parseAnswer(content: string): { text: string; answer: string } | null {
  const body = content.startsWith(CHAT_ANSWER_PREFIX) ? content.slice(CHAT_ANSWER_PREFIX.length) : content;
  const m = /^Answer on "([\s\S]*?)": ([\s\S]+)$/.exec(body);
  return m ? { text: m[1], answer: m[2] } : null;
}

/** The latest answer per item, from a task's comments (newest last). Matches by item id when stored, else by item text. */
export function latestAnswers(
  items: { id?: string | null; text: string }[],
  comments: { content: string; chat_meta: unknown }[],
): Map<number, string> {
  const out = new Map<number, string>();
  for (const c of comments) {
    const p = parseAnswer(c.content);
    if (!p) continue;
    const meta = c.chat_meta && typeof c.chat_meta === 'object' ? (c.chat_meta as { checklist?: { item_id?: unknown } }).checklist : undefined;
    const metaId = typeof meta?.item_id === 'string' ? meta.item_id : null;
    let i = metaId ? items.findIndex((it) => it.id === metaId) : -1;
    if (i < 0) i = items.findIndex((it) => it.text.trim() === p.text.trim());
    if (i >= 0) out.set(i, p.answer);
  }
  return out;
}
