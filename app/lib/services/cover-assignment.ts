import { prisma } from '@/lib/db/prisma';
import { deterministicPoolCover } from '@/lib/utils/deterministic-cover';

// Clarity Phase 7 (Seeing Stone Reckoning) — server-side cover_url assignment. Called ONCE,
// at creation/backfill time, never per-render (a card render just reads the already-stored
// cover_url — see components/domain/oracle/CoverBand.tsx). Chain, per Mike's ruling:
//   (a) the item's client has a site with a real URL -> that site's og:image, fetched here,
//       server-side, with a short bounded timeout;
//   (b) else a deterministic pick from the bundled Unsplash pool (lib/utils/
//       deterministic-cover.ts), stable forever for the same item id;
//   (c) (NOT here) a generated-SVG fallback lives client-side in CoverBand, for the rare
//       case a stored URL fails to load at render time — never computed/stored by this
//       function.
// Deliberately fail-open: any error anywhere in the og:image attempt (network, timeout,
// malformed HTML, no client, no site, no og:image tag) falls through to (b), which is a
// pure hash — it cannot fail. Cover assignment must never be the reason a task/arc create
// request fails.

const OG_IMAGE_FETCH_TIMEOUT_MS = 3000;
const OG_IMAGE_MAX_BYTES = 300_000; // bounded read — never buffer an arbitrarily large page

const OG_IMAGE_RE =
  /<meta[^>]+(?:property|name)=["']og:image["'][^>]+content=["']([^"']+)["']|<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:image["']/i;

/** Fetches `siteUrl`'s HTML (bounded, short-timeout) and extracts its og:image meta tag,
 *  resolved to an absolute URL. Returns null on ANY failure — never throws. */
async function fetchOgImage(siteUrl: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OG_IMAGE_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(siteUrl, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CitadelCoverBot/1.0)' },
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('html')) return null;

    // Bounded read: stop consuming the body once we're past a reasonable HTML-head size —
    // og:image tags live in <head>, never need the whole document.
    const reader = res.body?.getReader();
    if (!reader) return null;
    let received = 0;
    let html = '';
    const decoder = new TextDecoder();
    while (received < OG_IMAGE_MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      html += decoder.decode(value, { stream: true });
      if (OG_IMAGE_RE.test(html)) break;
    }
    try {
      await reader.cancel();
    } catch {
      // best-effort only — a failed cancel never fails the whole lookup
    }

    const match = OG_IMAGE_RE.exec(html);
    const raw = match?.[1] ?? match?.[2];
    if (!raw) return null;
    return new URL(raw, siteUrl).toString();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// TODO(unsplash-api): when UNSPLASH_ACCESS_KEY is set in the environment, this is the slot
// for a real curated-photo lookup (e.g. Unsplash's search API keyed by a term derived from
// the client's industry/name) inserted BEFORE the deterministic pool fallback below. Never
// register/create the Unsplash application from an unattended pass — Mike's explicit
// tonight-scope limit (2026-07-27). This hook exists so wiring a real key later requires
// zero schema/UI changes, only filling in the branch guarded by the env check.
function unsplashApiConfigured(): boolean {
  return !!process.env.UNSPLASH_ACCESS_KEY;
}

export interface ResolveCoverUrlInput {
  /** The task/arc's own id — the stable hash key for the deterministic pool fallback. */
  itemId: string;
  clientId?: string | null;
}

/** Resolves the cover_url to store for a newly-created (or backfilled) task/arc. Never
 *  throws, never returns null/undefined — always resolves to SOME usable URL. */
export async function resolveCoverUrl({ itemId, clientId }: ResolveCoverUrlInput): Promise<string> {
  if (clientId) {
    try {
      const client = await prisma.client.findUnique({
        where: { id: clientId },
        select: { sites: { select: { url: true }, orderBy: { created_at: 'asc' }, take: 5 } },
      });
      const siteUrl = client?.sites.find((s) => s.url)?.url;
      if (siteUrl) {
        if (unsplashApiConfigured()) {
          // Not implemented tonight — see the TODO above. Falls through to og:image, then
          // the deterministic pool, exactly as if the key were unset.
        }
        const og = await fetchOgImage(siteUrl);
        if (og) return og;
      }
    } catch {
      // Any lookup failure (client not found, DB hiccup, etc.) — fall through silently.
    }
  }

  return deterministicPoolCover(itemId);
}
