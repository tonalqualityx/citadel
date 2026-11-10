import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { addBusinessDays } from '@/lib/waits/business-days';
import {
  AUTOMATED_SENDER_PATTERNS,
  CALENDAR_SUBJECT_PREFIXES,
  CAPS,
  CLOSED_TASK_STATUSES,
  EXCLUDED_PROJECT_STATUSES,
  EXCLUDED_SESSION_STATUSES,
  HELD_PROJECT_STATUSES,
  IMPORTANCE,
  NOISE_CLIENT_NAMES,
  NOISE_SENDER_DOMAINS,
  NOT_NOW,
  OPEN_WAIT_STATES,
  OWN_ADDRESSES,
  THREAD_MAX_AGE_DAYS,
  URGENCY,
  VENTURE_NAMES,
  businessDaysElapsed,
  businessDaysUntil,
  crisisEmergencyRule,
  emailDomain,
  hardDateOf,
  hasClientBlockingTag,
  hasLifelineTag,
  hasMoneyOrLifelineTag,
  hasSecurityTag,
  isAutomatedSender,
  isCalendarSubject,
  isNoise,
  isNoiseClientName,
  isNoiseSender,
  isOwnAddress,
  isPersonMessage,
  isVenture,
  normalizeEmail,
  sessionEmergencyRule,
  taskEmergencyRule,
  waitEmergencyRule,
  type TaskEmergencyFields,
} from '../rules';
import type { HomeActName, HomeActRequest } from '../types';

// New York is UTC-5 after 2026-11-01. 2026-11-09 is a Monday.
const et = (isoLocal: string) => new Date(`${isoLocal}-05:00`);
const NOW = et('2026-11-10T10:00:00'); // Tuesday 10:00
const CLIENT = { id: 'c1', name: 'Grok of the Rock' };

function task(over: Partial<TaskEmergencyFields> = {}): TaskEmergencyFields {
  return { tags: [], site_id: null, client: null, due_date: null, promised_to: null, ...over };
}

describe('constants match plan 1.3', () => {
  it('caps, windows and the Not now ladder', () => {
    expect(CAPS.quick).toBe(3);
    expect(CAPS.mail).toBe(3);
    expect(CAPS.next).toBe(3);
    expect(CAPS.arcSteps).toBe(4);
    expect(CAPS.handled).toBe(5);
    expect(CAPS.visibleActions).toBe(3);
    expect(THREAD_MAX_AGE_DAYS).toBe(21);
    expect(NOT_NOW).toEqual({ firstReturnHour: 9, secondReturnDays: 7, choicesOnlyAtParkCount: 3 });
  });

  it('source filters', () => {
    expect([...CLOSED_TASK_STATUSES]).toEqual(['done', 'abandoned']);
    expect([...EXCLUDED_PROJECT_STATUSES]).toEqual(['quote', 'queue', 'suspended', 'cancelled', 'done']);
    expect(HELD_PROJECT_STATUSES.every((s) => (EXCLUDED_PROJECT_STATUSES as readonly string[]).includes(s))).toBe(true);
    expect([...EXCLUDED_SESSION_STATUSES]).toEqual(['ended', 'stale']);
    expect([...OPEN_WAIT_STATES]).toEqual(['waiting', 'needs_human', 'blocked_by_switch']);
  });

  it('noise, own addresses, automated senders, calendar subjects and ventures', () => {
    expect([...NOISE_SENDER_DOMAINS]).toEqual(['collectiveyouth.com', 'wol.org']);
    expect([...NOISE_CLIENT_NAMES]).toEqual(['Balloon Guild', 'Cygal', 'Word of Life']);
    expect(OWN_ADDRESSES).toHaveLength(5);
    expect(OWN_ADDRESSES.every((a) => a === a.toLowerCase())).toBe(true);
    expect(AUTOMATED_SENDER_PATTERNS).toHaveLength(10);
    expect(CALENDAR_SUBJECT_PREFIXES).toHaveLength(5);
    expect([...VENTURE_NAMES]).toEqual(['Saiph', 'KNT', 'Kava News', 'Zorp', 'Schoolhouse']);
  });

  it('importance parts sum to at most the max, and caps are consistent', () => {
    const top = IMPORTANCE.base + IMPORTANCE.clientTrust.cap + IMPORTANCE.money.cap + IMPORTANCE.unblocks.cap;
    expect(top).toBe(IMPORTANCE.max);
    expect(IMPORTANCE.ventureCap).toBe(20);
  });

  it('urgency ladders run in the order their readers expect', () => {
    const w = URGENCY.waiting.map((s) => s.minBusinessDays);
    expect(w).toEqual([...w].sort((a, b) => b - a));
    expect(w[w.length - 1]).toBe(0);
    const h = URGENCY.hardDate.steps.map((s) => s.maxBusinessDays);
    expect(h).toEqual([...h].sort((a, b) => a - b));
  });
});

