// Clarity Phase 7 (Seeing Stone Reckoning) — card cover assignment, the pure/deterministic
// half. Kept dependency-free (no Prisma, no fetch) so it is safe to import from BOTH server
// code (lib/services/cover-assignment.ts, the backfill route) and client components
// (CoverBand's runtime onError fallback) without pulling server-only modules into the
// client bundle.
//
// Two distinct outputs, deliberately never confused:
//   - `deterministicPoolCover` picks one of the bundled Unsplash photos (see
//     public/covers/CREDITS.md for licensing + attribution) by a stable hash of the item's
//     id. This is what gets WRITTEN to cover_url at assignment time for any item whose
//     client has no resolvable og:image.
//   - `deterministicCoverDataUri` is a tiny generated SVG, muted two-tone, no text/photo
//     content at all. It is NEVER written to cover_url — it exists purely as CoverBand's
//     client-side onError fallback for the rare case a stored URL (an external client
//     og:image, or a pool file the deploy somehow dropped) fails to load in the browser.

/** Simple, fast, deterministic string hash (a 32-bit FNV-1a variant). Same input always
 *  produces the same output, forever — that stability IS the point: a card's cover must
 *  never change on its own between renders/deploys. Not cryptographic; doesn't need to be. */
export function stableHash(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

// Clarity Phase 7 — the bundled cover pool (public/covers/*.jpg). Downloaded directly from
// Unsplash's free CDN per photo (never bulk-scraped, never Unsplash+/premium — see
// CREDITS.md), resized to 800px wide at download time. Texture/abstract-only: no faces, no
// text, no recognizable brands — brand-neutral and low-stimulation per the
// universal-design-readability reference. Order is stable (append-only): inserting a new
// entry in the middle would reshuffle which existing items map to which cover on every
// future deploy — always add new pool entries at the END.
export const COVER_POOL: readonly string[] = [
  '/covers/concrete-texture-ingmar-v8o8Fvxxnto.jpg',
  '/covers/dust-noise-illia-horokhovsky-8dGkMS305rE.jpg',
  '/covers/grey-rock-immo-wegmann-uvKYxUxaAi4.jpg',
  '/covers/pastel-sky-scott-goodwill-A3u8Ugv1EAw.jpg',
  '/covers/wood-grain-zoshua-colah-UhSCrH3p4Go.jpg',
  '/covers/weathered-wood-kristaps-ungurs-9n5XxzP8OXE.jpg',
  '/covers/beige-fabric-safwan-thottoli-QFQ6vsou7XA.jpg',
  '/covers/beige-fabric-mary-skrynnikova-ZaSGVsHQqk.jpg',
  '/covers/green-leaf-stefan-steinbauer-YyWu19ab4M.jpg',
  '/covers/green-leaf-buddy-an-jm8GDQPAimc.jpg',
  '/covers/green-leaf-chuttersnap-xvr2ZA1f9pQ.jpg',
  '/covers/crumpled-paper-marjan-blan-VcOk8CeBU.jpg',
  '/covers/crumpled-paper-forest-s-Hve5GpgSxg.jpg',
  '/covers/sand-dune-untldshots-SUcsl2HpfbA.jpg',
];

/** Picks one bundled cover photo for this item, stable forever for the same id. */
export function deterministicPoolCover(itemId: string): string {
  const index = stableHash(itemId) % COVER_POOL.length;
  return COVER_POOL[index];
}

// A small, deliberately muted/low-saturation palette (slate/stone/neutral tones — nothing
// vibrant or attention-grabbing) for the generated-SVG runtime fallback. Never rendered
// behind text (see CoverBand) so this only ever needs to read as quiet texture, not carry
// meaning on its own.
const SVG_PALETTE: readonly [string, string][] = [
  ['#4b5563', '#6b7280'], // slate
  ['#57534e', '#78716c'], // stone
  ['#44403c', '#6d6862'], // warm gray
  ['#3f4451', '#5b6472'], // cool gray
  ['#52534a', '#75766a'], // olive-gray
  ['#4a4744', '#6b6560'], // taupe
];

/** A tiny, text-free, muted two-tone SVG data URI — CoverBand's last-resort runtime
 *  fallback when a stored cover_url (an external og:image, most likely) fails to load.
 *  Deterministic by id like the pool picker, so a broken image always resolves to the
 *  SAME generated texture rather than flickering between renders. Never persisted to
 *  cover_url — computed client-side only, on demand. */
export function deterministicCoverDataUri(itemId: string): string {
  const hash = stableHash(itemId);
  const [base, accent] = SVG_PALETTE[hash % SVG_PALETTE.length];
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='400' height='100'>` +
    `<rect width='400' height='100' fill='${base}'/>` +
    `<polygon points='0,100 400,0 400,45 0,100' fill='${accent}' opacity='0.45'/>` +
    `</svg>`;
  const base64 = typeof btoa === 'function' ? btoa(svg) : Buffer.from(svg, 'utf-8').toString('base64');
  return `data:image/svg+xml;base64,${base64}`;
}
