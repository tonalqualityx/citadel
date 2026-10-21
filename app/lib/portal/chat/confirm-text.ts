/**
 * The fixed check before a model's `confirm_from_email` is allowed to file a request (phase C spec 7.4).
 * The model reads the client's email, but whether an email means "send it" is not left to the model:
 * the client's own new words must be short (12 words at most), contain "send" or "yes" as a whole word,
 * and carry none of a short list of hedges (no, not, don't, wait, hold, but, change, except, instead).
 * Anything else is an ordinary message and the summary stays waiting.
 */
export const CONFIRM_MAX_WORDS = 12;

const WORD = (list: string) => new RegExp(`(^|[^\\p{L}\\p{N}'])(?:${list})(?=[^\\p{L}\\p{N}']|$)`, 'iu');
const YES = WORD('send|yes');
const HEDGE = WORD("no|not|don't|dont|do not|wait|hold|but|change|except|instead");

export function looksLikeYes(text: string | null | undefined): boolean {
  const t = (text ?? '').replace(/[\u2018\u2019\u02bc]/g, "'").trim();
  if (!t) return false;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length > CONFIRM_MAX_WORDS) return false;
  if (HEDGE.test(t)) return false;
  return YES.test(t);
}