describe('address predicates', () => {
  it('normalizes addresses', () => {
    expect(normalizeEmail('  Mike Dion <Mike@BecomeIndelible.com> ')).toBe('mike@becomeindelible.com');
    expect(normalizeEmail(null)).toBe('');
    expect(emailDomain('a@Sub.WOL.org')).toBe('sub.wol.org');
    expect(emailDomain('nobody')).toBe('');
  });

  it('own addresses, any case', () => {
    expect(isOwnAddress('MIKE@becomeindelible.com')).toBe(true);
    expect(isOwnAddress('bast@becomeindelible.com')).toBe(true);
    expect(isOwnAddress('jessica@northstar.example')).toBe(false);
    expect(isOwnAddress('')).toBe(false);
  });

  it('noise by sender domain, subdomains included, look-alikes excluded', () => {
    expect(isNoiseSender('alerts@collectiveyouth.com')).toBe(true);
    expect(isNoiseSender('x@mail.wol.org')).toBe(true);
    expect(isNoiseSender('x@notcollectiveyouth.com')).toBe(false);
    expect(isNoiseSender('x@wol.org.example')).toBe(false);
  });

  it('noise by client name, whole words, any case', () => {
    expect(isNoiseClientName('Word of Life Fellowship')).toBe(true);
    expect(isNoiseClientName('balloon guild')).toBe(true);
    expect(isNoiseClientName('Cygal')).toBe(true);
    expect(isNoiseClientName('Cygalle Studio')).toBe(false);
    expect(isNoiseClientName(null)).toBe(false);
    expect(isNoise({ from_email: 'a@b.c', client_name: 'Cygal' })).toBe(true);
    expect(isNoise({ from_email: 'a@b.c', client_name: 'North Star Health' })).toBe(false);
  });

  it('automated senders by local part or domain', () => {
    for (const a of [
      'no-reply@x.com',
      'noreply@github.com',
      'notifications@stripe.com',
      'servers@wpmudev.com',
      'uptime@kuma.local',
      'drive-shares-dm-noreply@google.com',
      'MAILER-DAEMON@googlemail.com',
      'calendar-notification@google.com',
      'wordpress@client.org',
      'hub@wpmudev.org',
    ]) {
      expect(isAutomatedSender(a)).toBe(true);
    }
    expect(isAutomatedSender('andy@echograce.org')).toBe(false);
  });

  it('calendar subjects by prefix, any case', () => {
    expect(isCalendarSubject('Accepted: Call with Erick')).toBe(true);
    expect(isCalendarSubject('updated invitation: Kickoff')).toBe(true);
    expect(isCalendarSubject('Tentatively yes')).toBe(true);
    expect(isCalendarSubject('Re: Accepted: Call')).toBe(false);
    expect(isCalendarSubject('Checking In')).toBe(false);
  });

  it('person message combines the sender and subject rules', () => {
    expect(isPersonMessage({ from_email: 'jessica@northstar.example', subject: 'Checking In' })).toBe(true);
    expect(isPersonMessage({ from_email: 'mike@becomeindelible.com', subject: 'Checking In' })).toBe(false);
    expect(isPersonMessage({ from_email: 'noreply@x.com', subject: 'Hi' })).toBe(false);
    expect(isPersonMessage({ from_email: 'a@wol.org', subject: 'Hi' })).toBe(false);
    expect(isPersonMessage({ from_email: 'a@b.c', subject: 'Hi', client_name: 'Balloon Guild' })).toBe(false);
    expect(isPersonMessage({ from_email: 'a@b.c', subject: 'Invitation: Call' })).toBe(false);
    expect(isPersonMessage({ from_email: '', subject: 'Hi' })).toBe(false);
  });

  it('ventures by client or project name, whole words', () => {
    expect(isVenture({ client_name: 'Saiph Grants' })).toBe(true);
    expect(isVenture({ project_name: 'KNT article: Drink Yum' })).toBe(true);
    expect(isVenture({ client_name: 'kava news today' })).toBe(true);
    expect(isVenture({ project_name: 'Zorp games portal' })).toBe(true);
    expect(isVenture({ client_name: 'Knight Logistics' })).toBe(false);
    expect(isVenture({ client_name: 'North Star Health', project_name: 'Accessibility' })).toBe(false);
    expect(isVenture({})).toBe(false);
  });
});

