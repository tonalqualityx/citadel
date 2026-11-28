/**
 * A Triage card description with a why, for tests that release a card. Release refuses a card with no why (lib/tasks/triage-why.ts;
 * Mike, 2026-11-28: "a triage card cannot be released without a clear why"), so a test card that is meant to release carries this.
 */
export const WHY_DESCRIPTION = JSON.stringify([
  { id: 'why-what', type: 'paragraph', props: {}, content: [{ type: 'text', text: "What's wanted: ", styles: { bold: true } }, { type: 'text', text: 'A test card.', styles: {} }], children: [] },
  { id: 'why-why', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'Why it matters: ', styles: { bold: true } }, { type: 'text', text: 'It lets the test release the card.', styles: {} }], children: [] },
]);
