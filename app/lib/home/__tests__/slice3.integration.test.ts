// @vitest-environment node
/**
 * Slice 3 against a real Postgres: a task Bast stopped on (assigned to Bast, tagged needs-mike) is listed in Next for
 * the home owner and nowhere else, the nightly keeper gives it no day and reads no date, and a bot's task mention is
 * quiet for the home owner but not for the tech.
 *
 * Skips unless DATABASE_URL names the scratch Postgres on localhost:55433. It removes only the rows it made (Bast's
 * user row is created only when the scratch database has none, and removed only then).
 * Run: DATABASE_URL=postgresql://citadel:citadel@localhost:55433/home_s3 npx vitest run lib/home/__tests__/slice3.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/db/prisma';
import { BAST_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { createNotification } from '@/lib/services/notifications';
import { loadHomeInputs } from '../load';
import { loadItemStates } from '../state';
import { selectHome } from '../select';
import { assembleHomeResponse, proposeDay } from '../today';
import { runKeeper } from '../keeper/run';
import { taskKey } from '../item-key';

const SCRATCH = /localhost:55433/.test(process.env.DATABASE_URL ?? '');
const TZ = 'America/New_York';
/** Wednesday 2026-11-11, 02:35 Eastern. */
const NOW = new Date('2026-11-11T07:35:00Z');
const iso = (s: string) => new Date(s);

