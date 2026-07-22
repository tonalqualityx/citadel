/**
 * Dev fixture seed for Clarity Phase 5 (The Soothsayer + Needs Reshi rework) Playwright
 * coverage:
 *   - two OPEN, un-snoozed, un-picked arcs for the Soothsayer's "no day assigned" section —
 *     one used by the assign-to-day e2e (moves out of unplanned once assigned), one used by
 *     the snooze e2e (moves out of unplanned once snoozed, distinct from the first so the
 *     two tests never race each other's fixture).
 *   - one arc WITH a today_pick (dated today) plus a linked legacy needs-attention session
 *     (no manifest ask, arc_id set) — the attention-dot e2e.
 *   - one live (idle) Oracle session with no arc_id and no pick — the unplanned SESSIONS list.
 *   - one manifest-ask session (waiting_on + ask_queue=decide set) — the merged "Waiting on
 *     you" queue e2e.
 *   - one review-queue task (status=done, needs_review=true, approved=false) WITH a client —
 *     the grouped-Review e2e (distinct from Phase 4b's own review fixture, which has neither
 *     client nor arc and lands in "Other" — this one proves the client-name grouping).
 *
 * Idempotent: everything is found-or-recreated by fixed name/external_id every run. Local
 * dev only — this seeds whatever DATABASE_URL points at; never point it at prod.
 *
 * Run with:
 *   npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/seed-clarity-phase5-fixtures.ts
 */
import { PrismaClient, TodayPickType, OracleSource, OracleSessionStatus, AskQueue } from '@prisma/client';

const prisma = new PrismaClient();

const ADMIN_EMAIL = 'admin@indelible.agency';
const DEFAULT_DISPLAY_TIMEZONE = 'America/New_York';
const MACHINE_NAME = 'reshi-workstation';

const UNPLANNED_ARC_NAME = 'E2E: Clarity Phase 5 unplanned arc (assign-to-day)';
const SNOOZE_ARC_NAME = 'E2E: Clarity Phase 5 unplanned arc (snooze target)';
const ATTENTION_ARC_NAME = 'E2E: Clarity Phase 5 attention-linked arc';
const CLIENT_NAME = 'E2E Clarity Phase 5 Client';
const REVIEW_TASK_TITLE = 'E2E: Clarity Phase 5 review task (client group)';

const UNPLANNED_SESSION_EXT_ID = 'e2e-clarity-phase5-unplanned-session';
const ATTENTION_LEGACY_SESSION_EXT_ID = 'e2e-clarity-phase5-attention-legacy-session';
const WAITING_MANIFEST_SESSION_EXT_ID = 'e2e-clarity-phase5-waiting-manifest-session';

function getZonedDateString(date: Date, timezone?: string | null): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const year = parts.find((p) => p.type === 'year')!.value;
    const month = parts.find((p) => p.type === 'month')!.value;
    const day = parts.find((p) => p.type === 'day')!.value;
    return `${year}-${month}-${day}`;
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

async function upsertOpenArc(name: string) {
  await prisma.todayPick.deleteMany({
    where: { item_type: 'arc', arc: { name } },
  });
  let arc = await prisma.arc.findFirst({ where: { name } });
  if (arc) {
    // Reset to a clean, unsnoozed, open state on every run.
    arc = await prisma.arc.update({ where: { id: arc.id }, data: { snoozed_until: null, closed_at: null } });
    await prisma.task.deleteMany({ where: { arc_id: arc.id } });
  } else {
    arc = await prisma.arc.create({ data: { name } });
  }
  await prisma.task.create({
    data: { title: `${name} — open task`, status: 'not_started', arc_id: arc.id },
  });
  return arc;
}

