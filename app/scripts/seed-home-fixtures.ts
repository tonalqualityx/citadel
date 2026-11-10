/**
 * Dev fixture seed for the Home screen (Slice 1), for looking at it by eye. Mirrors the
 * "tonight" fixture in the plan: the Grok security task with its arc of 4 open steps, the
 * Claude sign-in task (job-watch, due 2026-11-14), the VCDP review fold of 39 pieces,
 * Jessica Everlith / Andy Honeycutt / Mark Mitchell threads, a sales lead, the Stronghold
 * session ask, a jillscafe crisis mail, a collectiveyouth crisis mail (noise list), a few
 * classifier auto-closes and one calendar event today.
 *
 * Also seeds two users: an admin with home_view = home (sees the Home screen) and a tech
 * with home_view = overlook (must keep Overlook / get 403 from /api/home).
 *
 * SAFETY: refuses to run unless DATABASE_URL contains localhost:55433 (the throwaway
 * migration-check Postgres). Never point it anywhere else.
 *
 * Rerunnable: tasks carry the tag `home-fixture` and are deleted by that tag on every run
 * (nothing else is deleted); email asks, session, machine, calendar event, users, arc,
 * clients, sites and projects are found-or-upserted by fixed keys. The two seeded users'
 * home_* rows are reset so each run starts from a fresh screen.
 *
 * Run with:
 *   DATABASE_URL=postgresql://citadel:citadel@localhost:55433/migcheck \
 *     npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/seed-home-fixtures.ts
 */
import {
  PrismaClient,
  UserRole,
  OracleSource,
  OracleSessionStatus,
  AskQueue,
} from '@prisma/client';
import bcrypt from 'bcryptjs';

const DATABASE_URL = process.env.DATABASE_URL ?? '';
if (!DATABASE_URL.includes('localhost:55433')) {
  console.error('Refusing to run: DATABASE_URL must contain localhost:55433 (the throwaway check database).');
  process.exit(1);
}

const prisma = new PrismaClient();

const ADMIN_EMAIL = 'home-admin@indelible.test';
const TECH_EMAIL = 'home-tech@indelible.test';
const DEV_PASSWORD = 'home-dev-password';
const TZ = 'America/New_York';
const FIXTURE_TAG = 'home-fixture';
const MID = 'home-fixture-';
const MACHINE_NAME = 'home-fixture-machine';
const MINE = 'mike@becomeindelible.com';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function zonedDate(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const g = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}

const counts: Record<string, number> = {};
function bump(kind: string, n = 1) {
  counts[kind] = (counts[kind] ?? 0) + n;
}

async function findOrCreateClient(name: string, status: 'active' | 'inactive' = 'active') {
  const existing = await prisma.client.findFirst({ where: { name } });
  if (existing) return existing;
  return prisma.client.create({ data: { name, status: status as never } });
}

async function findOrCreateSite(name: string, clientId: string) {
  const existing = await prisma.site.findFirst({ where: { name, client_id: clientId } });
  if (existing) return existing;
  return prisma.site.create({ data: { name, client_id: clientId, url: `https://${name.toLowerCase().replace(/\W+/g, '')}.example` } });
}

async function findOrCreateProject(name: string, clientId: string) {
  const existing = await prisma.project.findFirst({ where: { name, client_id: clientId } });
  if (existing) return existing;
  return prisma.project.create({ data: { name, client_id: clientId, status: 'in_progress' } });
}

