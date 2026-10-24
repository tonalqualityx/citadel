// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { openPriceReviews, firstStepDueAt, waitKeyFor, HOSTING_CHARTERS_NOTE } from '../open';
import { runSweep } from '@/lib/waits/sweeper';
import { prismaSweepStore } from '@/lib/waits/prisma-store';
import { prismaOwnerLookups } from '@/lib/waits/owner';
import { makeApplyProceed } from '../apply';

// The opener against a real Postgres. Skips unless DATABASE_URL names a scratch database,
// because it writes rows.
const SCRATCH = /scratch/i.test(process.env.DATABASE_URL ?? '');
const DAY = 86_400_000;
const dateOnly = (offsetDays: number) => new Date(`${new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10)}T00:00:00.000Z`);

describe.skipIf(!SCRATCH)('price review opener (real database)', () => {
  const tag = `pr-${Date.now()}`;
  let userId = '';
  let clientId = '';
  let siteId = '';
  const charters: Record<string, string> = {};
  const cleanup: { tasks: string[] } = { tasks: [] };

  const mkCharter = async (key: string, over: Record<string, unknown>) => {
    const c = await prisma.charter.create({
      data: {
        name: `Internal name ${tag} ${key}`,
        client_id: clientId,
        billing_period: 'monthly',
        start_date: new Date('2025-01-01T00:00:00.000Z'),
        created_by_id: userId,
        ...over,
      },
    });
    charters[key] = c.id;
    return c;
  };

  beforeAll(async () => {
    userId = (await prisma.user.create({ data: { email: `${tag}@example.test`, password_hash: 'x', name: 'PR Test', role: 'admin' } })).id;
    clientId = (await prisma.client.create({ data: { name: `Price client ${tag}`, type: 'direct', status: 'active' } })).id;
    siteId = (await prisma.site.create({ data: { name: `${tag}.example`, client_id: clientId, url: `https://${tag}.example` } })).id;
    await mkCharter('soon', { client_label: `Plan ${tag}`, price_review_on: dateOnly(10), site_id: siteId });
    await mkCharter('later', { price_review_on: dateOnly(30) });
    await mkCharter('done', { price_review_on: dateOnly(5), price_review_done_at: new Date() });
    await mkCharter('paused', { price_review_on: dateOnly(5), status: 'paused' });
    await mkCharter('nodate', {});
    // Inputs the draft must list: a client-visible done task, and a confirmed KPI. An internal task must not appear.
    const visible = await prisma.task.create({
      data: { title: `Internal title ${tag}`, client_title: `Visible work ${tag}`, status: 'done', completed_at: new Date(), client_id: clientId, client_visible: true },
    });
    const internal = await prisma.task.create({
      data: { title: `Secret internal ${tag}`, status: 'done', completed_at: new Date(), client_id: clientId, client_visible: false },
    });
    cleanup.tasks.push(visible.id, internal.id);
    await prisma.siteKpi.create({
      data: {
        client_id: clientId, site_id: siteId, metric: 'sessions', label: `More visits ${tag}`, direction: 'up',
        target_value: 1500, source: 'ga4', status: 'confirmed', confirmed_at: new Date(), last_value: 1200,
      },
    });
  });

  afterAll(async () => {
    const ids = Object.values(charters);
    await prisma.waitEvent.deleteMany({ where: { wait: { charter_id: { in: ids } } } });
    await prisma.wait.deleteMany({ where: { charter_id: { in: ids } } });
    await prisma.task.deleteMany({ where: { OR: [{ id: { in: cleanup.tasks } }, { charter_id: { in: ids } }] } });
    await prisma.siteKpi.deleteMany({ where: { client_id: clientId } });
    await prisma.charter.deleteMany({ where: { id: { in: ids } } });
    await prisma.site.deleteMany({ where: { id: siteId } });
    await prisma.client.deleteMany({ where: { id: clientId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  const mine = <T extends { charter_id: string }>(xs: T[]) => xs.filter((x) => Object.values(charters).includes(x.charter_id));
  const waitCount = () => prisma.wait.count({ where: { charter_id: { in: Object.values(charters) } } });

  it('a dry run names the one charter inside its window and writes nothing', async () => {
    const r = await openPriceReviews(prisma, { dryRun: true });
    expect(r.dry_run).toBe(true);
    expect(mine(r.opened).map((x) => x.charter_id)).toEqual([charters.soon]);
    expect(mine(r.not_yet).map((x) => x.charter_id)).toEqual([charters.later]);
    expect(r.note).toBe(HOSTING_CHARTERS_NOTE);
    expect(await waitCount()).toBe(0);
  });

  it('opens exactly one wait, 14 days before the date, and a second run opens nothing', async () => {
    const first = await openPriceReviews(prisma);
    expect(mine(first.opened)).toHaveLength(1);
    expect(await waitCount()).toBe(1);
    const wait = await prisma.wait.findFirstOrThrow({ where: { charter_id: charters.soon } });
    const reviewOn = dateOnly(10);
    expect(wait).toMatchObject({
      template_key: 'charter.price_review',
      step: 1,
      terminal_action: 'task',
      client_id: clientId,
      site_id: siteId,
      idempotency_key: waitKeyFor(charters.soon, reviewOn),
      title: `Draft the price review note for Plan ${tag}`,
    });
    expect(wait.due_at.getTime()).toBe(firstStepDueAt(reviewOn).getTime());
    // The draft inputs are in the wait detail: visible work and the confirmed goal, not the internal task.
    expect(wait.detail).toContain(`Visible work ${tag}`);
    expect(wait.detail).not.toContain(`Secret internal ${tag}`);
    expect(wait.detail).not.toContain(`Internal title ${tag}`);
    expect(wait.detail).toContain(`More visits ${tag}`);
    expect(wait.detail).toContain('Never state a number Mike has not approved');
    expect(wait.detail).toContain('Never offer a discount');
    expect(wait.detail).not.toContain(`Internal name ${tag}`);

    const again = await openPriceReviews(prisma);
    expect(mine(again.opened)).toHaveLength(0);
    expect(mine(again.already_open).map((x) => x.charter_id)).toEqual([charters.soon]);
    expect(await waitCount()).toBe(1);
  });

  it('two runs at once still open one wait', async () => {
    await mkCharter('race', { price_review_on: dateOnly(3) });
    await Promise.all([openPriceReviews(prisma), openPriceReviews(prisma), openPriceReviews(prisma)]);
    expect(await prisma.wait.count({ where: { charter_id: charters.race } })).toBe(1);
  });

  it('a moved date opens a new wait and reports the old one as stale', async () => {
    await prisma.charter.update({ where: { id: charters.soon }, data: { price_review_on: dateOnly(7) } });
    const r = await openPriceReviews(prisma);
    expect(mine(r.opened).map((x) => x.charter_id)).toEqual([charters.soon]);
    expect(mine(r.stale_waits.map((s) => ({ ...s, charter_id: s.charter_id }))).map((s) => s.charter_id)).toEqual([charters.soon]);
  });

  it('the sweeper fires the opened wait as a task step, and a dry run writes nothing', async () => {
    const deps = {
      store: prismaSweepStore(prisma),
      owner: prismaOwnerLookups(prisma as unknown as Parameters<typeof prismaOwnerLookups>[0]),
      switchIsOn: async () => false,
      applyProceed: makeApplyProceed(prisma),
    };
    const before = await waitCount();
    const dry = await runSweep(deps, { dryRun: true });
    const fired = dry.fired.filter((f) => f.template_key === 'charter.price_review');
    expect(fired.length).toBeGreaterThanOrEqual(1);
    expect(fired.every((f) => f.action === 'task' && f.step === 1)).toBe(true);
    expect(await waitCount()).toBe(before);
    expect(await prisma.emailOutbox.count({ where: { kind: 'price_review' } })).toBe(0);
  });

  it('applyProceed stamps the charter once', async () => {
    const apply = makeApplyProceed(prisma);
    const wait = await prisma.wait.findFirstOrThrow({ where: { charter_id: charters.soon } });
    await apply(wait, 'price_review_done');
    const first = (await prisma.charter.findUniqueOrThrow({ where: { id: charters.soon } })).price_review_done_at;
    expect(first).not.toBeNull();
    await apply(wait, 'price_review_done');
    expect((await prisma.charter.findUniqueOrThrow({ where: { id: charters.soon } })).price_review_done_at?.getTime()).toBe(first!.getTime());
    // Done now: the opener skips this charter.
    const r = await openPriceReviews(prisma, { dryRun: true });
    expect(mine(r.opened).map((x) => x.charter_id)).not.toContain(charters.soon);
  });
});
