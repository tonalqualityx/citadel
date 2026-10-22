// "Request work" always starts a fresh request. Every entry point carries a fresh ?new=<timestamp>
// token; the request page keys its chat state on it. A token already handled in this tab (a reload
// of the same URL) resumes the saved chat instead of resetting it again.
export const NEW_REQUEST_PARAM = 'new';
export const REQUEST_NEW_PATH = '/portal/requests/new';
export const EARLIER_REQUEST_NOTICE = 'Your earlier request is saved under Requests.';

export function isRequestNewHref(href: string): boolean {
  return href === REQUEST_NEW_PATH || href.startsWith(`${REQUEST_NEW_PATH}?`);
}

/** The same href with a fresh token (replacing any old one). */
export function withFreshToken(href: string, now: number = Date.now()): string {
  const [path, query = ''] = href.split('?');
  const qs = new URLSearchParams(query);
  qs.set(NEW_REQUEST_PARAM, String(now));
  return `${path}?${qs.toString()}`;
}

export interface TokenDecision {
  /** Clear the saved entry and open a new conversation on the first message. */
  fresh: boolean;
  /** Show the "earlier request is saved" line. */
  notice: boolean;
}

export function decideTokenReset(opts: {
  token: string | null;
  handledToken: string | null;
  hadConversation: boolean;
}): TokenDecision {
  if (!opts.token || opts.token === opts.handledToken) return { fresh: false, notice: false };
  return { fresh: true, notice: opts.hadConversation };
}