async function main() {
  const now = new Date();
  const dateStr = zonedDate(now, TZ);
  const passwordHash = await bcrypt.hash(DEV_PASSWORD, 10);

  // ---- Users ----
  const admin = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: { role: UserRole.admin, is_active: true, password_hash: passwordHash },
    create: { email: ADMIN_EMAIL, name: 'Mike (home fixture)', role: UserRole.admin, password_hash: passwordHash },
  });
  const tech = await prisma.user.upsert({
    where: { email: TECH_EMAIL },
    update: { role: UserRole.tech, is_active: true, password_hash: passwordHash },
    create: { email: TECH_EMAIL, name: 'Tech (home fixture)', role: UserRole.tech, password_hash: passwordHash },
  });
  await prisma.userPreference.upsert({
    where: { user_id: admin.id },
    update: { home_view: 'home', timezone: TZ },
    create: { user_id: admin.id, home_view: 'home', timezone: TZ },
  });
  await prisma.userPreference.upsert({
    where: { user_id: tech.id },
    update: { home_view: 'overlook', timezone: TZ },
    create: { user_id: tech.id, home_view: 'overlook', timezone: TZ },
  });
  bump('users', 2);

  // Reset the two seeded users' own home records (never anyone else's).
  await prisma.homeAction.deleteMany({ where: { user_id: { in: [admin.id, tech.id] } } });
  await prisma.homeDay.deleteMany({ where: { user_id: { in: [admin.id, tech.id] } } });
  await prisma.homeItemState.deleteMany({ where: { user_id: { in: [admin.id, tech.id] } } });

  // ---- Clients, sites, projects ----
  const grok = await findOrCreateClient('Grok Wellness');
  const grokSite = await findOrCreateSite('Grok Wellness site', grok.id);
  const vcdp = await findOrCreateClient('VCDP');
  const vcdpProject = await findOrCreateProject('VCDP Bedrock site build', vcdp.id);
  const jessicaClient = await findOrCreateClient('Everlith Studio');
  const andyClient = await findOrCreateClient('Honeycutt Builders');
  const markClient = await findOrCreateClient('Mitchell Outdoor');
  const stronghold = await findOrCreateClient('Stronghold Stuff');
  const jills = await findOrCreateClient("Jill's Cafe");
  const jillsSite = await findOrCreateSite("Jill's Cafe site", jills.id);
  bump('clients', 7);
  bump('sites', 2);
  bump('projects', 1);

  // ---- Clear previous run's tasks (by tag only) ----
  const oldTasks = await prisma.task.findMany({ where: { tags: { has: FIXTURE_TAG } }, select: { id: true } });
  const oldIds = oldTasks.map((t) => t.id);
  if (oldIds.length) {
    await prisma.todayPick.deleteMany({ where: { task_id: { in: oldIds } } });
    await prisma.emailAsk.updateMany({ where: { task_id: { in: oldIds } }, data: { task_id: null } });
    await prisma.task.deleteMany({ where: { id: { in: oldIds } } });
  }

  // ---- Arc + the Grok security task and its 3 siblings (4 open steps) ----
  let arc = await prisma.arc.findFirst({ where: { name: 'Grok compromise cleanup (home fixture)' } });
  if (!arc) {
    arc = await prisma.arc.create({
      data: { name: 'Grok compromise cleanup (home fixture)', client_id: grok.id },
    });
  }
  bump('arcs');

  const base = { assignee_id: admin.id, created_by_id: admin.id, needs_review: false };
  const grokSteps: Array<{ title: string; tags: string[]; minutes: number; site?: boolean }> = [
    { title: 'Grok: remove the hidden outbound link and confirm the source file', tags: ['security', FIXTURE_TAG], minutes: 30, site: true },
    { title: 'Grok: rotate the admin passwords and remove the unknown admin', tags: [FIXTURE_TAG], minutes: 20 },
    { title: 'Grok: rescan the site and file the clean report', tags: [FIXTURE_TAG], minutes: 15 },
    { title: 'Grok: tell the client what happened and what changed', tags: [FIXTURE_TAG], minutes: 15 },
  ];
  for (const s of grokSteps) {
    await prisma.task.create({
      data: {
        ...base,
        title: s.title,
        status: 'not_started',
        tags: s.tags,
        estimated_minutes: s.minutes,
        client_id: grok.id,
        site_id: s.site ? grokSite.id : null,
        arc_id: arc.id,
        created_at: new Date(now.getTime() - 3 * DAY),
      },
    });
  }
  bump('tasks: grok arc steps', grokSteps.length);

  // ---- Claude sign-in task (job-watch, hard date 2026-11-14) ----
  await prisma.task.create({
    data: {
      ...base,
      title: 'Claude sign-in pass-through: decide and sign off',
      status: 'not_started',
      tags: ['job-watch', FIXTURE_TAG],
      due_date: new Date('2026-11-14T17:00:00.000Z'),
      estimated_minutes: 10,
      created_at: new Date(now.getTime() - 6 * DAY),
    },
  });
  bump('tasks: job-watch sign-in');

  // ---- A promised task, a lifeline task, and some plain ones for Everything else ----
  await prisma.task.create({
    data: {
      ...base,
      title: "Jill's Cafe: send the menu page proof",
      status: 'not_started',
      tags: [FIXTURE_TAG],
      promised_to: 'Jill',
      due_date: new Date(`${dateStr}T21:00:00.000Z`),
      estimated_minutes: 20,
      client_id: jills.id,
      site_id: jillsSite.id,
    },
  });
  await prisma.task.create({
    data: {
      ...base,
      title: 'Stronghold: confirm the shop copy round with Brian',
      status: 'in_progress',
      started_at: new Date(now.getTime() - 2 * HOUR),
      tags: [FIXTURE_TAG],
      client_id: stronghold.id,
    },
  });
  await prisma.task.create({
    data: {
      ...base,
      title: 'Update the invoice template wording',
      status: 'not_started',
      tags: [FIXTURE_TAG],
    },
  });
  bump('tasks: promised / in progress / plain', 3);

  // ---- VCDP review fold: 39 done pieces awaiting sign-off ----
  for (let i = 1; i <= 39; i++) {
    await prisma.task.create({
      data: {
        title: `VCDP: page piece ${String(i).padStart(2, '0')} ready for review`,
        status: 'done',
        needs_review: true,
        approved: false,
        tags: [FIXTURE_TAG],
        client_id: vcdp.id,
        project_id: vcdpProject.id,
        assignee_id: admin.id,
        created_by_id: admin.id,
        estimated_minutes: 5,
      },
    });
  }
  bump('tasks: VCDP review pieces', 39);

  // ---- Email asks (upsert by fixed message_id) ----
  type Ask = {
    key: string;
    from_name: string;
    from_email: string;
    subject: string;
    gist: string;
    client_id?: string;
    intent?: 'sales' | 'general';
    draft?: boolean;
    urgent?: boolean;
    ageMs: number;
    severity?: 'client_blocking' | 'internal';
    queue?: 'do' | 'answer' | 'decide';
  };
  const asks: Ask[] = [
    { key: 'jessica', from_name: 'Jessica Everlith', from_email: 'jessica@everlith.example', subject: 'Re: gallery page and the new headshots', gist: 'Jessica asks when the gallery page goes live and attaches new headshots.', client_id: jessicaClient.id, draft: true, ageMs: 3 * DAY, queue: 'answer' },
    { key: 'andy', from_name: 'Andy Honeycutt', from_email: 'andy@honeycutt.example', subject: 'Quote for the second location page', gist: 'Andy wants a price for a second-location page.', client_id: andyClient.id, draft: true, ageMs: 4 * DAY, queue: 'answer' },
    { key: 'mark', from_name: 'Mark Mitchell', from_email: 'mark@mitchell.example', subject: 'Holiday carousel: which photos?', gist: 'Mark is asking which photos to use for the holiday carousel.', client_id: markClient.id, ageMs: 2 * DAY, queue: 'answer' },
    { key: 'lead', from_name: 'Priya Nandakumar', from_email: 'priya@newlead.example', subject: 'Can you rebuild our site?', gist: 'A new inquiry asking about a rebuild and price range.', intent: 'sales', ageMs: 5 * HOUR, queue: 'answer' },
    { key: 'crisis-jills', from_name: "Jill's Cafe", from_email: 'jill@jillscafe.example', subject: 'Our website is down!', gist: 'Jill reports the site shows an error page.', client_id: jills.id, urgent: true, severity: 'client_blocking', ageMs: 40 * MIN, queue: 'do' },
    { key: 'crisis-collectiveyouth', from_name: 'Collective Youth', from_email: 'office@collectiveyouth.com', subject: 'Site is down again', gist: 'A noise-list sender reports an outage.', urgent: true, severity: 'client_blocking', ageMs: 90 * MIN, queue: 'do' },
  ];
  for (const a of asks) {
    const messageId = `${MID}${a.key}`;
    const receivedAt = new Date(now.getTime() - a.ageMs);
    const fields = {
      thread_id: messageId,
      account: MINE,
      from_name: a.from_name,
      from_email: a.from_email,
      subject: a.subject,
      gist: a.gist,
      queue: a.queue ?? null,
      severity: a.severity ?? 'internal',
      is_urgent: a.urgent ?? false,
      state: 'open' as const,
      intent: a.intent ?? null,
      client_id: a.client_id ?? null,
      task_id: null,
      draft_started_at: a.draft ? new Date(receivedAt.getTime() + HOUR) : null,
      draft_url: a.draft ? `https://mail.google.com/mail/u/0/#drafts/${messageId}` : null,
      deep_link: `https://mail.google.com/mail/u/0/#inbox/${messageId}`,
      received_at: receivedAt,
    };
    await prisma.emailAsk.upsert({
      where: { message_id: messageId },
      create: { message_id: messageId, ...fields },
      update: fields,
    });
  }
  bump('email asks: open (threads, lead, crisis)', asks.length);

  // Classifier auto-closes in the last 24 hours (Handled for you).
  const handled = [
    { key: 'auto-1', from_name: 'Google Workspace', from_email: 'no-reply@accounts.google.example', subject: 'Security alert (already reviewed)' },
    { key: 'auto-2', from_name: 'Uptime Monitor', from_email: 'uptime@monitor.example', subject: 'Monitor recovered: fixture site' },
    { key: 'auto-3', from_name: 'Calendar', from_email: 'calendar-notification@google.example', subject: 'Accepted: Weekly sync' },
  ];
  for (let i = 0; i < handled.length; i++) {
    const h = handled[i];
    const messageId = `${MID}${h.key}`;
    const fields = {
      thread_id: messageId,
      account: MINE,
      from_name: h.from_name,
      from_email: h.from_email,
      subject: h.subject,
      gist: 'Closed by the classifier.',
      queue: 'answer' as const,
      severity: 'internal' as const,
      is_urgent: false,
      state: 'handled' as const,
      training_note: '[auto] no action needed',
      deep_link: `https://mail.google.com/mail/u/0/#inbox/${messageId}`,
      received_at: new Date(now.getTime() - (i + 2) * HOUR),
    };
    await prisma.emailAsk.upsert({
      where: { message_id: messageId },
      create: { message_id: messageId, ...fields },
      update: fields,
    });
  }
  bump('email asks: handled auto-closes', handled.length);

  // ---- Stronghold session ask ----
  const machine = await prisma.oracleMachine.upsert({
    where: { name: MACHINE_NAME },
    update: { last_heartbeat_at: now },
    create: { name: MACHINE_NAME, hostname: 'home-fixture-machine.local', last_heartbeat_at: now },
  });
  const SESSION_EXT_ID = `${MID}session-stronghold`;
  const sessionFields = {
    status: OracleSessionStatus.waiting,
    needs_attention: false,
    waiting_on: 'Approve the Stronghold cancel-pre-order wording?',
    ask_queue: AskQueue.decide,
    ask_severity: 'internal' as const,
    archived_at: null,
    title: 'Stronghold store copy round (home fixture)',
    last_event_at: now,
  };
  await prisma.oracleSession.upsert({
    where: {
      machine_id_source_external_id: {
        machine_id: machine.id,
        source: OracleSource.claude_code,
        external_id: SESSION_EXT_ID,
      },
    },
    update: sessionFields,
    create: {
      machine_id: machine.id,
      source: OracleSource.claude_code,
      external_id: SESSION_EXT_ID,
      started_at: new Date(now.getTime() - 3 * HOUR),
      ...sessionFields,
    },
  });
  bump('oracle sessions (ask)');

  // ---- One calendar event today ----
  const EVENT_ID = `${MID}meeting`;
  await prisma.calendarEvent.deleteMany({ where: { event_id: EVENT_ID } });
  await prisma.calendarEvent.create({
    data: {
      event_id: EVENT_ID,
      title: 'Stronghold copy review with Brian (home fixture)',
      starts_at: new Date(`${dateStr}T18:00:00.000Z`),
      ends_at: new Date(`${dateStr}T18:30:00.000Z`),
      all_day: false,
      meet_url: 'https://meet.google.com/home-fixture',
      attendees: [
        { email: 'brian@stronghold.example', display_name: 'Brian Hernon', response_status: 'accepted', organizer: true, self: false },
        { email: MINE, display_name: 'Mike', response_status: 'accepted', organizer: false, self: true },
      ],
    },
  });
  bump('calendar events');

  console.log('Seeded:');
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k}: ${v}`);
  console.log('');
  console.log(`Admin login (home_view = home):   ${ADMIN_EMAIL}  /  ${DEV_PASSWORD}`);
  console.log(`Tech login  (home_view = overlook): ${TECH_EMAIL}  /  ${DEV_PASSWORD}`);
  console.log(`Seeded for ${dateStr} (${TZ}).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
