/**
 * A return path is only ever a same-origin relative path to a page. Anything else returns null.
 * Rejects absolute and protocol-relative URLs, backslashes, control characters, a leading `//`,
 * anything not starting with a single `/`, API paths, and the continue route itself (no loop).
 */
export function safeReturnPath(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) return null;
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  if (raw.includes('\\')) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw)) return null;
  // A decoded form must not smuggle in a backslash or a second slash either.
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (decoded.includes('\\') || decoded.startsWith('//')) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(decoded)) return null;
  // Belt and braces: it must resolve to the same origin.
  try {
    const base = 'http://citadel.invalid';
    const u = new URL(raw, base);
    if (u.origin !== base) return null;
  } catch {
    return null;
  }
  const pathOnly = raw.split(/[?#]/)[0];
  if (pathOnly === '/api' || pathOnly.startsWith('/api/')) return null;
  return raw;
}
