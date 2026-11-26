import { describe, it, expect } from 'vitest';
import { resolveWaitingOnSince, sessionAskSince } from '../session-ask-since';

const now = new Date('2026-11-26T23:30:00.000Z');
const asked = new Date('2026-11-09T16:12:42.000Z');

describe('sessionAskSince', () => {
  it('prefers when the ask was set over any activity time', () => {
    expect(sessionAskSince({ waiting_on_since: asked, last_event_at: now, updated_at: now, created_at: now })).toEqual(asked);
  });
  it('falls back to last activity, then updated, then created', () => {
    expect(sessionAskSince({ waiting_on_since: null, last_event_at: now })).toEqual(now);
    expect(sessionAskSince({ updated_at: asked })).toEqual(asked);
    expect(sessionAskSince({ created_at: asked })).toEqual(asked);
    expect(sessionAskSince({})).toBeNull();
  });
});

describe('resolveWaitingOnSince', () => {
  it('leaves it alone when the snapshot says nothing about the ask', () => {
    expect(resolveWaitingOnSince({ existing_waiting_on: 'a', incoming_waiting_on: undefined, incoming_since: undefined, now })).toBeUndefined();
  });
  it('clears it when the ask is cleared or blank', () => {
    expect(resolveWaitingOnSince({ existing_waiting_on: 'a', incoming_waiting_on: null, incoming_since: undefined, now })).toBeNull();
    expect(resolveWaitingOnSince({ existing_waiting_on: 'a', incoming_waiting_on: '   ', incoming_since: asked, now })).toBeNull();
  });
  it('an unchanged ask keeps the earlier stored time when the heartbeat sends a later one', () => {
    const later = new Date('2026-11-20T00:00:00.000Z');
    expect(resolveWaitingOnSince({ existing_waiting_on: 'a', existing_since: asked, incoming_waiting_on: 'a', incoming_since: later, now })).toBeUndefined();
    expect(resolveWaitingOnSince({ existing_waiting_on: 'a', existing_since: later, incoming_waiting_on: 'a', incoming_since: asked, now })).toEqual(asked);
    expect(resolveWaitingOnSince({ existing_waiting_on: 'a', existing_since: asked, incoming_waiting_on: 'b', incoming_since: later, now })).toEqual(later);
  });
  it('takes the time the heartbeat sent, never later than now', () => {
    expect(resolveWaitingOnSince({ existing_waiting_on: 'a', incoming_waiting_on: 'a', incoming_since: asked, now })).toEqual(asked);
    const future = new Date(now.getTime() + 60_000);
    expect(resolveWaitingOnSince({ existing_waiting_on: null, incoming_waiting_on: 'b', incoming_since: future, now })).toEqual(now);
  });
  it('dates a changed ask now and never re-dates the same ask', () => {
    expect(resolveWaitingOnSince({ existing_waiting_on: 'a', incoming_waiting_on: 'b', incoming_since: undefined, now })).toEqual(now);
    expect(resolveWaitingOnSince({ existing_waiting_on: null, incoming_waiting_on: 'b', incoming_since: null, now })).toEqual(now);
    expect(resolveWaitingOnSince({ existing_waiting_on: 'same  ask', incoming_waiting_on: ' same ask', incoming_since: undefined, now })).toBeUndefined();
  });
  it('a time with no ask in the snapshot dates only an ask already stored', () => {
    expect(resolveWaitingOnSince({ existing_waiting_on: 'a', incoming_waiting_on: undefined, incoming_since: asked, now })).toEqual(asked);
    expect(resolveWaitingOnSince({ existing_waiting_on: null, incoming_waiting_on: undefined, incoming_since: asked, now })).toBeUndefined();
  });
});
