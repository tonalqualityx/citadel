import { describe, it, expect } from 'vitest';
import { ORACLE_SERVICE_EMAIL } from '@/lib/oracle/helpers';
import { ATTACH_LANES, EVIDENCE_LANES, SESSION_LANES, STATE_LANES, attachedByFor, requireWorkCaller } from '../route-auth';

const oracleKey = { role: 'pm', via: 'api_key' as const, email: ORACLE_SERVICE_EMAIL };

describe('requireWorkCaller', () => {
  it('accepts an unlaned oracle service user key wherever the lane list includes oracle', () => {
    for (const lanes of [SESSION_LANES, STATE_LANES, ATTACH_LANES, EVIDENCE_LANES]) {
      expect(() => requireWorkCaller(oracleKey, lanes)).not.toThrow();
    }
  });
  it('matches the address case-insensitively (the existing helper)', () => {
    expect(() => requireWorkCaller({ ...oracleKey, email: ORACLE_SERVICE_EMAIL.toUpperCase() }, SESSION_LANES)).not.toThrow();
  });
  it('refuses the oracle user key on a list without oracle', () => {
    expect(() => requireWorkCaller(oracleKey, ['bast', 'courier'])).toThrow(/Insufficient permissions/);
  });
  it('refuses an unlaned key of any other service user', () => {
    for (const email of ['bast@becomeindelible.com', 'troubador@indelible.bot', 'designer-worker@indelible.bot']) {
      expect(() => requireWorkCaller({ role: 'pm', via: 'api_key', email }, SESSION_LANES)).toThrow(/Insufficient permissions/);
    }
  });
  it('refuses the oracle user when it is not an API key (a session) or has no email', () => {
    expect(() => requireWorkCaller({ role: 'pm', via: 'session', email: ORACLE_SERVICE_EMAIL }, SESSION_LANES)).toThrow();
    expect(() => requireWorkCaller({ role: 'pm' }, SESSION_LANES)).toThrow();
  });
  it('a key with a different lane is still refused, even for the oracle user', () => {
    expect(() => requireWorkCaller({ ...oracleKey, lane: 'courier' }, SESSION_LANES)).toThrow(/Insufficient permissions/);
  });
  it('laned keys and admins are unchanged', () => {
    expect(() => requireWorkCaller({ role: 'pm', lane: 'oracle' }, SESSION_LANES)).not.toThrow();
    expect(() => requireWorkCaller({ role: 'pm', lane: 'porter' }, ATTACH_LANES)).not.toThrow();
    expect(() => requireWorkCaller({ role: 'pm', lane: 'porter' }, SESSION_LANES)).toThrow();
    expect(() => requireWorkCaller({ role: 'admin' }, SESSION_LANES)).not.toThrow();
  });
});

describe('attachedByFor', () => {
  it('an unlaned oracle key is the bast side, not the owner', () => {
    expect(attachedByFor(oracleKey)).toBe('bast');
  });
  it('unchanged for the rest', () => {
    expect(attachedByFor({ role: 'pm', lane: 'porter' })).toBe('intake');
    expect(attachedByFor({ role: 'pm', lane: 'oracle' })).toBe('bast');
    expect(attachedByFor({ role: 'admin', via: 'session' })).toBe('mike');
  });
});
