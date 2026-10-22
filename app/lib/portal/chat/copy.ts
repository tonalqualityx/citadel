/**
 * Every fixed client-facing string of the chat (phase C spec 11.3). One file so one test can scan
 * them all for promises, dashes and the name Bast. Model text never lands here; these are the
 * lines Citadel itself shows: the canned fallback, the banner, the urgent choices, the tree-mode
 * questions, the summary card and the sent lines.
 */
import { OPENING_CHOICES, OPENING_PROMPT, SENT_DOWNGRADED, SENT_HEADING, SENT_URGENT, SITE_PROMPT, QUOTE_LINE, EMERGENCY_LINE } from '@/lib/portal/intake/tree';

export const ASSISTANT_NAME = 'Indelible assistant';
export const CANNED_LINE = 'A person on the team will read this and reply here.';
export const HANDOFF_BANNER = 'A person on the team will reply here. You can keep adding details while you wait.';
export const DISCLOSURE_LINE = 'Replies marked Indelible assistant are written by an AI assistant.';

export const WRITING_LABELS = { writing: 'Writing', still_writing: 'Still writing', checking_numbers: 'Checking your numbers' } as const;

export const URGENT_PROMPT = 'That sounds urgent. Pick the choice below that fits best.';
export const URGENT_CHOICES = [
  { id: 'site_down', label: 'The whole site is down' },
  { id: 'form_checkout', label: 'A form, checkout or payment is not working' },
  { id: 'not_urgent', label: 'No, it is not urgent' },
] as const;
export const URGENT_MARKED = SENT_URGENT;
export const URGENT_DOWNGRADED = SENT_DOWNGRADED;
export const URGENT_DISMISSED = 'Okay. We will keep going.';

export const TREE = {
  type: OPENING_PROMPT,
  site: SITE_PROMPT,
  page: 'Which page is this about?',
  section: 'Where on the page? For example, the top banner or the team section.',
  change: 'What should change? Tell us in your own words.',
  asset: 'Do you have a file for this? Attach it here, or choose "No file".',
  fallbackIntro: 'Let me ask the rest in steps.',
  summaryIntro: 'Here is your request as I have it. Check it before it goes to the team.',
} as const;

export const CHOICE_LABELS = { not_sure: 'Not sure', another_page: 'Another page', no_file: 'No file' } as const;
export const RESERVED_CHOICES = ['not_sure', 'another_page', 'no_file'] as const;

export const SUMMARY_LABELS = { site: 'Site', page: 'Page', section: 'Section', change: 'Change', files: 'Files' } as const;
export const BUTTONS = { send: 'Send to the team', change: 'Change something' } as const;
export const SENT_LINES = { heading: SENT_HEADING, more: 'You can keep adding details here.' } as const;
/** A stale "Send to the team" after the sweep already filed the request (client walked away). */
export const ALREADY_FILED_LINE = 'This request was already filed. Open it from Requests.';
export const CHANGE_PROMPT = 'What would you like to change?';
export const CLOSED_QUESTION_LINE = 'Anything else?';
export const NOT_SURE = 'Not sure';

export { QUOTE_LINE, EMERGENCY_LINE, OPENING_CHOICES };

/** Staff-only notes (never client visible). */
export const NOTE = {
  injection: (source: string, excerpt: string) => `Assistant reported text that tried to instruct it (${source}). Quoted, not followed: "${excerpt}"`,
  handoff: (reason: string, draft: string, draftOk: boolean) =>
    `Assistant handed this to a person: ${reason}.\n${draftOk ? 'Draft reply (not sent):' : 'Draft reply (not sent; draft breaks the copy rules):'}\n${draft || '(none)'}`,
  handback: 'Handed back to the assistant.',
} as const;

/** Every client-facing string, for the copy scan. */
export function allChatStrings(): string[] {
  return [
    ASSISTANT_NAME, CANNED_LINE, HANDOFF_BANNER, DISCLOSURE_LINE, ...Object.values(WRITING_LABELS), URGENT_PROMPT,
    ...URGENT_CHOICES.map((c) => c.label), URGENT_MARKED, URGENT_DOWNGRADED, URGENT_DISMISSED, ...Object.values(TREE),
    ...Object.values(CHOICE_LABELS), ...Object.values(SUMMARY_LABELS), ...Object.values(BUTTONS), ...Object.values(SENT_LINES),
    CHANGE_PROMPT, ALREADY_FILED_LINE, CLOSED_QUESTION_LINE, QUOTE_LINE, EMERGENCY_LINE, ...OPENING_CHOICES.flatMap((o) => [o.label, o.line]),
  ];
}
