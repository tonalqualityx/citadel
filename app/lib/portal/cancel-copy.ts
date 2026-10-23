/**
 * Every word the client reads around cancelling a request. One place so the copy scan covers it
 * (lib/portal/__tests__/client-copy.test.ts). Plain words, no dashes, no promises, no staff names.
 */
export const CANCEL_LINK = 'Cancel this request';
export const CANCEL_CONFIRM = 'Cancel it? This cannot be undone from here.';
export const CANCEL_YES = 'Yes, cancel';
export const CANCEL_KEEP = 'Keep it';
export const CANCEL_BUSY = 'Cancelling…';
export const CANCEL_ERROR = 'We could not cancel this request. Please try again.';
/** The line posted in the conversation, signed Indelible. */
export const CANCEL_LINE = 'You cancelled this request.';
export const ASK_FOR_CHANGE = 'Ask for a change';
export const CANCEL_LIVE_ERROR = 'This change is already live, so it cannot be cancelled. Use Ask for a change instead.';
export const MESSAGE_AFTER_CANCEL_ERROR = 'This request was cancelled. Start a new request to ask for something else.';

/** The prefill for a fresh request about work that is already live. */
export const changeToText = (title: string) => `Change to: ${title}`;
