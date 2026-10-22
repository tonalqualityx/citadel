/**
 * The assistant's fixed lines, word for word (phase C: portal-chat/prompts/system.md). The prompt's
 * examples and the copy gate both read from here, so a line the prompt tells the model to write is
 * never one the gate refuses. The gate removes each of these, verbatim, before it reads the rest of a
 * reply; a test asserts every one passes alone, and that every one still appears in system.md.
 *
 * Pilot rulings 2026-10-21: no self-introduction on the first reply (the disclosure line under the
 * header says replies are written by an AI assistant), no claim that a person reads every request,
 * and one timing line for a simple change. Any other time promise still fails the gate.
 */
export const FIXED_LINES = {
  /** The answer to "are you a person or a bot", only when the client asks. */
  aiAnswer: "I'm an AI assistant. Ask for a person any time and I'll pass this to the team.",
  /** The answer to "what can you do". */
  capability: "I help get your requests clear for the team, and I can look up your site's visits and search numbers and the status of your work.",
  /** The end of every handoff reply: in the portal, then by email. */
  handoffPortal: 'A person on the team will read this and reply here.',
  handoffEmail: 'A person on the team will read this and reply.',
  /** The reply that goes with `suggest_urgent`. */
  urgent: 'That sounds urgent. Pick the choice below that fits best.',
  /** The only timing a reply may give: a SIMPLE change (system.md, "Timing"). Verbatim or not at all. */
  simpleTiming:
    'For a change like this you will have a preview to approve within 48 hours, often sooner. Once you approve it, it usually goes live within the hour.',
  /** Search Console's lag, as the tool's own label words it. Kept with a Search Console answer. */
  searchLag: 'Search Console data runs about 2 days behind',
} as const;

export const FIXED_LINE_LIST: string[] = Object.values(FIXED_LINES);
