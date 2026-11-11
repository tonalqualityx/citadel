import { describe, it, expect } from 'vitest';
import * as copy from '../copy';
import { NOW, d } from './fixtures/tonight';

const EM = '—';
const EN = '–';

describe('displayText', () => {
  it('replaces an em dash with a comma at display time', () => {
    expect(copy.displayText(`Install the sign-in ${EM} before Friday`)).toBe('Install the sign-in, before Friday');
    expect(copy.displayText(`one${EM}two`)).toBe('one, two');
  });
  it('replaces an en dash with a comma, and a number range with "to"', () => {
    expect(copy.displayText(`Gene ${EN} the site`)).toBe('Gene, the site');
    expect(copy.displayText(`2020${EN}2021`)).toBe('2020 to 2021');
    expect(copy.displayText(`November 16${EN}19`)).toBe('November 16 to 19');
  });
  it('trims stray commas and blanks, and handles null', () => {
    expect(copy.displayText(`${EM} start`)).toBe('start');
    expect(copy.displayText(`end ${EM}`)).toBe('end');
    expect(copy.displayText(null)).toBe('');
    expect(copy.displayText(undefined)).toBe('');
    expect(copy.displayText('  a   b  ')).toBe('a b');
  });
  it('leaves a hyphen alone', () => {
    expect(copy.displayText('long-lived sign-in')).toBe('long-lived sign-in');
  });
  it('never leaves a dash behind', () => {
    expect(copy.displayText(`a ${EM}${EM} b ${EN} c`)).not.toMatch(/[–—]/);
  });
});

describe('dates', () => {
  it('the date line is written out, in his zone', () => {
    expect(copy.screenDateLine(NOW)).toBe('Monday, November 9');
    expect(copy.screenDateLine(d('2026-11-10T04:00:00Z'), 'America/New_York')).toBe('Monday, November 9');
    expect(copy.screenDateLine(d('2026-11-10T04:00:00Z'), 'Asia/Karachi')).toBe('Tuesday, November 10');
  });
  it('the zoned date string is YYYY-MM-DD', () => {
    expect(copy.zonedDateString(NOW)).toBe('2026-11-09');
    expect(copy.zonedDateString(d('2026-11-10T04:00:00Z'), 'Asia/Karachi')).toBe('2026-11-10');
  });
  it('the weekday is computed, never assumed: November 14, 2026 is a Saturday', () => {
    expect(copy.weekdayName(2026, 11, 14)).toBe('Saturday');
    expect(copy.hardDateChip(d('2026-11-14T00:00:00.000Z'))).toBe('Due Saturday, November 14');
    expect(copy.hardDateChip(d('2026-11-15T00:00:00.000Z'))).toBe('Due Sunday, November 15');
  });
  it('a date-only value is its own day; a real instant is read in New York', () => {
    expect(copy.hardDateChip(d('2026-11-14T00:00:00.000Z'))).toBe('Due Saturday, November 14');
    expect(copy.hardDateChip(d('2026-11-14T03:30:00.000Z'))).toBe('Due Friday, November 13');
    expect(copy.hardDateChip(d('2026-11-14T17:00:00.000Z'))).toBe('Due Saturday, November 14');
  });
  it('the promised-to name goes in brackets, and is cleaned of dashes', () => {
    expect(copy.hardDateChip(d('2026-11-13T00:00:00.000Z'), 'Gene Roberts')).toBe('Due Friday, November 13 (Gene Roberts)');
    expect(copy.hardDateChip(d('2026-11-13T00:00:00.000Z'), `domain ${EM} renews`)).toBe('Due Friday, November 13 (domain, renews)');
    expect(copy.hardDateChip(d('2026-11-13T00:00:00.000Z'), '  ')).toBe('Due Friday, November 13');
  });
});

