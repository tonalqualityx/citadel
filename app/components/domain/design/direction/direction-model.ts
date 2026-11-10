import type { DirectionBody } from '@/lib/hooks/use-design-direction';

export type Path = string[];
export const keyOf = (path: Path) => path.join('.');

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function getIn(root: unknown, path: Path): unknown {
  let cur: unknown = root;
  for (const k of path) {
    if (!isObject(cur)) return undefined;
    cur = cur[k];
  }
  return cur;
}

/** Immutable set. A null or undefined value removes the key. */
export function setIn(root: unknown, path: Path, value: unknown): Record<string, unknown> {
  const base: Record<string, unknown> = isObject(root) ? { ...root } : {};
  if (path.length === 0) return base;
  const [head, ...rest] = path;
  if (rest.length === 0) {
    if (value === null || value === undefined) delete base[head];
    else base[head] = value;
    return base;
  }
  base[head] = setIn(base[head], rest, value);
  return base;
}

/** The leaves of a body as `key -> JSON`: scalars and whole arrays are leaves, objects are walked. */
export function leaves(body: unknown, prefix: Path = [], out: Record<string, string> = {}): Record<string, string> {
  if (isObject(body)) {
    for (const [k, v] of Object.entries(body)) leaves(v, [...prefix, k], out);
  } else if (prefix.length > 0) {
    out[keyOf(prefix)] = JSON.stringify(body ?? null);
  }
  return out;
}

export interface PendingEntry { path: Path; value: unknown }
export type Pending = Record<string, PendingEntry>;

export function applyPending(body: DirectionBody | undefined, pending: Pending): DirectionBody {
  let out: Record<string, unknown> = (body ?? {}) as Record<string, unknown>;
  for (const e of Object.values(pending)) out = setIn(out, e.path, e.value);
  return out as DirectionBody;
}

export const sameValue = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function setPatchIn(root: Record<string, unknown>, path: Path, value: unknown): Record<string, unknown> {
  const base = { ...root };
  const [head, ...rest] = path;
  if (rest.length === 0) base[head] = value ?? null;
  else base[head] = setPatchIn(isObject(base[head]) ? (base[head] as Record<string, unknown>) : {}, rest, value);
  return base;
}

/** A JSON merge patch (null removes a key) for the entries that differ from the saved body. */
export function buildPatch(saved: DirectionBody | undefined, pending: Pending): { patch: Record<string, unknown>; keys: string[] } {
  let patch: Record<string, unknown> = {};
  const keys: string[] = [];
  for (const [key, e] of Object.entries(pending)) {
    if (sameValue(getIn(saved, e.path), e.value)) continue;
    patch = setPatchIn(patch, e.path, e.value);
    keys.push(key);
  }
  return { patch, keys };
}

/** The words a designer reads for what is still missing before sign-off. */
export function signReasons(body: DirectionBody | undefined, missingCount: number): string[] {
  const reasons: string[] = [];
  if (missingCount > 0) reasons.push(`${missingCount} client ${missingCount === 1 ? 'request is' : 'requests are'} not answered yet.`);
  if ((body?.client_requests ?? []).some((r) => !r.how_honoured.trim())) reasons.push('Say how each client request is honoured.');
  if (!body?.nav?.desktop?.pattern) reasons.push('Choose the desktop navigation.');
  if (!body?.nav?.mobile?.pattern) reasons.push('Choose the phone navigation.');
  if (!body?.container?.max_content_px) reasons.push('Set the page width.');
  return reasons;
}
