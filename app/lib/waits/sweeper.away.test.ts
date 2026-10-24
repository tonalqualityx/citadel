import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { runSweep, resolveWaitOwner, type WaitRow } from './sweeper';
import { zonedTimeToUtc } from './business-days';
import { buildWaitData, type WaitInput } from './templates';
import { MIKE_USER_ID, type OwnerLookups } from './owner';
import { prismaAwayLookups, type AwayLookups, type AwayWindowRow, type StandInRow } from './away';
import { MemStore } from './testing-mem-store';

const et = (y: number, m: number, d: number, h = 0, mi = 0) => zonedTimeToUtc(y, m, d, h, mi);
// Wed 2026-10-21 10:00 Eastern. Mike is away Mon 10-19 to Fri 10-23 noon; back Mon 10-26 17:00 + the rule.
const NOW = et(2026, 10, 21, 10);
const SABEEN = 'b565b492-cdea-497b-a13d-85f003916bf9';
const NILS = '5b98dcb5-93a1-4147-82b7-f462c9ea09ae';
const ANGELA = 'cc61d6d4-9352-496b-9cd4-8a45f474082a';
const WINDOW_END = et(2026, 10, 23, 12);

const MAP: StandInRow[] = [
  { for_user_id: MIKE_USER_ID, role_key: 'wordpress', stand_in_user_id: SABEEN },
  { for_user_id: MIKE_USER_ID, role_key: 'content', stand_in_user_id: NILS },
  { for_user_id: MIKE_USER_ID, role_key: 'liaison', stand_in_user_id: ANGELA },
  { for_user_id: MIKE_USER_ID, role_key: 'sales', stand_in_user_id: ANGELA },
];
const WINDOW: AwayWindowRow = {
  user_id: MIKE_USER_ID,
  starts_at: et(2026, 10, 19, 0),
  ends_at: WINDOW_END,
  source: 'manual',
  confirmed_at: null,
};

function away(windows: AwayWindowRow[] = [WINDOW], standIns: StandInRow[] = MAP) {
  const calls = { windows: 0, standIns: 0 };
  const lookups: AwayLookups & { calls: typeof calls } = {
    calls,
    windowsActiveAt: async (at) => {
      calls.windows++;
      return windows.filter((w) => w.starts_at <= at && at < w.ends_at);
    },
    standIns: async () => {
      calls.standIns++;
      return standIns;
    },
  };
  return lookups;
}

const lookups = (over: Partial<OwnerLookups> = {}): OwnerLookups => ({
  isActiveUser: async () => true,
  functionName: async () => null,
  projectRoleHolder: async () => null,
  charterRoleHolder: async () => null,
  clientRoleHolder: async () => null,
  accordOwner: async () => null,
  ...over,
});

function deps(store: MemStore, a: AwayLookups | undefined, over: Record<string, unknown> = {}) {
  return { store, owner: lookups(), switchIsOn: async () => false, now: () => NOW, away: a, ...over };
}

function open(store: MemStore, input: WaitInput, extra: Partial<WaitRow> = {}) {
  return store.add(buildWaitData({ owner_user_id: MIKE_USER_ID, started_at: NOW, ...input }, { allowDisabled: true }), extra);
}

const ORIGINAL = process.env.OOO_STANDINS;
beforeEach(() => {
  process.env.OOO_STANDINS = 'true';
});
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.OOO_STANDINS;
  else process.env.OOO_STANDINS = ORIGINAL;
});