describe('elapsed time and effort', () => {
  it('ages read as elapsed time', () => {
    expect(copy.ageWords(d('2026-11-09T14:00:00Z'), NOW)).toBe('filed today');
    expect(copy.ageWords(d('2026-11-09T14:00:00Z'), NOW, 'arrived')).toBe('came in today');
    expect(copy.ageWords(d('2026-11-08T14:00:00Z'), NOW)).toBe('1 day');
    expect(copy.ageWords(d('2026-10-27T14:00:00Z'), NOW)).toBe('13 days');
  });
  it('ages count whole 24-hour periods, not midnights', () => {
    // 5 hours old, but a New York midnight passed in between.
    const late = d('2026-11-10T01:00:00Z'); // 8 pm Monday in New York
    const now = d('2026-11-10T06:00:00Z'); // 1 am Tuesday in New York
    expect(copy.ageWords(late, now)).toBe('filed today');
    expect(copy.ageWords(late, now, 'arrived')).toBe('came in today');
    expect(copy.waitedFor(late, now)).toBe('less than a day');
    expect(copy.ageWords(d('2026-11-09T05:00:00Z'), now)).toBe('1 day');
    expect(copy.ageWords(d('2026-11-07T05:00:00Z'), now)).toBe('3 days');
    expect(copy.waitedFor(d('2026-11-08T05:00:00Z'), now)).toBe('2 days');
  });
  it('waited phrases', () => {
    expect(copy.waitedFor(d('2026-11-09T14:00:00Z'), NOW)).toBe('less than a day');
    expect(copy.waitedFor(d('2026-10-30T14:00:00Z'), NOW)).toBe('10 days');
  });
  it('durations round for reading', () => {
    expect(copy.plainDuration(2)).toBe('2 minutes');
    expect(copy.plainDuration(1)).toBe('1 minute');
    expect(copy.plainDuration(27)).toBe('25 minutes');
    expect(copy.plainDuration(60)).toBe('1 hour');
    expect(copy.plainDuration(110)).toBe('1 hour 50 minutes');
    expect(copy.plainDuration(120)).toBe('2 hours');
  });
  it('effort words, with and without a draft', () => {
    expect(copy.effortWords(10)).toBe('About 10 minutes');
    expect(copy.effortWords(2, true)).toBe('Draft ready, about 2 minutes');
    expect(copy.effortWords(40)).toBe('About 40 minutes');
  });
  it('the size line, and what it says when the day does not fit', () => {
    expect(copy.sizeLine(110, 420)).toBe('About 1 hour 50 minutes');
    expect(copy.sizeLine(190, 120)).toBe('About 3 hours 10 minutes, more than today has free');
    expect(copy.sizeLine(120, 120)).toBe('About 2 hours');
  });
});

describe('sentences', () => {
  it('empty sentences are the design\'s', () => {
    const e = copy.emptySentences();
    expect(e.needs_you_now).toBe('Nothing urgent.');
    expect(e.working_on).toBe('Nothing in progress.');
    expect(e.leads).toBe('No one is waiting on a reply from you.');
    expect(e.mail).toBe('No one is waiting on a reply from you.');
    expect(e.next).toBe('Nothing needs a decision from you right now.');
    expect(e.handled).toBe('Nothing new since you last looked.');
    expect(e.projects).toBe('No active projects.');
    expect(e.everything_else).toBe('');
    expect(Object.keys(e).sort()).toEqual(
      ['everything_else', 'handled', 'leads', 'mail', 'needs_you_now', 'next', 'projects', 'today', 'working_on'],
    );
  });
  it('the Everything else sentence', () => {
    expect(copy.everythingElseLine(0)).toBe('Nothing else is on your plate.');
    expect(copy.everythingElseLine(1)).toBe('1 other item is counted here. 0 have a day to come back. None is past its day.');
    expect(copy.everythingElseLine(52, 41, 3)).toBe('52 other items are counted here. 41 have a day to come back. 3 are past their day.');
    expect(copy.everythingElseLine(5, 1, 1)).toBe('5 other items are counted here. 1 has a day to come back. 1 is past its day.');
  });
  it('Slice 2 lines', () => {
    expect(copy.scopeLine(0)).toBeNull();
    expect(copy.scopeLine(1)).toBe('1 task on an unsigned or paused project is kept as scope, not work.');
    expect(copy.scopeLine(41)).toBe('41 tasks on unsigned or paused projects are kept as scope, not work.');
    expect(copy.whyFresh(true)).toBe('New from the chat.');
    expect(copy.whyFresh(false)).toBe('New, made by you.');
    expect(copy.WHY_ARRIVED).toBe('Back today, after waiting its turn.');
    expect(copy.backOnText(d('2026-11-12T14:00:00Z'))).toBe('Back Thursday, November 12');
    expect(copy.whenProjectStarts('Grok')).toBe('When Grok starts');
    expect(copy.withSignOff('Grok')).toBe('With the Grok sign-off');
    expect(copy.hardDateChip(d('2026-11-15T00:00:00.000Z'), 'domain renews')).toBe('Due Sunday, November 15 (domain renews)');
    expect(copy.REST_GROUP_COPY.scheduled.label).toBe('Given a day to come back');
  });
  it('handled lines', () => {
    expect(copy.handledLine({ who: 'Pat', subject: 'Invoice' })).toBe(`Closed Pat's message "Invoice". The email sorter marked it handled.`);
    expect(copy.handledMoreText(4)).toBe('4 more handled');
  });
  it('why this arc names how many more steps wait', () => {
    expect(copy.whyThisArc('A security flag is open.', 3, 'Grok')).toBe('A security flag is open, and 3 more for Grok wait on you');
    expect(copy.whyThisArc('A security flag is open.', 1, 'Grok')).toBe('A security flag is open, and 1 more for Grok waits on you');
    expect(copy.whyThisArc('A security flag is open.', 0, 'Grok')).toBe('A security flag is open');
  });
});

