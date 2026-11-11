import { describe, it, expect } from 'vitest';
import { matchEvent, EMPTY_TABLES, type MatchTables } from '../match';
import { ev, guest, me } from './helpers';

const T = (over: Partial<MatchTables> = {}): MatchTables => ({ ...EMPTY_TABLES, ...over });
const contact = (email: string, name: string | null, client_id: string, client_name: string) => ({ email, name, client_id, client_name });
const withGuests = (...g: ReturnType<typeof guest>[]) => ev({ title: 'Call', attendees: [me(), ...g] });

describe('matchEvent order', () => {
  it('team before contact', () => {
    const t = T({ users: [{ email: 'sabeen@becomeindelible.com', name: 'Sabeen Ali' }], contacts: [contact('sabeen@becomeindelible.com', 'S', 'c1', 'VT Standard')] });
    const m = matchEvent(withGuests(guest('sabeen@becomeindelible.com', 'Sabeen')), t);
    expect(m.label).toBe('Sabeen');
    expect(m.client).toBeNull();
    expect(m.people[0].kind).toBe('team');
  });
  it('any own-domain address is team', () => {
    expect(matchEvent(withGuests(guest('x@becomeindelible.com', 'Pat')), T()).people[0].kind).toBe('team');
  });
  it('contact before lead before domain', () => {
    const t = T({
      contacts: [contact('a@vt.org', 'Morgan Ellis', 'c1', 'VT Standard')],
      accords: [{ id: 'a1', lead_email: 'a@vt.org', lead_name: 'Morgan', lead_business_name: 'Other', updated_at: new Date() }],
      domains: [{ name: 'vt.org', client_id: 'c2' }],
    });
    const m = matchEvent(withGuests(guest('a@vt.org')), t);
    expect(m.people[0].kind).toBe('contact');
    expect(m.client?.id).toBe('c1');
    const l = matchEvent(withGuests(guest('e@boot.com', 'Erick')), T({ accords: [{ id: 'a1', lead_email: 'e@boot.com', lead_name: 'Erick', lead_business_name: 'Bootleggers', updated_at: new Date() }], domains: [{ name: 'boot.com', client_id: 'c2' }] }));
    expect(l.people[0].kind).toBe('lead');
    expect(l.label).toBe('Erick, Bootleggers (lead)');
  });
  it('a contact at two clients picks the one with a live project', () => {
    const t = T({ contacts: [contact('a@x.org', 'Pat', 'c1', 'Alpha'), contact('a@x.org', 'Pat', 'c2', 'Zed')], liveClientIds: new Set(['c2']) });
    expect(matchEvent(withGuests(guest('a@x.org')), t).client?.name).toBe('Zed');
  });
  it('then the client of the newest ask from the address, then name', () => {
    const base = { contacts: [contact('a@x.org', 'Pat', 'c1', 'Alpha'), contact('a@x.org', 'Pat', 'c2', 'Zed')] };
    const asked = T({ ...base, addressAsks: [{ from_email: 'a@x.org', client_id: 'c2', received_at: new Date() }] });
    expect(matchEvent(withGuests(guest('a@x.org')), asked).client?.name).toBe('Zed');
    expect(matchEvent(withGuests(guest('a@x.org')), T(base)).client?.name).toBe('Alpha');
  });
  it('free mail never domain matches', () => {
    const t = T({ domains: [{ name: 'gmail.com', client_id: 'c1' }], clients: [{ id: 'c1', name: 'Gmail Co' }] });
    const m = matchEvent(withGuests(guest('jess@gmail.com', 'Jess')), t);
    expect(m.client).toBeNull();
    expect(m.people[0].kind).toBe('none');
  });
  it('two clients on one domain give no domain match; one gives a match', () => {
    const two = T({ domains: [{ name: 'acme.com', client_id: 'c1' }], sites: [{ url: 'https://www.acme.com/', client_id: 'c2' }], clients: [{ id: 'c1', name: 'A' }, { id: 'c2', name: 'B' }] });
    expect(matchEvent(withGuests(guest('x@acme.com', 'X')), two).client).toBeNull();
    const one = T({ domains: [{ name: 'www.acme.com', client_id: 'c1' }], clients: [{ id: 'c1', name: 'Acme Co' }] });
    const m = matchEvent(withGuests(guest('x@acme.com', 'Xavier')), one);
    expect(m.client?.name).toBe('Acme Co');
    expect(m.label).toBe('Xavier, Acme Co');
    expect(m.matched_by).toMatch(/web address/);
  });
  it('another contact at the same domain matches by domain', () => {
    const t = T({ contacts: [contact('boss@acme.com', 'Boss', 'c1', 'Acme Co')] });
    expect(matchEvent(withGuests(guest('new@acme.com', 'New')), t).client?.id).toBe('c1');
  });
});

