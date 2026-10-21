import { describe, it, expect } from 'vitest';
import { homeHeadline, homeLede, numberWord } from '../headline';

describe('homeHeadline', () => {
  it('says nothing needs the client at zero', () => {
    expect(homeHeadline(0)).toBe('Nothing needs you right now');
  });
  it('uses the singular at one', () => {
    expect(homeHeadline(1)).toBe('One thing needs you');
  });
  it('uses number words from two to twelve', () => {
    const words = ['Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'];
    words.forEach((w, i) => expect(homeHeadline(i + 2)).toBe(`${w} things need you`));
  });
  it('switches to digits at thirteen', () => {
    expect(homeHeadline(13)).toBe('13 things need you');
  });
  it('numberWord covers 0 to 12 then digits', () => {
    expect(numberWord(0)).toBe('zero');
    expect(numberWord(12)).toBe('twelve');
    expect(numberWord(13)).toBe('13');
  });
});

describe('homeLede', () => {
  it('skips zeros and joins the rest', () => {
    expect(homeLede({ projects: 2, retainers: 1, requests: 3 })).toBe('2 projects, your retainer and 3 requests are moving.');
    expect(homeLede({ projects: 0, retainers: 1, requests: 3 })).toBe('Your retainer and 3 requests are moving.');
  });
  it('uses is for a single singular part', () => {
    expect(homeLede({ projects: 1, retainers: 0, requests: 0 })).toBe('1 project is moving.');
  });
  it('says no work is open when everything is zero', () => {
    expect(homeLede({ projects: 0, retainers: 0, requests: 0 })).toBe('No work is open right now.');
  });
});