describe('OOO_STANDINS on: routing by role', () => {
  it('hands each of Mike\'s waits to the stand-in for its role and keeps the due date', async () => {
    const store = new MemStore();
    const wp = open(store, { template_key: 'change.needs_human', subject: 'the plugin question' });
    const content = open(store, { template_key: 'build.review_internal', subject: 'the sitemap' });
    const client = open(store, { template_key: 'portal.client_reply', subject: 'Dan', client_id: 'c1' });
    const dues = new Map([wp, content, client].map((w) => [w.id, w.due_at]));
    const a = away();
    const r = await runSweep(deps(store, a));
    expect(store.get(wp.id).stand_in_user_id).toBe(SABEEN);
    expect(store.get(content.id).stand_in_user_id).toBe(NILS);
    expect(store.get(client.id).stand_in_user_id).toBe(ANGELA);
    for (const [id, due] of dues) expect(store.get(id).due_at).toEqual(due);
    expect(r.away?.routed).toHaveLength(3);
    const ev = store.events.filter((e) => e.kind === 'stand_in');
    expect(ev).toHaveLength(3);
    expect(ev.every((e) => e.source === 'ooo')).toBe(true);
    // the owner resolver now lands on the stand-in
    expect((await resolveWaitOwner(store.get(wp.id), lookups())).user_id).toBe(SABEEN);
  });

  it('applies the card override: the emergency goes to the WordPress stand-in', async () => {
    const store = new MemStore();
    const w = open(store, { template_key: 'portal.emergency', subject: 'site down', client_id: 'c1' });
    await runSweep(deps(store, away()));
    expect(store.get(w.id).stand_in_user_id).toBe(SABEEN);
  });

  it('does nothing when the owner is not away', async () => {
    const store = new MemStore();
    const w = open(store, { template_key: 'change.needs_human', subject: 'x' });
    await runSweep(deps(store, away([{ ...WINDOW, ends_at: et(2026, 10, 20, 0) }])));
    expect(store.get(w.id).stand_in_user_id).toBeNull();
  });

  it('ignores an unconfirmed calendar proposal', async () => {
    const store = new MemStore();
    const w = open(store, { template_key: 'change.needs_human', subject: 'x' });
    await runSweep(deps(store, away([{ ...WINDOW, source: 'calendar' }])));
    expect(store.get(w.id).stand_in_user_id).toBeNull();
  });

  it('an inactive stand-in falls through to the normal order', async () => {
    const store = new MemStore();
    const w = open(store, { template_key: 'change.needs_human', subject: 'x' });
    const owner = lookups({ isActiveUser: async (id) => id !== SABEEN });
    await runSweep(deps(store, away(), { owner }));
    expect(store.get(w.id).stand_in_user_id).toBeNull();
    expect((await resolveWaitOwner(store.get(w.id), owner)).user_id).toBe(MIKE_USER_ID);
  });

  it('does not route to a stand-in who is away too', async () => {
    const store = new MemStore();
    const wp = open(store, { template_key: 'change.needs_human', subject: 'x' });
    await runSweep(deps(store, away([WINDOW, { ...WINDOW, user_id: SABEEN }])));
    expect(store.get(wp.id).stand_in_user_id).toBeNull();
  });

  it('does not route a role nobody was named for', async () => {
    const store = new MemStore();
    const w = open(store, { template_key: 'marketing.horizon', subject: 'x', due_at: et(2026, 11, 20, 17) }); // pm role, no pm row in MAP
    await runSweep(deps(store, away()));
    expect(store.get(w.id).stand_in_user_id).toBeNull();
    expect(store.get(w.id).state).toBe('waiting');
  });

  it('is idempotent: a second pass writes no new events', async () => {
    const store = new MemStore();
    open(store, { template_key: 'change.needs_human', subject: 'x' });
    await runSweep(deps(store, away()));
    const n = store.events.length;
    await runSweep(deps(store, away()));
    expect(store.events).toHaveLength(n);
  });

  it('a dry run reports and writes nothing', async () => {
    const store = new MemStore();
    const w = open(store, { template_key: 'change.needs_human', subject: 'x' });
    const r = await runSweep(deps(store, away()), { dryRun: true });
    expect(r.away?.routed).toEqual([{ id: w.id, to: SABEEN, role: 'wordpress' }]);
    expect(store.get(w.id).stand_in_user_id).toBeNull();
    expect(store.events).toHaveLength(0);
  });
});