describe('title match and setup ask', () => {
  const tables = T({
    projects: [{ id: 'p1', name: 'Phil Camp memorial page', client_id: 'c1', client_name: 'VT Standard' }],
    clients: [{ id: 'c1', name: 'VT Standard' }, { id: 'c2', name: 'Home' }, { id: 'c3', name: 'Lunch' }],
  });
  it('a title naming a live project with no attendees matches it', () => {
    const m = matchEvent(ev({ title: 'Call Phil Camp memorial page' }), tables);
    expect(m.client?.name).toBe('VT Standard');
    expect(m.how).toBe('title');
    expect(m.label).toBe('VT Standard');
    expect(m.matched).toBe(true);
  });
  it('Home and Lunch never match, nor do short names', () => {
    expect(matchEvent(ev({ title: 'Home' }), tables).client).toBeNull();
    expect(matchEvent(ev({ title: 'Lunch with Home' }), tables).client).toBeNull();
  });
  it('two project hits give no match', () => {
    const t = T({ projects: [{ id: 'p1', name: 'Alpha site', client_id: 'c1', client_name: 'A' }, { id: 'p2', name: 'Beta site', client_id: 'c2', client_name: 'B' }] });
    expect(matchEvent(ev({ title: 'Alpha site and Beta site' }), t).client).toBeNull();
  });
  it('an unmatched attendee shows beside a title match', () => {
    const m = matchEvent(withGuests(guest('k@kue.io', 'Kue')), T({ ...tables })) ;
    expect(m.client).toBeNull();
    const m2 = matchEvent(ev({ title: 'Phil Camp memorial page', attendees: [me(), guest('k@kue.io', 'Kue')] }), tables);
    expect(m2.label).toBe('Kue, VT Standard');
  });
  it('EmailAsk.calendar_event_id beats everything', () => {
    const e = withGuests(guest('a@vt.org', 'Morgan'));
    const t = T({
      contacts: [contact('a@vt.org', 'Morgan', 'c1', 'VT Standard')],
      eventAsks: [{ calendar_event_id: e.event_id, client_id: 'c9', client_name: 'Setup Co', received_at: new Date() }],
    });
    const m = matchEvent(e, t);
    expect(m.client?.name).toBe('Setup Co');
    expect(m.how).toBe('ask');
    expect(m.also_with).toEqual(['VT Standard']);
    expect(m.matched_by).toMatch(/set up/);
  });
});

describe('labels', () => {
  const vt = T({ contacts: [contact('m@vt.org', 'Morgan Ellis', 'c1', 'VT Standard'), contact('d@vt.org', 'Dan Price', 'c1', 'VT Standard'), contact('x@vt.org', 'Xi Lu', 'c1', 'VT Standard'), contact('y@vt.org', 'Yo Ma', 'c1', 'VT Standard')] });
  it('names the people then the client', () => {
    expect(matchEvent(withGuests(guest('m@vt.org', 'Morgan Ellis'), guest('d@vt.org', 'Dan Price')), vt).label).toBe('Morgan and Dan, VT Standard');
    expect(matchEvent(withGuests(guest('m@vt.org', 'Morgan Ellis'), guest('d@vt.org'), guest('x@vt.org'), guest('y@vt.org')), vt).label).toBe('Morgan, Dan and 2 more, VT Standard');
    expect(matchEvent(withGuests(guest('m@vt.org')), vt).label).toBe('Morgan, VT Standard');
  });
  it('unmatched: display first word, else local part and domain', () => {
    expect(matchEvent(withGuests(guest('k@kue.io', 'Kue')), T()).label).toBe('Kue');
    expect(matchEvent(withGuests(guest('jessica@hartfordarts.org')), T()).label).toBe('jessica, hartfordarts.org');
    expect(matchEvent(withGuests(guest('jess@gmail.com')), T()).label).toBe('jess');
  });
  it('team names show only when nobody else is there', () => {
    const t = T({ users: [{ email: 's@becomeindelible.com', name: 'Sabeen' }], contacts: vt.contacts });
    expect(matchEvent(withGuests(guest('s@becomeindelible.com', 'Sabeen'), guest('m@vt.org', 'Morgan')), t).label).toBe('Morgan, VT Standard');
    expect(matchEvent(withGuests(guest('s@becomeindelible.com', 'Sabeen')), t).label).toBe('Sabeen');
  });
  it('no label contains an @, even from a hostile display name', () => {
    const m = matchEvent(withGuests(guest('a@b.co', 'evil@x.com tricky')), T());
    expect(m.label).not.toContain('@');
    const m2 = matchEvent(withGuests(guest('a@b.co', 'a@b.co')), T());
    expect(m2.label).not.toContain('@');
  });
  it('no attendee and no title match is not matched', () => {
    const m = matchEvent(ev({ title: 'Boys to Robotics' }), T());
    expect(m.matched).toBe(false);
    expect(m.matched_by).toBe('No client or lead matched this meeting.');
  });
});
