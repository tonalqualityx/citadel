import { describe, it, expect } from 'vitest';
import { EFFORT, countedMinutes, guessDrain, guessMinutes, guessUnknowns, historyGuess } from '../effort';
import { drainWord, effortExtras, lineIsClean, timeBasisSentence, timeErrorSentence, unknownsWord } from '../copy';
import { effortWords } from '../../copy';
import { GUESS_ERROR_MIN_TASKS, minutesError } from '../measures';

describe('countedMinutes: the entry rule', () => {
  it('ignores entries under 3 minutes and over 480 minutes', () => {
    expect(countedMinutes([1, 2, 3169, 480, 3])).toBe(483);
    expect(countedMinutes([1, 2, 2, 2, 481, 3169])).toBeNull();
  });
  it('needs at least 5 minutes in all', () => {
    expect(countedMinutes([3])).toBeNull();
    expect(countedMinutes([4])).toBeNull();
    expect(countedMinutes([5])).toBe(5);
    expect(countedMinutes([3, 3])).toBe(6);
    expect(countedMinutes([])).toBeNull();
  });
});

describe('historyGuess: the median of at least 3 qualifying tasks', () => {
  it('needs 3 tasks that qualify', () => {
    expect(historyGuess([20, 40])).toBeNull();
    expect(historyGuess([20, 40, null])).toBeNull();
    expect(historyGuess([])).toBeNull();
  });
  it('takes the median, with n', () => {
    expect(historyGuess([60, 20, 40])).toEqual({ minutes: 40, n: 3 });
    expect(historyGuess([10, 20, 30, 100])).toEqual({ minutes: 25, n: 4 });
    expect(historyGuess([10, null, 20, 30, null])).toEqual({ minutes: 20, n: 3 });
  });
});

describe('guessMinutes: history, then energy, then the kind of work', () => {
  it('history first', () => {
    expect(guessMinutes({ history: [20, 30, 40], energy_estimate: 8 })).toEqual({ minutes: 30, source: 'history', n: 3 });
  });
  it('energy next', () => {
    const g = guessMinutes({ history: [20, 30], energy_estimate: 3 });
    expect(g.source).toBe('energy');
    expect(g.n).toBeNull();
    expect(g.minutes).toBeGreaterThan(0);
  });
  it('then the kind: a task is 30', () => {
    expect(guessMinutes({ history: [], energy_estimate: null })).toEqual({ minutes: 30, source: 'kind', n: null });
  });
  it('the cap constants are the plan values', () => {
    expect(EFFORT.nightlyCap).toBe(300);
    expect([EFFORT.minEntryMinutes, EFFORT.maxEntryMinutes, EFFORT.minTaskMinutes, EFFORT.minTasks]).toEqual([3, 480, 5, 3]);
  });
});

describe('guessUnknowns', () => {
  const base = { title: 'Update the footer', description: 'Change the year.', requirements: 0, sop_id: null };
  it('many on an investigating word', () => {
    for (const w of ['Investigate the slow page', 'Research hosts', 'Figure out the redirect', 'Look into it', 'Debug the form', 'Diagnose email', 'Why is it down', 'SEO audit', 'Explore options']) {
      expect(guessUnknowns({ ...base, title: w })).toBe('many');
    }
  });
  it('many in the description too, and beats an SOP', () => {
    expect(guessUnknowns({ ...base, description: 'We need to investigate.', sop_id: 's1' })).toBe('many');
  });
  it('some with no description, no requirements and no SOP', () => {
    expect(guessUnknowns({ title: 'Footer', description: null, requirements: 0, sop_id: null })).toBe('some');
    expect(guessUnknowns({ title: 'Footer', description: '   ', requirements: 0, sop_id: null })).toBe('some');
  });
  it('none when an SOP is set, or there is a description', () => {
    expect(guessUnknowns({ title: 'Footer', description: null, requirements: 0, sop_id: 's1' })).toBe('none');
    expect(guessUnknowns(base)).toBe('none');
    expect(guessUnknowns({ title: 'Footer', description: null, requirements: 2, sop_id: null })).toBe('none');
  });
  it('whole words only', () => {
    expect(guessUnknowns({ ...base, title: 'Whyte paper layout' })).toBe('none');
  });
});

describe('guessDrain', () => {
  it('a call', () => {
    for (const t of ['Call Gene', 'Weekly meeting prep', 'Site walkthrough', 'Talk to Ashley']) expect(guessDrain({ title: t, description: null })).toBe('call');
  });
  it('draining kinds of work', () => {
    for (const t of ['Send the quote', 'Fix invoice', 'Pricing page', 'Billing question', 'Payment failed', 'Budget review', 'Renew contract']) expect(guessDrain({ title: t, description: null })).toBe('high');
  });
  it('a call wins over money, and plain work is none', () => {
    expect(guessDrain({ title: 'Call about the quote', description: null })).toBe('call');
    expect(guessDrain({ title: 'Fix the footer', description: 'Change the year.' })).toBeNull();
    expect(guessDrain({ title: 'Callback form', description: null })).toBeNull();
  });
});

describe('copy', () => {
  it('basis sentences', () => {
    expect(timeBasisSentence('history', 4)).toBe('Time guess: from 4 similar finished tasks.');
    expect(timeBasisSentence('kind', null)).toBe('Time guess: from the kind of work.');
    expect(timeBasisSentence('energy', null)).toBeNull();
    expect(timeBasisSentence(null, null)).toBeNull();
    expect(timeBasisSentence('history', null)).toBeNull();
  });
  it('time words with unknowns and a call', () => {
    expect(effortWords(45, false, effortExtras('some', null))).toBe('About 45 minutes, some unknowns');
    expect(effortWords(30, false, effortExtras('none', 'call'))).toBe('About 30 minutes, a call');
    expect(effortWords(30, false, effortExtras('many', 'high'))).toBe('About 30 minutes, many unknowns, draining');
    expect(effortWords(30, false, effortExtras(null, null))).toBe('About 30 minutes');
    expect(unknownsWord('none')).toBeNull();
    expect(drainWord('high')).toBe('draining');
  });
  it('every sentence is clean', () => {
    for (const s of [timeBasisSentence('history', 4), timeBasisSentence('kind', null), timeErrorSentence(20, 6), unknownsWord('many'), drainWord('call'), drainWord('high')]) {
      expect(lineIsClean(s as string)).toBe(true);
    }
  });
});

describe('minutesError', () => {
  it('needs 5 finished guessed tasks', () => {
    expect(GUESS_ERROR_MIN_TASKS).toBe(5);
    expect(minutesError([{ guessed: 30, actual: 50 }])).toBeNull();
    expect(minutesError(Array.from({ length: 4 }, () => ({ guessed: 30, actual: 50 })))).toBeNull();
  });
  it('the average miss in minutes', () => {
    const rows = [
      { guessed: 30, actual: 50 },
      { guessed: 30, actual: 10 },
      { guessed: 30, actual: 30 },
      { guessed: 60, actual: 90 },
      { guessed: 20, actual: 30 },
    ];
    expect(minutesError(rows)).toEqual({ minutes: 16, n: 5 });
    expect(timeErrorSentence(20, 6)).toBe('Time guesses were off by about 20 minutes, from 6 finished tasks.');
  });
});