describe('OOO_STANDINS on: Mike-only pauses', () => {
  const RESUME = et(2026, 10, 26, 17); // window ends Fri noon; plus one business day = Monday 17:00 Eastern

  it('pauses a Mike-only template until the window ends plus one business day, and never routes it', async () => {
    const store = new MemStore();
    const w = open(store, { template_key: 'sales.proposal_review', subject: 'the Dan proposal' });
    // Even a stand-in row for the sales role must not catch it.
    const r = await runSweep(deps(store, away()));
    const row = store.get(w.id);
    expect(row.state).toBe('paused');
    expect(row.paused_until).toEqual(RESUME);
    expect(row.stand_in_user_id).toBeNull();
    expect(row.paused_remaining_ms).not.toBeNull();
    expect(r.away?.paused).toEqual([{ id: w.id, until: RESUME.toISOString(), why: 'mike_only' }]);
    expect(store.events.find((e) => e.kind === 'paused')).toMatchObject({ source: 'ooo', from_state: 'waiting', to_state: 'paused' });
  });

  it('a row marked mike_only is paused, not routed, even on a routable template', async () => {
    const store = new MemStore();
    const w = open(store, { template_key: 'change.needs_human', subject: 'update the live plugin', mike_only: true });
    await runSweep(deps(store, away()));
    expect(store.get(w.id).state).toBe('paused');
    expect(store.get(w.id).stand_in_user_id).toBeNull();
  });

  it('mike_only false on the row does not turn off the template list', async () => {
    const store = new MemStore();
    const w = open(store, { template_key: 'money.invoice', subject: 'x', mike_only: false });
    await runSweep(deps(store, away()));
    expect(store.get(w.id).state).toBe('paused');
  });

  it('resumes after the pause, with the time it had left', async () => {
    const store = new MemStore();
    const w = open(store, { template_key: 'sales.proposal_review', subject: 'x' });
    await runSweep(deps(store, away()));
    const left = Number(store.get(w.id).paused_remaining_ms);
    const later = new Date(RESUME.getTime() + 60_000);
    const r = await runSweep(deps(store, away(), { now: () => later }));
    expect(r.resumed).toEqual([w.id]);
    expect(store.get(w.id).state).toBe('waiting');
    expect(store.get(w.id).due_at).toEqual(new Date(later.getTime() + left));
  });

  it('a wait on Mike\'s own role with no stand-in named pauses; with one named it routes', async () => {
    const store = new MemStore();
    const w = open(store, { template_key: 'build.gate_mike', subject: 'the sitemap' });
    await runSweep(deps(store, away()));
    expect(store.get(w.id).state).toBe('paused');
    expect(store.events.find((e) => e.kind === 'paused')?.reason).toMatch(/no stand-in/);

    const store2 = new MemStore();
    const w2 = open(store2, { template_key: 'build.gate_mike', subject: 'the sitemap' });
    await runSweep(deps(store2, away([WINDOW], [...MAP, { for_user_id: MIKE_USER_ID, role_key: 'mike', stand_in_user_id: ANGELA }])));
    expect(store2.get(w2.id).stand_in_user_id).toBe(ANGELA);
    expect(store2.get(w2.id).state).toBe('waiting');
  });

  it('does not pause a Mike-only wait owned by someone else who is away', async () => {
    const store = new MemStore();
    const w = open(store, { template_key: 'sales.proposal_review', subject: 'x', owner_user_id: SABEEN });
    await runSweep(deps(store, away([{ ...WINDOW, user_id: SABEEN }])));
    expect(store.get(w.id).state).toBe('waiting');
    expect(store.get(w.id).stand_in_user_id).toBeNull();
  });

  it('a dry run leaves a would-be-paused wait out of the firing preview and writes nothing', async () => {
    const store = new MemStore();
    const w = open(store, { template_key: 'sales.proposal_review', subject: 'x', started_at: et(2026, 10, 12, 9) });
    const r = await runSweep(deps(store, away()), { dryRun: true });
    expect(r.away?.paused).toHaveLength(1);
    expect(r.fired.map((f) => f.id)).not.toContain(w.id);
    expect(store.get(w.id).state).toBe('waiting');
    expect(store.events).toHaveLength(0);
  });
});