describe('tag predicates and hard dates', () => {
  it('reads tags case-insensitively', () => {
    expect(hasSecurityTag(['Security'])).toBe(true);
    expect(hasSecurityTag(['security-report'])).toBe(true);
    expect(hasSecurityTag(['securityish'])).toBe(false);
    expect(hasLifelineTag(['lifeline'])).toBe(true);
    expect(hasLifelineTag(['job-watch'])).toBe(true);
    expect(hasLifelineTag(['job-watch:claude-signin'])).toBe(true);
    expect(hasLifelineTag(['watch-job'])).toBe(false);
    expect(hasClientBlockingTag(['client-blocking'])).toBe(true);
    expect(hasMoneyOrLifelineTag(['security'])).toBe(true);
    expect(hasMoneyOrLifelineTag(['kind:content'])).toBe(false);
    expect(hasSecurityTag(null)).toBe(false);
  });

  it('a due date is hard only with promised_to or a lifeline tag', () => {
    const due = et('2026-11-14T12:00:00');
    expect(hardDateOf({ due_date: due, promised_to: null, tags: [] })).toBeNull();
    expect(hardDateOf({ due_date: due, promised_to: '  ', tags: [] })).toBeNull();
    expect(hardDateOf({ due_date: due, promised_to: 'Gene Roberts', tags: [] })).toBe(due);
    expect(hardDateOf({ due_date: due, promised_to: null, tags: ['job-watch'] })).toBe(due);
    expect(hardDateOf({ due_date: null, promised_to: 'Gene', tags: ['lifeline'] })).toBeNull();
  });
});

describe('businessDaysUntil (New York civil dates)', () => {
  it('counts business days after today up to the target', () => {
    expect(businessDaysUntil(et('2026-11-10T20:00:00'), NOW)).toBe(0); // later today
    expect(businessDaysUntil(et('2026-11-11T09:00:00'), NOW)).toBe(1); // Wednesday
    expect(businessDaysUntil(et('2026-11-12T09:00:00'), NOW)).toBe(2); // Thursday
    expect(businessDaysUntil(et('2026-11-13T09:00:00'), NOW)).toBe(3); // Friday
    expect(businessDaysUntil(et('2026-11-14T12:00:00'), NOW)).toBe(3); // Saturday
    expect(businessDaysUntil(et('2026-11-16T09:00:00'), NOW)).toBe(4); // next Monday
  });

  it('is negative for any past date', () => {
    expect(businessDaysUntil(et('2026-11-09T12:00:00'), NOW)).toBe(-1);
    expect(businessDaysUntil(et('2026-11-06T12:00:00'), NOW)).toBe(-2);
    expect(businessDaysUntil(et('2026-11-07T12:00:00'), et('2026-11-08T12:00:00'))).toBe(-1); // Sat seen on Sun
  });

  it('reads the date in New York, so midnight UTC is the evening before', () => {
    expect(businessDaysUntil(new Date('2026-11-14T00:00:00Z'), NOW)).toBe(3); // Friday 19:00 in New York
    expect(businessDaysUntil(new Date('2026-11-12T00:00:00Z'), NOW)).toBe(1); // Wednesday 19:00
  });
});

