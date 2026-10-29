/**
 * Designer Portal: which models the designer worker may run (design T15; W8.1 H5). An ALLOWLIST, not a
 * deny-list: aliases such as `best` or `default` resolve to whatever the SDK maps them to (today `best` is
 * Fable), so only the three family aliases and their full ids pass. Case-insensitive. Shared by the admin
 * settings route (400) and the AdminSettings form (client-side), so the two cannot drift. No server imports.
 */
export const DESIGN_MODEL_ALIASES = ['opus', 'sonnet', 'haiku'] as const;

/** `opus` | `sonnet` | `haiku`, or a full id such as `claude-opus-4-5` / `claude-sonnet-4-5-20250929`. */
const ALLOWED_MODEL = /^(?:opus|sonnet|haiku|claude-(?:opus|sonnet|haiku)-[0-9][a-z0-9.-]*)$/i;
/** Named and refused even if a future id would otherwise match the pattern. */
const REFUSED_MODEL = /fable|mythos/i;

export function isAllowedDesignModel(model: string): boolean {
  const m = model.trim();
  return m.length > 0 && m.length <= 60 && ALLOWED_MODEL.test(m) && !REFUSED_MODEL.test(m);
}

/** The user-facing reason a model is refused, or null when it is allowed. */
export function designModelError(model: string): string | null {
  const m = model.trim();
  if (!m) return 'Enter a model.';
  if (/fable/i.test(m)) return 'The Fable model cannot be used for the designer worker.';
  if (!isAllowedDesignModel(m)) return 'Use opus, sonnet or haiku, or a full model id such as claude-opus-4-5.';
  return null;
}