describe('OOO_STANDINS on: the window ends', () => {
  it('clears a stand-in the feature set, and logs it', async () => {
    const store = new MemStore();
    const w = open(store, { template_key: 'change.needs_human', subject: 'x' });
    await runSweep(deps(store, away()));
    expect(store.get(w.id).stand_in_user_id).toBe(SABEEN);
    const after = new Date(WINDOW_END.getTime() + 3_600_000);
    const r = await runSweep(deps(store, away(), { now: () => after }));
    expect(store.get(w.id).stand_in_user_id).toBeNull();
    expect(r.away?.cleared).toEqual([w.id]);
    const last = store.events.filter((e) => e.kind === 'stand_in').at(-1)!;
    expect(last).toMatchObject({ source: 'ooo', wait_id: w.id });
    expect(last.reason).toMatch(/ended/);
  });

  it('keeps the stand-in while the window is still open', async () => {
    const store = new MemStore();
    const w = open(store, { template_key: 'change.needs_human', subject: 'x' });
    await runSweep(deps(store, away()));
    await runSweep(deps(store, away(), { now: () => et(2026, 10, 22, 9) }));
    expect(store.get(w.id).stand_in_user_id).toBe(SABEEN);
  });

  it('leaves a stand-in someone set by hand alone', async () => {
    const store = new MemStore();
    const w = open(store, { template_key: 'change.needs_human', subject: 'x' }, { stand_in_user_id: NILS });
    store.events.push({ wait_id: w.id, kind: 'stand_in', source: 'user', reason: 'by hand' });
    const after = new Date(WINDOW_END.getTime() + 3_600_000);
    await runSweep(deps(store, away(), { now: () => after }));
    expect(store.get(w.id).stand_in_user_id).toBe(NILS);
  });
});

describe('OOO_STANDINS off: the sweeper does none of it and reads neither table', () => {
  const offValues: Array<string | undefined> = [undefined, 'false', 'TRUE', '1', ''];
  for (const v of offValues) {
    it(`flag value ${JSON.stringify(v)}: no routing, no pause, zero lookups`, async () => {
      if (v === undefined) delete process.env.OOO_STANDINS;
      else process.env.OOO_STANDINS = v;
      const store = new MemStore();
      const wp = open(store, { template_key: 'change.needs_human', subject: 'x' });
      const sales = open(store, { template_key: 'sales.proposal_review', subject: 'y' });
      const a = away();
      const r = await runSweep(deps(store, a));
      expect(a.calls).toEqual({ windows: 0, standIns: 0 });
      expect(store.get(wp.id).stand_in_user_id).toBeNull();
      expect(store.get(sales.id).state).toBe('waiting');
      expect(r.away).toBeUndefined();
      expect(store.events).toHaveLength(0);
    });
  }

  it('makes zero queries to AwayWindow or StandIn through the Prisma lookup (mocked call counts)', async () => {
    delete process.env.OOO_STANDINS;
    const db = {
      awayWindow: { findMany: vi.fn(async () => [WINDOW]) },
      standIn: { findMany: vi.fn(async () => MAP) },
    };
    const store = new MemStore();
    open(store, { template_key: 'change.needs_human', subject: 'x' });
    open(store, { template_key: 'sales.proposal_review', subject: 'y' });
    await runSweep(deps(store, prismaAwayLookups(db)));
    await runSweep(deps(store, prismaAwayLookups(db)), { dryRun: true });
    expect(db.awayWindow.findMany).toHaveBeenCalledTimes(0);
    expect(db.standIn.findMany).toHaveBeenCalledTimes(0);
  });

  it('the same mocked prisma IS queried when the flag is on (the counter works)', async () => {
    const db = {
      awayWindow: { findMany: vi.fn(async () => [WINDOW]) },
      standIn: { findMany: vi.fn(async () => MAP) },
    };
    const store = new MemStore();
    const w = open(store, { template_key: 'change.needs_human', subject: 'x' });
    await runSweep(deps(store, prismaAwayLookups(db)));
    expect(db.awayWindow.findMany).toHaveBeenCalledTimes(1);
    expect(db.standIn.findMany).toHaveBeenCalledTimes(1);
    expect(store.get(w.id).stand_in_user_id).toBe(SABEEN);
  });

  it('with the flag on but no lookups wired, the sweeper behaves as before', async () => {
    const store = new MemStore();
    const w = open(store, { template_key: 'change.needs_human', subject: 'x' });
    const r = await runSweep(deps(store, undefined));
    expect(store.get(w.id).stand_in_user_id).toBeNull();
    expect(r.away).toBeUndefined();
  });
});