async function main() {
  const admin = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
  if (!admin) {
    throw new Error(`Seed admin user ${ADMIN_EMAIL} not found — run prisma/seed.ts first.`);
  }
  const adminPref = await prisma.userPreference.findUnique({ where: { user_id: admin.id } });
  const adminTimezone = adminPref?.timezone || DEFAULT_DISPLAY_TIMEZONE;
  const dateStr = getZonedDateString(new Date(), adminTimezone);
  const date = new Date(`${dateStr}T00:00:00.000Z`);

  console.log('Clarity Phase 5 fixtures: upserting the two unplanned arcs...');
  const unplannedArc = await upsertOpenArc(UNPLANNED_ARC_NAME);
  const snoozeArc = await upsertOpenArc(SNOOZE_ARC_NAME);
  console.log(`  unplanned arc ${unplannedArc.id}, snooze-target arc ${snoozeArc.id}`);

  console.log('Clarity Phase 5 fixtures: upserting the attention-linked arc + its today_pick...');
  let attentionArc = await prisma.arc.findFirst({ where: { name: ATTENTION_ARC_NAME } });
  if (attentionArc) {
    attentionArc = await prisma.arc.update({
      where: { id: attentionArc.id },
      data: { snoozed_until: null, closed_at: null },
    });
  } else {
    attentionArc = await prisma.arc.create({ data: { name: ATTENTION_ARC_NAME } });
  }
  await prisma.todayPick.deleteMany({ where: { arc_id: attentionArc.id } });
  await prisma.todayPick.create({
    data: { date, item_type: TodayPickType.arc, arc_id: attentionArc.id, sort: 20 },
  });
  // The "+ Quest" quick-add e2e creates a fresh, uniquely-titled task on this arc every
  // run (its title embeds Date.now() so the e2e can assert on an exact, never-reused
  // string) — clean up whatever prior runs left behind so this arc doesn't accumulate an
  // unbounded pile of quick-add fixture tasks across repeated dev-history test runs.
  await prisma.task.deleteMany({ where: { arc_id: attentionArc.id, title: { startsWith: 'E2E: quick-add quest ' } } });
  console.log(`  attention-linked arc ${attentionArc.id}, today_pick created for ${dateStr}`);

  console.log('Clarity Phase 5 fixtures: upserting a client for the grouped-Review e2e...');
  let client = await prisma.client.findFirst({ where: { name: CLIENT_NAME } });
  if (!client) {
    client = await prisma.client.create({ data: { name: CLIENT_NAME } });
  }

  console.log('Clarity Phase 5 fixtures: upserting the client-grouped review task...');
  await prisma.task.deleteMany({ where: { title: REVIEW_TASK_TITLE } });
  await prisma.task.create({
    data: {
      title: REVIEW_TASK_TITLE,
      status: 'done',
      needs_review: true,
      approved: false,
      priority: 2,
      client_id: client.id,
      assignee_id: admin.id,
      created_by_id: admin.id,
    },
  });

  console.log('Clarity Phase 5 fixtures: upserting the fleet sessions...');
  const machine = await prisma.oracleMachine.upsert({
    where: { name: MACHINE_NAME },
    update: { last_heartbeat_at: new Date() },
    create: { name: MACHINE_NAME, hostname: 'reshi-workstation.local', last_heartbeat_at: new Date() },
  });

  // A live, idle session with no arc link and no pick — the unplanned SESSIONS list.
  await prisma.oracleSession.upsert({
    where: { machine_id_source_external_id: { machine_id: machine.id, source: OracleSource.claude_code, external_id: UNPLANNED_SESSION_EXT_ID } },
    update: {
      status: OracleSessionStatus.idle,
      needs_attention: false,
      waiting_on: null,
      arc_id: null,
      archived_at: null,
      title: 'E2E: unplanned live session',
    },
    create: {
      machine_id: machine.id,
      source: OracleSource.claude_code,
      external_id: UNPLANNED_SESSION_EXT_ID,
      title: 'E2E: unplanned live session',
      status: OracleSessionStatus.idle,
      started_at: new Date(),
      last_event_at: new Date(),
    },
  });

  // A legacy needs-attention session (no manifest ask) LINKED to the attention arc — the
  // attention-dot e2e.
  await prisma.oracleSession.upsert({
    where: { machine_id_source_external_id: { machine_id: machine.id, source: OracleSource.claude_code, external_id: ATTENTION_LEGACY_SESSION_EXT_ID } },
    update: {
      status: OracleSessionStatus.waiting,
      needs_attention: true,
      attention_reason: 'E2E: legacy attention fixture — session waiting, linked to an arc.',
      waiting_on: null,
      arc_id: attentionArc.id,
      archived_at: null,
      title: 'E2E: legacy attention session (linked)',
    },
    create: {
      machine_id: machine.id,
      source: OracleSource.claude_code,
      external_id: ATTENTION_LEGACY_SESSION_EXT_ID,
      title: 'E2E: legacy attention session (linked)',
      status: OracleSessionStatus.waiting,
      needs_attention: true,
      attention_reason: 'E2E: legacy attention fixture — session waiting, linked to an arc.',
      arc_id: attentionArc.id,
      started_at: new Date(),
      last_event_at: new Date(),
    },
  });

  // A manifest-ask session (waiting_on + ask_queue=decide) — the merged "Waiting on you"
  // queue e2e.
  await prisma.oracleSession.upsert({
    where: { machine_id_source_external_id: { machine_id: machine.id, source: OracleSource.claude_code, external_id: WAITING_MANIFEST_SESSION_EXT_ID } },
    update: {
      status: OracleSessionStatus.waiting,
      needs_attention: false,
      waiting_on: 'E2E: approve the Phase 5 rollout plan?',
      ask_queue: AskQueue.decide,
      ask_severity: 'internal',
      archived_at: null,
      title: 'E2E: manifest waiting-on-you session',
    },
    create: {
      machine_id: machine.id,
      source: OracleSource.claude_code,
      external_id: WAITING_MANIFEST_SESSION_EXT_ID,
      title: 'E2E: manifest waiting-on-you session',
      status: OracleSessionStatus.waiting,
      waiting_on: 'E2E: approve the Phase 5 rollout plan?',
      ask_queue: AskQueue.decide,
      ask_severity: 'internal',
      started_at: new Date(),
      last_event_at: new Date(),
    },
  });

  console.log('Done.');
}

main()
  .catch((e) => {
    console.error('Clarity Phase 5 fixture seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
