import { describe, it, expect } from 'vitest';
import { meetingLinksIn, pickJoin } from '../join';

const base = { meet_url: null, location: null, description: null };

describe('pickJoin', () => {
  it('accepts a Meet link and a Zoom subdomain link', () => {
    expect(pickJoin({ ...base, meet_url: 'https://meet.google.com/abc-defg-hij' })).toEqual({ href: 'https://meet.google.com/abc-defg-hij', label: 'Join on Google Meet' });
    expect(pickJoin({ ...base, meet_url: 'https://acme.zoom.us/j/1' })).toEqual({ href: 'https://acme.zoom.us/j/1', label: 'Join on Zoom' });
  });
  it('refuses http, lookalike hosts, javascript, data and credentials', () => {
    expect(pickJoin({ ...base, location: 'http://zoom.us/j/1' })).toBeNull();
    expect(pickJoin({ ...base, location: 'https://zoom.us.evil.com/j/1' })).toBeNull();
    expect(pickJoin({ ...base, meet_url: 'javascript:alert(1)' })).toBeNull();
    expect(pickJoin({ ...base, meet_url: 'data:text/html,hi' })).toBeNull();
    expect(pickJoin({ ...base, meet_url: 'https://user:pw@meet.google.com/x' })).toBeNull();
    expect(pickJoin({ ...base, description: 'https://notzoom.us/j/1 and https://evilzoom.us/x' })).toBeNull();
  });
  it('meet_url wins over a Zoom link in the description', () => {
    expect(pickJoin({ meet_url: 'https://meet.google.com/aaa', location: null, description: 'Or https://acme.zoom.us/j/9' })?.href).toBe('https://meet.google.com/aaa');
  });
  it('falls back to location, then description, on known hosts', () => {
    expect(pickJoin({ ...base, location: 'Call https://teams.microsoft.com/l/meetup-join/x.', description: 'https://zoom.us/j/2' })?.label).toBe('Join on Teams');
    expect(pickJoin({ ...base, description: '<a href="https://us02web.zoom.us/j/55?pwd=a&amp;b=1">join</a>' })?.href).toBe('https://us02web.zoom.us/j/55?pwd=a&b=1');
  });
  it('a meet_url on another host is used with the plain label', () => {
    expect(pickJoin({ ...base, meet_url: 'https://calls.example.org/r/1' })?.label).toBe('Join the call');
  });
});

describe('meetingLinksIn', () => {
  it('keeps only known hosts, once each', () => {
    const l = meetingLinksIn('https://evil.example/x https://meet.google.com/a https://meet.google.com/a http://zoom.us/j/1');
    expect(l.map((x) => x.href)).toEqual(['https://meet.google.com/a']);
  });
});
