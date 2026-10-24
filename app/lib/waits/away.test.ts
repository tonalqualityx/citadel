import { describe, it, expect, vi } from 'vitest';
import {
  AWAY_ROLE_OVERRIDES,
  MIKE_ONLY_TEMPLATES,
  awayRoleForWait,
  awayUntil,
  isAway,
  isMikeOnlyWait,
  prismaAwayLookups,
  resumeAfterWindow,
  standInForRole,
  windowCounts,
  type AwayWindowRow,
  type StandInRow,
} from './away';
import { getTemplate } from './templates';
import { zonedTimeToUtc } from './business-days';

const et = (y: number, m: number, d: number, h = 0, mi = 0) => zonedTimeToUtc(y, m, d, h, mi);
const win = (over: Partial<AwayWindowRow> = {}): AwayWindowRow => ({
  user_id: 'mike',
  starts_at: et(2026, 10, 26, 0),
  ends_at: et(2026, 10, 30, 12),
  source: 'manual',
  confirmed_at: null,
  ...over,
});

describe('isAway / awayUntil', () => {
  const inside = et(2026, 10, 28, 9);
  it('is away inside a window, not before or at the end', () => {
    expect(isAway([win()], 'mike', inside)).toBe(true);
    expect(isAway([win()], 'mike', et(2026, 10, 25, 23))).toBe(false);
    expect(isAway([win()], 'mike', et(2026, 10, 30, 12))).toBe(false);
  });
  it('is about one person only', () => {
    expect(isAway([win()], 'sabeen', inside)).toBe(false);
  });
  it('ignores a calendar proposal until it is confirmed', () => {
    expect(windowCounts({ source: 'calendar', confirmed_at: null })).toBe(false);
    expect(isAway([win({ source: 'calendar' })], 'mike', inside)).toBe(false);
    expect(isAway([win({ source: 'calendar', confirmed_at: et(2026, 10, 20) })], 'mike', inside)).toBe(true);
  });
  it('takes the latest end of overlapping windows', () => {
    const later = win({ starts_at: et(2026, 10, 28), ends_at: et(2026, 11, 3, 12) });
    expect(awayUntil([win(), later], 'mike', inside)).toEqual(et(2026, 11, 3, 12));
    expect(awayUntil([win()], 'mike', et(2026, 11, 5))).toBeNull();
  });
});

describe('resumeAfterWindow', () => {
  it('is 17:00 Eastern on the next business day after the end', () => {
    // Friday noon end -> Monday 17:00 (the 2026-11-01 DST change falls in between).
    expect(resumeAfterWindow(et(2026, 10, 30, 12))).toEqual(et(2026, 11, 2, 17));
    expect(resumeAfterWindow(et(2026, 10, 28, 9))).toEqual(et(2026, 10, 29, 17));
  });
});

describe('standInForRole', () => {
  const rows: StandInRow[] = [
    { for_user_id: 'mike', role_key: 'wordpress', stand_in_user_id: 'sabeen' },
    { for_user_id: 'mike', role_key: 'content', stand_in_user_id: 'nils' },
    { for_user_id: 'other', role_key: 'wordpress', stand_in_user_id: 'x' },
  ];
  it('finds by person and role', () => {
    expect(standInForRole(rows, 'mike', 'wordpress')).toBe('sabeen');
    expect(standInForRole(rows, 'mike', 'content')).toBe('nils');
    expect(standInForRole(rows, 'mike', 'pm')).toBeNull();
    expect(standInForRole(rows, 'mike', null)).toBeNull();
  });
});

describe('Mike-only', () => {
  it('lists only real template keys', () => {
    for (const k of MIKE_ONLY_TEMPLATES) expect(getTemplate(k), k).toBeTruthy();
    for (const k of Object.keys(AWAY_ROLE_OVERRIDES)) expect(getTemplate(k), k).toBeTruthy();
  });
  it('covers the card list: all ten sales keys, money, contracts, plans', () => {
    expect(MIKE_ONLY_TEMPLATES.filter((k) => k.startsWith('sales.'))).toHaveLength(10);
    for (const k of ['money.invoice', 'charter.price_review', 'charter.renewal', 'maint.report_monthly', 'switch.off']) {
      expect(isMikeOnlyWait({ template_key: k })).toBe(true);
    }
  });
  it('change.needs_human and handoff.generic are not Mike-only unless the row says so', () => {
    expect(isMikeOnlyWait({ template_key: 'change.needs_human' })).toBe(false);
    expect(isMikeOnlyWait({ template_key: 'change.needs_human', mike_only: false })).toBe(false);
    expect(isMikeOnlyWait({ template_key: 'change.needs_human', mike_only: true })).toBe(true);
    expect(isMikeOnlyWait({ template_key: 'handoff.generic', mike_only: true })).toBe(true);
  });
});

describe('awayRoleForWait', () => {
  it('uses the card override first, then the resolved role, then the wait payload and template', () => {
    expect(awayRoleForWait({ template_key: 'portal.emergency' }, 'mike')).toBe('wordpress');
    expect(awayRoleForWait({ template_key: 'change.needs_human' }, 'wordpress')).toBe('wordpress');
    expect(awayRoleForWait({ template_key: 'change.needs_human', action_payload: { owner_role: 'wordpress' } }, null)).toBe('wordpress');
    expect(awayRoleForWait({ template_key: 'build.review_internal' }, null)).toBe('content');
  });
  it('a client-owned wait is covered by its shepherd, the liaison by default', () => {
    expect(awayRoleForWait({ template_key: 'launch.d90', action_payload: { owner_role: 'client' } }, null)).toBe('liaison');
    expect(awayRoleForWait({ template_key: 'launch.d90', action_payload: { owner_role: 'client', shepherd_role: 'pm' } }, null)).toBe('pm');
  });
});

describe('prismaAwayLookups', () => {
  it('queries nothing until asked, and each table once per pass', async () => {
    const db = { awayWindow: { findMany: vi.fn(async () => []) }, standIn: { findMany: vi.fn(async () => []) } };
    const l = prismaAwayLookups(db);
    expect(db.awayWindow.findMany).not.toHaveBeenCalled();
    expect(db.standIn.findMany).not.toHaveBeenCalled();
    await l.windowsActiveAt(new Date());
    await l.windowsActiveAt(new Date());
    await l.standIns();
    expect(db.awayWindow.findMany).toHaveBeenCalledTimes(1);
    expect(db.standIn.findMany).toHaveBeenCalledTimes(1);
  });
});
