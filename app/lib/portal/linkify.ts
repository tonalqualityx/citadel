/**
 * Thread text is shown as plain text with http(s) links made clickable and nothing else treated as
 * HTML (portal phase B slice 2, spec 3.1). Pure, so the client component can import it.
 */
/** Split text into plain and http(s) link segments, so the page can link URLs and print nothing else as HTML. */
export function splitLinks(text: string): Array<{ text: string; href: string | null }> {
  const out: Array<{ text: string; href: string | null }> = [];
  const re = /https?:\/\/[^\s<>"']+/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    let url = m[0];
    // Trailing punctuation belongs to the sentence, not the link.
    const trail = url.match(/[.,;:!?)\]]+$/)?.[0] ?? '';
    if (trail) url = url.slice(0, -trail.length);
    if (m.index > last) out.push({ text: text.slice(last, m.index), href: null });
    out.push({ text: url, href: url });
    last = m.index + url.length;
    re.lastIndex = last;
  }
  if (last < text.length) out.push({ text: text.slice(last), href: null });
  return out;
}
