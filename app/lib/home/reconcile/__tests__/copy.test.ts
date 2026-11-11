import { describe, it, expect } from 'vitest';
import { BUTTONS, IF_IGNORED_CARD, IF_IGNORED_TRACK, TITLES, noteLine, noteText, plainLine, trackLines, trackToast, whoLabel, whyAsk } from '../copy';
import type { WhyCode } from '../decide';

const SENT = new Date('2026-11-09T15:00:00Z');
const BAD = /[–—]|priorit|overdue/i;

describe('reconcile copy', () => {
  it('the note reads exactly as the plan says and shows a dash in his words as a spaced hyphen', () => {
    expect(noteText({ who: 'Kue Chen', sent: SENT, quote: 'I removed the File Manager plugin.', link: 'https://mail.google.com/x' })).toBe(
      'From Mike\'s sent mail. Email to Kue Chen on Monday, November 9: "I removed the File Manager plugin." Open the email: https://mail.google.com/x'
    );
    expect(noteText({ who: 'Kue', sent: SENT, quote: `fixed it ${String.fromCharCode(0x2014)} done`, link: 'l' })).toContain('"fixed it - done"');
    expect(noteLine('Griswold: clean up the hacked site', 'Kue Chen', SENT)).toBe('Noted on "Griswold: clean up the hacked site" from your email to Kue Chen, November 9.');
  });

  it('the titles of the cards', () => {
    expect(TITLES.done('removed File Manager')).toBe('Your email says you removed File Manager. Mark this done?');
    expect(TITLES.note('Kue Chen', 'Sabeen', 'Rebuild it')).toBe('Your email to Kue Chen is about Sabeen\'s task "Rebuild it". Add a note?');
    expect(TITLES.waiting('Kue Chen', 'the hosting login')).toBe('You asked Kue Chen for the hosting login. Wait on them?');
    expect(TITLES.session('Kue Chen', 'Chatbot tone')).toBe('Your email to Kue Chen answers "Chatbot tone". Clear the question?');
    expect(TITLES.track('You built and sent a sample page for Phil Camp')).toBe('You built and sent a sample page for Phil Camp. Track it?');
    expect(TITLES.track('sample page for Phil Camp')).toBe('Sample page for Phil Camp. Track it?');
  });

  it('every reason has a line starting "Why Bast asks:"', () => {
    const all: WhyCode[] = ['security', 'someone_else', 'unsure', 'older', 'commitment', 'bast_words', 'wrong_hold', 'cap', 'reach', 'manual', 'new_work'];
    for (const w of all) expect(whyAsk(w)).toMatch(/^Why Bast asks: /);
    expect(whyAsk('security')).toBe('Why Bast asks: it is a security task, so Bast never closes it on its own.');
    expect(whyAsk('someone_else', { owner: 'Sabeen' })).toBe("Why Bast asks: it is Sabeen's task, so Bast never changes it from your mail.");
  });

  it('the Track it lines carry the project rule: add, ask, new and loose', () => {
    const base = { who: 'The Editor', sent: SENT, quote: 'Here is the page.', done_title: 'Build the page', minutes: 90, estimate_basis: 'six emails', retainer_hours: 10, client_name: 'The Vermont Standard', next_step: 'Get them on a call', later: ['Launch it'] };
    const line = (placement: Parameters<typeof trackLines>[0]['placement']) => trackLines({ ...base, placement });
    expect(line({ kind: 'add', project: { id: 'p', name: 'Memorial pages' } })).toContain('Where it goes: Memorial pages.');
    expect(line({ kind: 'ask', project: { id: 'p', name: 'Memorial pages' } })).toContain('Add to Memorial pages or start a new project?');
    expect(line({ kind: 'new' })).toContain('No live project for this yet. A new project will be made for it.');
    expect(line({ kind: 'loose' })).toContain('Where it goes: The Vermont Standard, with no project.');
    expect(line({ kind: 'new' })).toContain("Counts toward The Vermont Standard's retainer for November.");
    expect(trackLines({ ...base, retainer_hours: null, placement: { kind: 'new' } })).toContain('Logged as billable time. Change that on the task page.');
    expect(line({ kind: 'new' })).toContain("Time spent: about 1 hour 30 minutes. This is Bast's estimate: six emails. Change it before you tap.");
  });

  it('no sentence has an em or en dash, "priority" or the word for a missed deadline', () => {
    const all = [
      ...Object.values(BUTTONS).filter((v): v is string => typeof v === 'string'),
      IF_IGNORED_CARD,
      IF_IGNORED_TRACK,
      BUTTONS.addTo('X'),
      TITLES.done('x'),
      trackToast(4, 90, 'Client'),
      whoLabel(['A', 'B', 'C']),
      plainLine(`a ${String.fromCharCode(0x2013)} b`),
      ...(['security', 'someone_else', 'unsure', 'older', 'commitment', 'bast_words', 'wrong_hold', 'cap', 'reach', 'manual', 'new_work'] as WhyCode[]).map((w) => whyAsk(w)),
    ];
    for (const t of all) expect(t, t).not.toMatch(BAD);
  });

  it('who label', () => {
    expect(whoLabel(['Kue Chen'])).toBe('Kue Chen');
    expect(whoLabel(['Kue Chen', 'A', 'B'])).toBe('Kue Chen and 2 others');
    expect(whoLabel(['Kue Chen', 'A'])).toBe('Kue Chen and 1 other');
  });
});
