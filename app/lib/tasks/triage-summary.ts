/**
 * The one line of substance a Triage row shows: the card's "what's wanted" sentence. The description is stored as BlockNote JSON
 * (create-task.py --triage writes "What's wanted: <text>" as the first paragraph; older shapes start with the what paragraph).
 * The home loader reads only the first few thousand characters of each description in SQL, so hundreds of rows never load whole
 * bodies, and this file pulls the first block's text out of that head. Pure: no database.
 */

export const SUMMARY_HEAD_CHARS = 3000;
export const SUMMARY_MAX = 220;
const TEXT_RE = /"text"\s*:\s*("(?:[^"\\]|\\.)*")/g;

export function summaryFromHead(head: string | null | undefined): string {
  if (typeof head !== 'string' || head.trim() === '') return '';
  let text = '';
  if (head.trimStart().startsWith('[')) {
    // Only the first block: its text runs until its own "children" key (or the end of the head when it was cut).
    const cut = head.indexOf('"children"');
    const first = cut >= 0 ? head.slice(0, cut) : head;
    for (const m of first.matchAll(TEXT_RE)) {
      try {
        text += JSON.parse(m[1]) as string;
      } catch {
        // a string cut in the middle ends the line
        break;
      }
    }
  } else {
    text = head.split('\n')[0] ?? '';
  }
  text = text.replace(/\s+/g, ' ').trim().replace(/^What['’]s wanted:\s*/i, '');
  return text.length > SUMMARY_MAX ? `${text.slice(0, SUMMARY_MAX - 1).trimEnd()}…` : text;
}
