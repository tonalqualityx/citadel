/** A JSON merge patch (RFC 7386), as the server applies it, so the test server behaves like the real one. */
export function mergePatchForTest(target: unknown, patch: unknown): unknown {
  const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
  if (!isObj(patch)) return patch;
  const base: Record<string, unknown> = isObj(target) ? { ...target } : {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete base[k];
    else base[k] = mergePatchForTest(base[k], v);
  }
  return base;
}