describe('businessDaysElapsed (the wait clock)', () => {
  it('counts whole business days, each ending at 17:00 New York', () => {
    const since = et('2026-11-09T10:00:00'); // Monday 10:00
    expect(businessDaysElapsed(since, et('2026-11-09T16:00:00'))).toBe(0);
    expect(businessDaysElapsed(since, et('2026-11-09T17:30:00'))).toBe(0);
    expect(businessDaysElapsed(since, et('2026-11-10T16:59:00'))).toBe(0);
    expect(businessDaysElapsed(since, et('2026-11-10T17:00:00'))).toBe(1);
    expect(businessDaysElapsed(since, et('2026-11-16T17:00:00'))).toBe(5);
  });

  it('starts the next business day after 17:00 or on a weekend', () => {
    expect(businessDaysElapsed(et('2026-11-06T18:00:00'), et('2026-11-10T17:00:00'))).toBe(1); // Fri evening
    expect(businessDaysElapsed(et('2026-11-07T10:00:00'), et('2026-11-10T17:00:00'))).toBe(1); // Saturday
  });

  it('is 0 for a future start', () => {
    expect(businessDaysElapsed(et('2026-11-12T10:00:00'), NOW)).toBe(0);
  });

  it('agrees with addBusinessDays across a grid, the November clock change included', () => {
    const start = Date.parse('2026-10-26T03:00:00Z');
    for (let s = 0; s < 21 * 24; s += 7) {
      const since = new Date(start + s * 3_600_000);
      for (let h = 1; h < 24 * 24; h += 11) {
        const now = new Date(since.getTime() + h * 3_600_000);
        const n = businessDaysElapsed(since, now);
        expect(addBusinessDays(since, n + 1).getTime()).toBeGreaterThan(now.getTime());
        if (n > 0) expect(addBusinessDays(since, n).getTime()).toBeLessThanOrEqual(now.getTime());
      }
    }
  });
});

describe('emergency predicates (plan 1.3 rules 1 to 7)', () => {
  it('rule 1: security tag with a site or a client', () => {
    expect(taskEmergencyRule(task({ tags: ['security'], client: CLIENT }), NOW)).toBe('security');
    expect(taskEmergencyRule(task({ tags: ['security-report'], site_id: 's1' }), NOW)).toBe('security');
    expect(taskEmergencyRule(task({ tags: ['security'] }), NOW)).toBeNull();
  });

  it('rule 2: lifeline or job-watch*', () => {
    expect(taskEmergencyRule(task({ tags: ['job-watch', 'job-watch:claude-signin'] }), NOW)).toBe('lifeline');
    expect(taskEmergencyRule(task({ tags: ['lifeline'] }), NOW)).toBe('lifeline');
  });

  it('rule 3: client-blocking tag', () => {
    expect(taskEmergencyRule(task({ tags: ['client-blocking'] }), NOW)).toBe('client_blocking_tag');
  });

  it('rule 7: a promised date 2 business days away or less, or past', () => {
    const promised = { promised_to: 'Gene Roberts' };
    expect(taskEmergencyRule(task({ ...promised, due_date: et('2026-11-12T12:00:00') }), NOW)).toBe('promised_date');
    expect(taskEmergencyRule(task({ ...promised, due_date: et('2026-11-03T12:00:00') }), NOW)).toBe('promised_date');
    expect(taskEmergencyRule(task({ ...promised, due_date: et('2026-11-13T12:00:00') }), NOW)).toBeNull();
    expect(taskEmergencyRule(task({ due_date: et('2026-11-11T12:00:00') }), NOW)).toBeNull(); // his own date
  });

  it('a plain task is no emergency', () => {
    expect(taskEmergencyRule(task({ tags: ['kind:content'], client: CLIENT, site_id: 's1' }), NOW)).toBeNull();
  });

  it('rule 4: client-blocking wait, client waiting more than 1 business day', () => {
    expect(waitEmergencyRule({ blocks_client: true, client_waiting_since: et('2026-11-06T10:00:00') }, NOW)).toBe('client_waiting');
    expect(waitEmergencyRule({ blocks_client: true, client_waiting_since: et('2026-11-09T10:00:00') }, NOW)).toBeNull();
    expect(waitEmergencyRule({ blocks_client: true, client_waiting_since: et('2026-11-09T10:00:00') }, et('2026-11-10T17:00:00'))).toBe(
      'client_waiting'
    );
    expect(waitEmergencyRule({ blocks_client: true, client_waiting_since: null }, NOW)).toBeNull();
    expect(waitEmergencyRule({ blocks_client: false, client_waiting_since: et('2026-10-01T10:00:00') }, NOW)).toBeNull();
  });

  it('rule 5: session ask with severity client_blocking only', () => {
    expect(sessionEmergencyRule({ ask_severity: 'client_blocking' })).toBe('session_client_blocking');
    expect(sessionEmergencyRule({ ask_severity: 'launch_blocking' })).toBeNull();
    expect(sessionEmergencyRule({ ask_severity: null })).toBeNull();
  });

  it('rule 6: open urgent mail, sender and client not noise', () => {
    const base = { is_urgent: true, state: 'open' as const, from_email: 'monitor@jillscafe.net', client: null };
    expect(crisisEmergencyRule(base)).toBe('crisis_mail');
    expect(crisisEmergencyRule({ ...base, from_email: 'alerts@collectiveyouth.com' })).toBeNull();
    expect(crisisEmergencyRule({ ...base, client: { id: 'c', name: 'Word of Life' } })).toBeNull();
    expect(crisisEmergencyRule({ ...base, state: 'handled' })).toBeNull();
    expect(crisisEmergencyRule({ ...base, is_urgent: false })).toBeNull();
  });
});

