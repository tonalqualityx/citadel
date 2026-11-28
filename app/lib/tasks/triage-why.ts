/**
 * The why of a Triage card: what the work is for and what it lets us do. Release is refused until the card has one.
 *
 * Mike, 2026-11-28, front session chat: "We need to also update our processes (not memory!) so that a triage card cannot be released
 * without a clear why." and, correcting Bast: "No, it's not filing a triage card without a why - it's just releasing it. The idea can be
 * captured with nothing more than a sentence. But it must be refined to the point where it at least has a clear why before being released."
 * (task d6f69f0c). Filing stays open; only Release checks this.
 *
 * A card has a why when its description carries a labelled why line ("Why it matters: ...", the label create-task.py --why writes, or any
 * "Why ...:" label of a few words) with at least MIN_WHY_WORDS words after it, on the same line or the lines just below the label. Whether the
 * why is clear is a person's call; this only checks that one was written. Pure: no database.
 */
import { linesOf } from './project-brief';

export const MIN_WHY_WORDS = 3;

/** A why label: "Why it matters:", "Why:", "Why it's needed:", at most 30 characters before the colon. */
const WHY_LABEL = /^\**\s*why\b[^:]{0,30}:\s*\**\s*(.*)$/i;
/** Any other labelled line of a card ends the why ("Context:", "Done when:", ...). */
const OTHER_LABEL = /^\**\s*(What['’]s wanted|Done when|Context|Where to look|Out of scope|Related skill|Links|Ask|Source|Attachments|Finalized by)\b[^:]*:/i;

const words = (s: string) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

/** The card's why, or null when it has none of at least MIN_WHY_WORDS words. */
export function whyOf(description: string | null | undefined): string | null {
  const lines = linesOf(description);
  for (let i = 0; i < lines.length; i++) {
    const m = WHY_LABEL.exec(lines[i].text);
    if (!m) continue;
    const parts = [m[1].trim()];
    // "Why it matters:" alone on its line, the why in the paragraph below it.
    for (let j = i + 1; j < lines.length && parts.join(' ').trim() === ''; j++) {
      if (OTHER_LABEL.test(lines[j].text) || WHY_LABEL.test(lines[j].text)) break;
      parts.push(lines[j].text);
    }
    const why = parts.join(' ').trim();
    if (words(why) >= MIN_WHY_WORDS) return why;
  }
  return null;
}

export function hasWhy(description: string | null | undefined): boolean {
  return whyOf(description) !== null;
}
