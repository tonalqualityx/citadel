// Designer Portal v2 (SPEC 4.10): the preview links a designer opens anywhere. One pure function builds every link, used
// by the server (the preview-link route) and the browser (the Preview links control), so the origin rule is the same
// on both sides: the host always comes from the session's stored preview URL, never from a path.

export const PREVIEW_PATH_MAX = 512;

/** The path part of a requested page: one leading slash, no host tricks. Query and hash are dropped. Null when refused. */
export function cleanPreviewPath(path: unknown): string | null {
  if (typeof path !== 'string' || path.length === 0 || path.length > PREVIEW_PATH_MAX) return null;
  if (/[\u0000-\u001f\u007f\\]/.test(path)) return null;
  if (!path.startsWith('/')) return null;
  const pathname = path.split(/[?#]/)[0];
  if (pathname.startsWith('//') || pathname.includes('//')) return null;
  if (pathname.includes('@') || pathname.includes('://')) return null;
  if (/%2e|%2f|%5c|%00/i.test(pathname)) return null;
  if (pathname.split('/').some((seg) => seg === '..' || seg === '.')) return null;
  return pathname;
}

/**
 * The shareable link for `path` on the session's preview alias, or null when anything is off: no preview, a path that is
 * not plain, a preview URL that is not an https `*.pages.dev` address, or a result that left the alias origin.
 */
export function buildPreviewLink(previewUrl: string | null | undefined, path: unknown = '/'): string | null {
  if (!previewUrl) return null;
  const pathname = cleanPreviewPath(path);
  if (pathname === null) return null;
  try {
    const base = new URL(previewUrl);
    if (base.protocol !== 'https:' || !base.hostname.endsWith('.pages.dev')) return null;
    const url = new URL(pathname, base);
    if (url.origin !== base.origin) return null;
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

/** The alias root, "the site". */
export function buildSiteLink(previewUrl: string | null | undefined): string | null {
  return buildPreviewLink(previewUrl, '/');
}