/** Every string this module can put on the screen, gathered by calling its builders. */
function allCopy(): string[] {
  const out: string[] = [];
  const add = (v: unknown) => {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(add);
    else if (v && typeof v === 'object') Object.values(v).forEach(add);
  };
  add(copy.ACTION_LABELS);
  add(copy.REASON);
  add(copy.IF_IGNORED);
  add(copy.EMPTY_TILE);
  add(copy.REST_GROUP_COPY);
  const rules = ['security', 'lifeline', 'client_blocking_tag', 'client_waiting', 'session_client_blocking', 'crisis_mail', 'promised_date'] as const;
  for (const r of rules) {
    out.push(copy.whyEmergency(r, { client: 'Grok', sender: 'Pat' }), copy.whyEmergency(r, {}), copy.reasonEmergency(r));
  }
  out.push(
    copy.whyTask({ who: 'Gene', client: 'Grok', personWaiting: true, waited: '13 days', unblocks: 0, daysOnList: 3 }),
    copy.whyTask({ who: null, client: 'Grok', personWaiting: false, waited: '', unblocks: 0, daysOnList: 3 }),
    copy.whyTask({ who: null, client: null, personWaiting: false, waited: '', unblocks: 2, daysOnList: 3 }),
    copy.whyTask({ who: null, client: null, personWaiting: false, waited: '', unblocks: 0, daysOnList: 3 }),
    copy.whyTask({ who: null, client: null, personWaiting: false, waited: '', unblocks: 0, daysOnList: 0 }),
    copy.whySignOff({ pieces: 39, since: '13 days' }),
    copy.whySignOff({ pieces: 1, since: '1 day' }),
    copy.whySession({ since: '5 days' }),
    copy.whyWait({ needsHuman: true }),
    copy.whyWait({ needsHuman: false }),
    copy.whyThread({ lead: true, since: '10 days', draftReady: true }),
    copy.whyThread({ lead: false, since: '10 days', draftReady: false }),
    copy.reasonArcStep('Grok'),
    copy.approveAllLabel(39),
    copy.sizeLine(190, 120),
    copy.effortWords(2, true),
    copy.everythingElseLine(5, 2, 1),
    copy.scopeLine(3) ?? '',
    copy.whyFresh(true),
    copy.whyFresh(false),
    copy.WHY_ARRIVED,
    copy.backOnText(d('2026-11-12T14:00:00Z')),
    copy.BRING_FORWARD_LABEL,
    ...Object.values(copy.REST_CHECK),
    copy.REASON.fresh,
    copy.REASON.arrived,
    copy.whyEmergency('promised_date', { outsideDate: true }),
    copy.reasonEmergency('promised_date', true),
    copy.REST_GROUP_COPY.scheduled.label,
    copy.handledLine({ who: 'Pat', subject: 'Hi' }),
    copy.hardDateChip(d('2026-11-14T00:00:00.000Z'), 'Gene'),
    copy.ageWords(d('2026-10-27T14:00:00Z'), NOW),
    copy.screenDateLine(NOW),
  );
  return out;
}

describe('laws on every string', () => {
  const strings = allCopy();
  it('gathers a real set of strings', () => expect(strings.length).toBeGreaterThan(60));
  it('no priority label, P1 to P5, or the word for a missed deadline', () => {
    for (const s of strings) expect(s, s).not.toMatch(/priority|\bP[1-5]\b|overdue|\blate\b|past due/i);
  });
  it('no em dash or en dash', () => {
    for (const s of strings) expect(s, s).not.toMatch(/[–—]/);
  });
  it('"If you do nothing" lines promise nothing a later slice builds', () => {
    // botStopped names Bast on purpose: the task is Bast's and stays with it (Slice 3, plan text).
    for (const [k, s] of Object.entries(copy.IF_IGNORED)) {
      if (k === 'botStopped') continue;
      expect(s, s).not.toMatch(/bast|slack|sabeen|scan|tomorrow|tonight|wednesday|thursday|draft|rewrite|swap|send(s)? (a|the)|rule/i);
    }
  });
  it('every "If you do nothing" line says what really happens', () => {
    for (const s of Object.values(copy.IF_IGNORED)) expect(s, s).toMatch(/^Stays /);
  });
  it('no raw numbers of scores: no "score", "class" or "quadrant"', () => {
    for (const s of strings) expect(s, s).not.toMatch(/score|quadrant|consequence class/i);
  });
});

describe('Slice 3 copy', () => {
  it('the Bast lines are exactly the planned words', () => {
    expect(copy.BOT_WHO).toBe('Bast');
    expect(copy.WHY_BOT_STOPPED).toBe('Bast stopped on this and needs you.');
    expect(copy.IF_IGNORED.botStopped).toBe('Stays with Bast, stopped, until you answer on the task.');
  });
});

describe('Slice 4a copy', () => {
  it('the three new buttons read as planned', () => {
    expect(copy.ACTION_LABELS.draft_now).toBe('Draft it now');
    expect(copy.ACTION_LABELS.needs_thought).toBe('Needs thought');
    expect(copy.ACTION_LABELS.go_with_that).toBe('Go with that');
  });
  it('no label says send, except the two Slice 4b buttons (they exist only while his owed_send switch is on)', () => {
    const { send_draft, send_short, ...rest } = copy.ACTION_LABELS;
    expect([send_draft, send_short]).toEqual(['Send the draft', 'Send the short one']);
    for (const label of Object.values(rest)) expect(label).not.toMatch(/\bsend\b/i);
  });
});
