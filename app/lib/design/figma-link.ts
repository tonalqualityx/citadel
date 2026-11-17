/**
 * A pasted Figma link, read without fetching anything (the runner holds the Figma key, Citadel never does).
 * The host is matched exactly on the parsed URL; the file key and node id are checked with strict patterns, and only
 * those two values survive into the canonical link, so nothing else from the pasted text is stored.
 */
import { ApiError } from '@/lib/api/errors';

const FIGMA_HOSTS = new Set(['figma.com', 'www.figma.com']);
// A long file name in another script is percent-encoded to three or more times its length.
const MAX_LINK_LENGTH = 2000;
// One optional trailing segment is the file's display name; anything deeper (branches, FigJam boards) is refused.
const PATH = /^\/(?:design|file|proto)\/([A-Za-z0-9]{10,64})(?:\/[^/]*)?\/?$/;
const NODE_ID = /^(\d{1,10})[-:](\d{1,10})$/;

export interface FigmaLink { file_key: string; node_id: string | null; canonical_url: string }

const bad = () => new ApiError(
  'That Figma link does not point at a design file. In Figma, right-click a frame, choose Copy link, and paste that.', 400, 'bad_figma_link',
);

function hostOf(raw: string): string | null {
  try {
    const h = new URL(raw.trim()).hostname.toLowerCase();
    return h.endsWith('.') ? h.slice(0, -1) : h;
  } catch {
    return null;
  }
}

/** True when the link's host is exactly figma.com or www.figma.com (never a substring or suffix test). */
export function isFigmaHost(url: string): boolean {
  const h = hostOf(url);
  return h !== null && FIGMA_HOSTS.has(h);
}

/** Throws 400 `bad_figma_link` for anything that is not an https design, file or prototype link on a Figma host. */
export function parseFigmaLink(raw: string): FigmaLink {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (text.length === 0 || text.length > MAX_LINK_LENGTH) throw bad();
  let u: URL;
  try {
    u = new URL(text);
  } catch {
    throw bad();
  }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443') || !isFigmaHost(text)) throw bad();
  const m = PATH.exec(u.pathname);
  if (!m) throw bad();
  let node_id: string | null = null;
  const rawNode = u.searchParams.get('node-id');
  if (rawNode !== null) {
    const n = NODE_ID.exec(rawNode);
    if (!n) throw bad();
    node_id = `${n[1]}:${n[2]}`;
  }
  const canonical_url = `https://www.figma.com/design/${m[1]}${node_id ? `?node-id=${n2q(node_id)}` : ''}`;
  return { file_key: m[1], node_id, canonical_url };
}

const n2q = (id: string) => id.replace(':', '-');
