/**
 * The assistant's fixed lines, word for word (phase C: portal-chat/prompts/system.md). The prompt's
 * examples and the copy gate both read from here, so a line the prompt tells the model to write is
 * never one the gate refuses. The gate removes each of these, verbatim, before it reads the rest of a
 * reply; a test asserts every one passes alone, and that every one still appears in system.md.
 */
export const FIXED_LINES = {
  /** First sentence of a conversation. */
  disclosure: "I'm Indelible's AI assistant.",
  /** The answer to "are you a person or a bot". */
  aiAnswer: "I'm an AI assistant. A person on the team reads every request.",
  /** The answer to "what can you do". */
  capability: "I help get your requests clear for the team, and I can look up your site's visits and search numbers and the status of your work.",
  /** The end of every handoff reply: in the portal, then by email. */
  handoffPortal: 'A person on the team will read this and reply here.',
  handoffEmail: 'A person on the team will read this and reply.',
  /** The reply that goes with `suggest_urgent`. */
  urgent: 'That sounds urgent. Pick the choice below that fits best.',
} as const;

export const FIXED_LINE_LIST: string[] = Object.values(FIXED_LINES);
