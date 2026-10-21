import { describe, it, expect } from 'vitest';
import { embedUrl, getMeetingTypes, isCalendlyUrl, isMeetingTypeKey, MEETING_TYPE_KEYS } from '../booking';

describe('getMeetingTypes', () => {
  it('lists consult, marketing and questions in order', () => {
    expect(getMeetingTypes({}).map((t) => t.key)).toEqual([...MEETING_TYPE_KEYS]);
  });

  it('marketing defaults to the router routing table Marketing Meeting URL; others are placeholders', () => {
    const byKey = Object.fromEntries(getMeetingTypes({}).map((t) => [t.key, t.url]));
    expect(byKey.marketing).toBe('https://calendly.com/indelible-mike/marketing-meeting');
    expect(byKey.consult).toBeNull();
    expect(byKey.questions).toBeNull();
  });

  it('env overrides set a type, and placeholder or non-Calendly values are refused', () => {
    const types = getMeetingTypes({
      CALENDLY_URL_CONSULT: 'https://calendly.com/indelible-mike/consult',
      CALENDLY_URL_QUESTIONS: 'https://calendly.com/PLACEHOLDER',
      CALENDLY_URL_MARKETING: 'https://evil.example/marketing',
    });
    const byKey = Object.fromEntries(types.map((t) => [t.key, t.url]));
    expect(byKey.consult).toBe('https://calendly.com/indelible-mike/consult');
    expect(byKey.questions).toBeNull();
    // A bad override falls back to the routing-table default rather than embedding a foreign host.
    expect(byKey.marketing).toBe('https://calendly.com/indelible-mike/marketing-meeting');
  });
});

describe('isCalendlyUrl', () => {
  it('accepts only https calendly.com', () => {
    expect(isCalendlyUrl('https://calendly.com/a/b')).toBe(true);
    expect(isCalendlyUrl('http://calendly.com/a/b')).toBe(false);
    expect(isCalendlyUrl('https://calendly.com.evil.example/a')).toBe(false);
    expect(isCalendlyUrl('https://user:pw@calendly.com/a')).toBe(false);
    expect(isCalendlyUrl('javascript:alert(1)')).toBe(false);
    expect(isCalendlyUrl('')).toBe(false);
    expect(isCalendlyUrl(null)).toBe(false);
  });
});

describe('helpers', () => {
  it('isMeetingTypeKey', () => {
    expect(isMeetingTypeKey('consult')).toBe(true);
    expect(isMeetingTypeKey('sales')).toBe(false);
  });
  it('embedUrl keeps the path and adds the embed option', () => {
    expect(embedUrl('https://calendly.com/a/b')).toBe('https://calendly.com/a/b?hide_gdpr_banner=1');
  });
});
