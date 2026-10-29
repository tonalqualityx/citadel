// Designer Portal D7: the preview iframe's src is built only from session.preview_url plus a validated path.
// A path can never carry a host, scheme or protocol-relative prefix; the result must stay on the preview origin.

/** Resolve `input` against `previewUrl`. Returns a URL on the preview origin, or null when refused. */
export function resolvePreviewUrl(previewUrl: string | null | undefined, input: string | null | undefined): URL | null {
  if (!previewUrl) return null;
  let base: URL;
  try {
    base = new URL(previewUrl);
  } catch {
    return null;
  }
  if (base.protocol !== 'https:' && base.protocol !== 'http:') return null;
  if (input === null || input === undefined || input === '') return base;
  if (/[\u0000-\u001f\u007f\\]/.test(input) || input.length > 2000) return null;
  const path = input.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return null; // any scheme: https:, javascript:, data:, ...
  if (path.startsWith('//')) return null; // protocol-relative host
  const rooted = path.startsWith('/') || path.startsWith('?') || path.startsWith('#') ? path : `/${path}`;
  try {
    const url = new URL(rooted, new URL('/', base));
    return url.origin === base.origin ? url : null;
  } catch {
    return null;
  }
}

/**
 * What the URL bar accepts: a path, or a full URL only when it is on the preview host. Returns the path
 * (pathname + search + hash) or null when refused.
 */
export function parsePreviewInput(previewUrl: string | null | undefined, raw: string): string | null {
  const text = raw.trim();
  if (/^https?:\/\//i.test(text)) {
    let typed: URL;
    let base: URL;
    try {
      typed = new URL(text);
      base = new URL(previewUrl ?? '');
    } catch {
      return null;
    }
    if (typed.origin !== base.origin) return null;
    return `${typed.pathname}${typed.search}${typed.hash}`;
  }
  const url = resolvePreviewUrl(previewUrl, text);
  return url ? `${url.pathname}${url.search}${url.hash}` : null;
}