describe.skipIf(!SCRATCH)('Slice 3: a task Bast stopped on, and quiet bot mentions (real database)', () => {
  const tag = `s3-${Date.now()}`;
  const adminId = randomUUID();
  const techId = randomUUID();
  let bastCreated = false;
  const taskIds: string[] = [];
  let bastTaskId = '';
  let ownChoreId = '';

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: adminId, email: `admin-${tag}@example.test`, password_hash: 'x', name: 'Admin S3', role: 'admin' },
        { id: techId, email: `tech-${tag}@example.test`, password_hash: 'x', name: 'Tech S3', role: 'tech' },
      ],
    });
    await prisma.userPreference.createMany({
      data: [
        { user_id: adminId, home_view: 'home', timezone: TZ },
        { user_id: techId, home_view: 'overlook', timezone: TZ },
      ],
    });
    // The tech gets the notice in the app only, so the test can never reach an email or Slack channel.
    await prisma.notificationPreference.create({
      data: { user_id: techId, notification_type: 'task_mentioned', in_app: true, email: false, slack: false },
    });
    if (!(await prisma.user.findUnique({ where: { id: BAST_USER_ID }, select: { id: true } }))) {
      await prisma.user.create({ data: { id: BAST_USER_ID, email: `bast-${tag}@example.test`, password_hash: 'x', name: 'Bast S3', role: 'tech' } });
      bastCreated = true;
    }
    const bastTask = await prisma.task.create({
      data: {
        title: 'Bast stopped here',
        assignee_id: BAST_USER_ID,
        created_by_id: BAST_USER_ID,
        status: 'not_started',
        needs_review: false,
        tags: [tag, 'needs-mike'],
        due_date: iso('2026-11-30T00:00:00Z'),
        created_at: iso('2026-10-01T14:00:00Z'),
      },
    });
    bastTaskId = bastTask.id;
    taskIds.push(bastTask.id);
    // A Bast task without the tag, and a task of someone else: neither may appear.
    const untagged = await prisma.task.create({
      data: { title: 'Bast is working', assignee_id: BAST_USER_ID, created_by_id: BAST_USER_ID, status: 'not_started', needs_review: false, tags: [tag] },
    });
    const techTask = await prisma.task.create({
      data: { title: 'Tech needs-mike', assignee_id: techId, created_by_id: techId, status: 'not_started', needs_review: false, tags: [tag, 'needs-mike'] },
    });
    const chore = await prisma.task.create({
      data: { title: 'Own chore', assignee_id: adminId, created_by_id: adminId, status: 'not_started', needs_review: false, tags: [tag], created_at: iso('2026-10-05T14:00:00Z') },
    });
    ownChoreId = chore.id;
    taskIds.push(untagged.id, techTask.id, chore.id);
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { user_id: { in: [adminId, techId] } } });
    await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
    await prisma.user.deleteMany({ where: { id: { in: [adminId, techId] } } });
    if (bastCreated) await prisma.user.deleteMany({ where: { id: BAST_USER_ID } });
    await prisma.$disconnect();
  });

  async function screen(forUser = adminId) {
    const [raw, states] = await Promise.all([loadHomeInputs(prisma, forUser, NOW, { timezone: TZ }), loadItemStates(prisma, forUser)]);
    const sel = selectHome({ raw, states, now: NOW });
    const day = proposeDay(sel, raw.calendar_events, NOW);
    const resp = assembleHomeResponse({ sel, day, calendar: raw.calendar_events, now: NOW, timezone: TZ, user_id: forUser });
    return { raw, sel, day, resp };
  }

  it('lists the Bast needs-mike task in Next with who, why, footer and buttons', async () => {
    const { resp } = await screen();
    const item = resp.sections.next.find((i) => i.key === taskKey(bastTaskId));
    expect(item).toBeDefined();
    expect(item?.who).toBe('Bast');
    expect(item?.why_now).toBe('Bast stopped on this and needs you.');
    expect(item?.default_if_ignored).toBe('Stays with Bast, stopped, until you answer on the task.');
    expect([...(item?.actions ?? []), ...(item?.more_actions ?? [])].map((a) => a.id)).toEqual(['open_task', 'not_now', 'matters_more', 'snooze', 'on_day']);
    // Not the untagged Bast task, not the tech's own needs-mike task (the seed's own Bast task may also be listed).
    const all = JSON.stringify(resp);
    expect(all).not.toContain('Bast is working');
    expect(all).not.toContain('Tech needs-mike');
    const everything = JSON.stringify(resp.everything_else);
    expect(everything).not.toContain(taskKey(bastTaskId));
  });

  it('is absent from Today', async () => {
    const { resp, day } = await screen();
    const todayKeys = [...(day?.step_item_keys ?? []), ...(day?.quick_item_keys ?? [])];
    expect(todayKeys).not.toContain(taskKey(bastTaskId));
    const steps = (resp as unknown as { today?: { steps?: { key: string }[] } }).today?.steps ?? [];
    expect(steps.map((s) => s.key)).not.toContain(taskKey(bastTaskId));
  });

  it('the keeper plan gives it no day and no date reading, and a real run writes nothing for it', async () => {
    const dry = await runKeeper(prisma, adminId, NOW, { dryRun: true });
    const planned = [...(dry.plan?.stagger ?? []).map((s) => s.item_key), ...(dry.plan?.dates ?? []).map((d) => d.item_key)];
    expect(planned).not.toContain(taskKey(bastTaskId));
    const before = (await prisma.task.findUnique({ where: { id: bastTaskId }, select: { updated_at: true } }))?.updated_at.getTime();
    await runKeeper(prisma, adminId, NOW, { dryRun: false });
    expect(await prisma.homeItemState.count({ where: { user_id: adminId, item_key: taskKey(bastTaskId) } })).toBe(0);
    expect((await prisma.task.findUnique({ where: { id: bastTaskId }, select: { updated_at: true } }))?.updated_at.getTime()).toBe(before);
    // The owner's own chore does get a day: the keeper still works for the owner's tasks.
    expect(await prisma.homeItemState.count({ where: { user_id: adminId, item_key: taskKey(ownChoreId) } })).toBe(1);
  });

  it('a bot task mention makes no notification for the home admin, and one for the tech', async () => {
    const mention = (userId: string) =>
      createNotification({
        userId,
        type: 'task_mentioned',
        title: 'Bast mentioned you on "Bast stopped here"',
        entityType: 'task',
        entityId: bastTaskId,
        actorUserId: BAST_USER_ID,
      });
    expect(await mention(adminId)).toBeNull();
    expect(await prisma.notification.count({ where: { user_id: adminId } })).toBe(0);
    await mention(techId);
    expect(await prisma.notification.count({ where: { user_id: techId, type: 'task_mentioned' } })).toBe(1);
  });
});
