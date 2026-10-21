/**
 * The fixed check before a model's `confirm_from_email` is allowed to file a request (phase C spec 7.4).
 * The model reads the client's email, but whether an email means "send it" is not left to the model:
 * the client's own new words must be short (12 words at most) and contain "send" or "yes" as a whole
 * word. Anything longer or vaguer is an ordinary message and the summary stays waiting.
 */
export const CONFIRM_MAX_WORDS = 12;

export function looksLikeYes(text: string | null | undefined): boolean {
  const t = (text ?? '').trim();
  if (!t) return false;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length > CONFIRM_MAX_WORDS) return false;
  return /(^|[^\p{L}\p{N}])(send|yes)([^\p{L}\p{N}]|$)/iu.test(t);
}
