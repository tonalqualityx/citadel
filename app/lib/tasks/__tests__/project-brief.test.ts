import { describe, it, expect } from 'vitest';
import { BRIEF_MARKER, briefBlocks, briefFromCard, descriptionLines, mayReplaceDescription } from '../project-brief';

const blk = (type: string, text: string) => ({ id: 'x', type, content: [{ type: 'text', text, styles: {} }] });
const CARD = JSON.stringify([
  blk('paragraph', "What's wanted: A new Thermalnetics site that sells the booths."),
  blk('paragraph', 'Why it matters: Their old site loses leads and the client needs it before the trade show.'),
  blk('paragraph', 'Done when:'),
  blk('bulletListItem', 'Site launched with the deal pages in place'),
  blk('bulletListItem', 'Forms deliver to the client'),
  blk('paragraph', 'Where to look: the deal'),
]);

describe('project brief (a project card describes the project)', () => {
  it('reads what, why and done-when from a BlockNote card and stops at the next section', () => {
    expect(briefFromCard(CARD)).toEqual({
      what: 'A new Thermalnetics site that sells the booths.',
      why: 'Their old site loses leads and the client needs it before the trade show.',
      done_when: ['Site launched with the deal pages in place', 'Forms deliver to the client'],
    });
  });
  it('reads a plain-text card too, and none when it has no section', () => {
    expect(briefFromCard("What's wanted: X\nWhy it matters: Y\nDone when:\n- Z")).toEqual({ what: 'X', why: 'Y', done_when: ['Z'] });
    expect(briefFromCard('Just some words')).toBeNull();
    expect(briefFromCard(null)).toBeNull();
  });
  it('the copy starts with the marker and is replaceable; a description a person wrote is not', () => {
    const copy = JSON.stringify(briefBlocks(briefFromCard(CARD)!));
    expect(JSON.parse(copy)[0].content[0].text).toBe(BRIEF_MARKER);
    expect(mayReplaceDescription(copy)).toBe(true);
    expect(mayReplaceDescription(null)).toBe(true);
    expect(mayReplaceDescription('')).toBe(true);
    expect(mayReplaceDescription(JSON.stringify([blk('paragraph', 'Written by Mike.')]))).toBe(false);
    expect(mayReplaceDescription('Written by Mike.')).toBe(false);
  });
  it('shows the description as plain lines without the marker', () => {
    const lines = descriptionLines(JSON.stringify(briefBlocks(briefFromCard(CARD)!)));
    expect(lines).toEqual([
      'What this project is: A new Thermalnetics site that sells the booths.',
      'Why it matters: Their old site loses leads and the client needs it before the trade show.',
      'Done when:',
      '• Site launched with the deal pages in place',
      '• Forms deliver to the client',
    ]);
    expect(descriptionLines(null)).toBeNull();
  });
});