describe('contract guards', () => {
  const dir = path.resolve(__dirname, '..');
  const read = (f: string) => fs.readFileSync(path.join(dir, f), 'utf8');
  const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

  it('no em dash or en dash anywhere in the H3 files', () => {
    for (const f of ['types.ts', 'item-key.ts', 'plain-text.ts', 'rules.ts']) {
      expect({ f, dash: /[–—]/.test(read(f)) }).toEqual({ f, dash: false });
    }
  });

  it('rules.ts code never says priority or overdue', () => {
    expect(stripComments(read('rules.ts'))).not.toMatch(/priority|overdue/i);
  });

  it('nothing the browser receives has a score, class, quadrant, priority or rule field', () => {
    const src = read('types.ts');
    const browserPart = src.slice(0, src.indexOf('// C. Loader inputs'));
    expect(browserPart.length).toBeGreaterThan(1000);
    const names = [...stripComments(browserPart).matchAll(/^\s*(?:readonly\s+)?([A-Za-z_][A-Za-z0-9_]*)\??\s*:/gm)].map((m) => m[1]);
    expect(names).toContain('why_now');
    expect(names.filter((n) => /score|class|quadrant|priority|importance|urgency|rule|rank/i.test(n))).toEqual([]);
  });

  it('the act request union covers every home-only action, arc edits and create-and-add included', () => {
    const t = 'task:7aa4a01a-1111-4222-8333-944445555666';
    const g = 'arc:7aa4a01a-1111-4222-8333-944445555666';
    const every: { [K in HomeActName]: Extract<HomeActRequest, { action: K }> } = {
      not_now: { action: 'not_now', item_key: t },
      matters_more: { action: 'matters_more', item_key: t },
      not_emergency: { action: 'not_emergency', item_key: t },
      pin: { action: 'pin', item_key: t, switch: true },
      stop: { action: 'stop', item_key: t, note: 'Left off at the footer.' },
      done_pin: { action: 'done_pin', item_key: t },
      arc_add: { action: 'arc_add', item_key: t, group_key: g, origin: 'created' },
      arc_remove: { action: 'arc_remove', item_key: t, group_key: g },
      arc_reorder: { action: 'arc_reorder', group_key: g, step_keys: [t] },
      swap: { action: 'swap', to_group_key: 'own' },
      lighter: { action: 'lighter', to_group_key: 'own' },
      record: { action: 'record', item_key: t, did: 'done' },
    };
    for (const [name, req] of Object.entries(every)) expect(req.action).toBe(name);
  });
});
