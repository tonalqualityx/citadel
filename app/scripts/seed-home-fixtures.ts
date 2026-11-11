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
 * Slice 4a adds: a client thread with a Bast draft written for an older message (the redraft case) and a client thread
 * with a needs-thought row and a suggested answer, both with home_owed_thread rows for the admin only. The existing
 * lead, the client thread with no draft (Mark) and the two threads with his own drafts (Jessica, Andy) are the other
 * cases; the Jill's Cafe mail is the crisis. Nothing in the seed sends mail or touches an outbox.
 *
 * Slice 6a adds: a Kuma-style site down incident (12 minutes old, shown) and a second one (5 minutes old, not shown yet) for the
 * admin only; an uptime-mail incident whose own check found the site down (the mail is linked from one row); a "Not an emergency"
 * rule on the WPMU DEV sender (an urgent mail from it is in Rest, not in Needs you now) saved as a confirmed Decision (lane
 * home-emergency) for the admin; and five open tasks tagged hands or credential-rotation (the Monday row shows from Monday 00:05 to
 * Friday 23:59 Eastern; on a weekend the jobs sit in Everything else, "This week's hands"). Nothing here requests a site or sends mail.
 *
 * Run with:
 *   DATABASE_URL=postgresql://citadel:citadel@localhost:55433/home_s2a \
 *     npx ts-node -r tsconfig-paths/register --compiler-options '{"module":"CommonJS"}' scripts/seed-home-fixtures.ts
 */
import {
  PrismaClient,
  UserRole,
  OracleSource,
  OracleSessionStatus,
  AskQueue,
} from '@prisma/client';
import bcrypt from 'bcryptjs';
import { BAST_USER_ID } from '../lib/oracle/projects/gate-constants';
import { threadKey } from '../lib/home/item-key';

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
  await prisma.homeOwedThread.deleteMany({ where: { user_id: { in: [admin.id, tech.id] } } });
  await prisma.homeKeeperRun.deleteMany({ where: { user_id: { in: [admin.id, tech.id] }, kind: 'owed_reply' } });
  await prisma.homeSiteIncident.deleteMany({ where: { user_id: { in: [admin.id, tech.id] } } });
  // The rules this seed saved for the two fixture users (their own Decision rows and links, nothing else).
  await prisma.decision.deleteMany({ where: { key: { startsWith: 'home-not-emergency:' }, created_by_id: { in: [admin.id, tech.id] } } });

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

  // ---- Slice 2a fixtures: kickoff, quote, undated pile, dated tasks, hard date, Not-now, long description ----
  const s2: Record<string, string> = {};
  const mk = async (label: string, data: Record<string, unknown>) => {
    const t = await prisma.task.create({
      data: { ...base, status: 'not_started', tags: [FIXTURE_TAG], ...data } as never,
    });
    s2[label] = t.id;
    return t;
  };
  const ago = (days: number) => new Date(now.getTime() - days * DAY);
  const ahead = (days: number) => new Date(now.getTime() + days * DAY);

  await mk('kickoff', {
    title: 'Stronghold: kick off the shop build with Brian',
    tags: ['from-chat', 'kickoff', FIXTURE_TAG],
    client_id: stronghold.id,
    created_at: ago(1),
  });
  await mk('quote', {
    title: 'Honeycutt: quote the second location page',
    tags: ['from-chat', 'quote', FIXTURE_TAG],
    client_id: andyClient.id,
    created_at: ago(1),
  });
  for (let i = 1; i <= 12; i++) {
    const age = 10 + Math.round(((i - 1) * 30) / 11); // 10 to 40 days
    await mk(`undated-${String(i).padStart(2, '0')}`, {
      title: `Undated chore ${String(i).padStart(2, '0')}: tidy a loose end`,
      created_at: ago(age),
    });
  }
  const createdA = ago(7);
  await mk('dated-five-days', {
    title: 'Dated: due exactly 5 days after it was created',
    created_at: createdA,
    due_date: new Date(createdA.getTime() + 5 * DAY),
  });
  await mk('dated-40-past', {
    title: 'Dated: due date 40 days in the past',
    created_at: ago(60),
    due_date: ago(40),
  });
  await mk('dated-10-ahead', {
    title: 'Dated: due in 10 days, created 30 days ago',
    created_at: ago(30),
    due_date: ahead(10),
  });
  // Hard date 2 business days out (skip Saturday and Sunday).
  const hard = new Date(now);
  for (let left = 2; left > 0; ) {
    hard.setUTCDate(hard.getUTCDate() + 1);
    const dow = hard.getUTCDay();
    if (dow !== 0 && dow !== 6) left--;
  }
  hard.setUTCHours(17, 0, 0, 0);
  await mk('hard-date', {
    title: 'Renew the fixture domain',
    created_at: ago(14),
    hard_due_at: hard,
    hard_due_source: 'domain renews',
  });
  const notNow = await mk('not-now', {
    title: 'Not now: sort the old photo folders',
    created_at: ago(20),
  });
  const tomorrow = zonedDate(new Date(now.getTime() + DAY), TZ);
  await prisma.homeItemState.create({
    data: {
      user_id: admin.id,
      item_key: `task:${notNow.id}`,
      park_count: 1,
      view_at: new Date(`${tomorrow}T05:05:00.000Z`),
      view_set_by: 'user',
    },
  });
  const words = Array.from({ length: 300 }, (_, i) => `word${i + 1}`);
  const longDescription = Array.from({ length: 6 }, (_, p) => words.slice(p * 50, p * 50 + 50).join(' ')).join('\n\n');
  await mk('long-description', {
    title: 'Long description: write up the hosting move notes',
    description: longDescription,
    created_at: ago(12),
  });
  bump('tasks: slice 2a fixtures', Object.keys(s2).length);

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

  // ---- Slice 4a: owed replies (Bast's drafts and reads, for the admin only) ----
  const owedAsk = async (messageId: string, threadId: string, fields: { from_name: string; from_email: string; subject: string; gist: string; ageMs: number }) => {
    const data = {
      thread_id: threadId,
      account: MINE,
      from_name: fields.from_name,
      from_email: fields.from_email,
      subject: fields.subject,
      gist: fields.gist,
      queue: 'answer' as const,
      severity: 'internal' as const,
      is_urgent: false,
      state: 'open' as const,
      intent: null,
      client_id: markClient.id,
      task_id: null,
      draft_started_at: null,
      draft_url: null,
      deep_link: `https://mail.google.com/mail/u/0/#inbox/${threadId}`,
      received_at: new Date(now.getTime() - fields.ageMs),
    };
    return prisma.emailAsk.upsert({ where: { message_id: messageId }, create: { message_id: messageId, ...data }, update: data });
  };
  // A thread Bast drafted for the first message; a second message has come since (the redraft case).
  const redraftThread = `${MID}owed-redraft`;
  const redraftFirst = await owedAsk(`${MID}owed-redraft-1`, redraftThread, { from_name: 'Dana Whitfield', from_email: 'dana@mitchell.example', subject: 'Photos for the hours page', gist: 'Dana sent the photos for the hours page.', ageMs: 4 * DAY });
  await owedAsk(`${MID}owed-redraft-2`, redraftThread, { from_name: 'Dana Whitfield', from_email: 'dana@mitchell.example', subject: 'Re: Photos for the hours page', gist: 'Dana adds one more photo.', ageMs: 2 * DAY });
  await prisma.homeOwedThread.create({
    data: {
      user_id: admin.id,
      thread_key: threadKey(MINE, redraftThread),
      state: 'drafted',
      draft_id: 'fixture-draft-1',
      draft_message_id: 'fixture-draft-msg-1',
      draft_hash: 'fixture-hash-1',
      draft_text: 'Hi Dana,\n\nThanks for the photos. I have them and will take a look.\n\nMike',
      draft_for_ask_id: redraftFirst.id,
      drafted_at: new Date(now.getTime() - 3 * DAY),
    },
  });
  // A thread where the reply needs thought: Bast's read and a suggested answer.
  const thoughtThread = `${MID}owed-thought`;
  await owedAsk(`${MID}owed-thought-1`, thoughtThread, { from_name: 'Omar Faizi', from_email: 'omar@mitchell.example', subject: 'Can you add a shop page?', gist: 'Omar wants a shop page added.', ageMs: 3 * DAY });
  await prisma.homeOwedThread.create({
    data: {
      user_id: admin.id,
      thread_key: threadKey(MINE, thoughtThread),
      state: 'needs_thought',
      bast_read: 'Omar is asking for new work, and the reply decides whether to take it.',
      suggested_answer: 'Thank him and ask what the shop would sell.',
      needs_commitment: false,
      thought_since: new Date(now.getTime() - HOUR),
    },
  });
  bump('email asks: Slice 4a redraft thread (2) and needs-thought thread (1)', 3);
  bump('home_owed_thread rows (admin only)', 2);

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

  // ---- Slice 3 fixtures: a task Bast stopped on, and a bot comment mentioning the home admin and the tech ----
  const bast = await prisma.user.upsert({
    where: { id: BAST_USER_ID },
    update: { is_active: true },
    create: { id: BAST_USER_ID, email: 'bast-home-fixture@indelible.test', name: 'Bast (home fixture)', role: UserRole.tech, password_hash: passwordHash },
  });
  const bastTask = await prisma.task.create({
    data: {
      title: 'Grok: confirm which hosting account the old backups live in',
      status: 'not_started',
      tags: ['needs-mike', FIXTURE_TAG],
      assignee_id: bast.id,
      created_by_id: bast.id,
      needs_review: false,
      client_id: grok.id,
      estimated_minutes: 10,
      created_at: ago(2),
    },
  });
  s2['bast_needs_mike'] = bastTask.id;
  const bastComment = await prisma.comment.create({
    data: {
      task_id: bastTask.id,
      user_id: bast.id,
      content: 'Stopped here. I cannot tell which account holds the backups. Need an answer before I go on.',
      mentioned_user_ids: [admin.id, tech.id],
      is_internal: true,
    },
  });
  s2['bast_comment'] = bastComment.id;
  bump('tasks: Bast needs-mike');
  bump('comments: bot mention of admin and tech');

  // ---- Slice 2c fixtures: a stale arc, an all-done arc, an arc holding Sabeen's task, a client group with no arc ----
  const sabeen = await prisma.user.upsert({
    where: { email: 'sabeen-home-fixture@indelible.test' },
    update: { is_active: true },
    create: { email: 'sabeen-home-fixture@indelible.test', name: 'Sabeen (home fixture)', role: UserRole.tech, password_hash: passwordHash },
  });
  const arcFor = async (name: string, clientId: string | null) => {
    const found = await prisma.arc.findFirst({ where: { name } });
    const a = found ?? (await prisma.arc.create({ data: { name, client_id: clientId } }));
    await prisma.arc.update({ where: { id: a.id }, data: { closed_at: null, snoozed_until: null } });
    return a;
  };
  const old = (days: number) => new Date(now.getTime() - days * DAY);
  const backdate = async (arcId: string, taskIds: string[], days: number) => {
    await prisma.$executeRaw`UPDATE arcs SET updated_at = ${old(days)} WHERE id = ${arcId}::uuid`;
    for (const id of taskIds) await prisma.$executeRaw`UPDATE tasks SET updated_at = ${old(days)} WHERE id = ${id}::uuid`;
  };
  const rowan = await findOrCreateClient('Rowan Pottery (home fixture)');
  const staleArc = await arcFor('Stale arc (home fixture)', null);
  const staleTask = await mk('stale_arc_task', { title: 'Old thread: look at the stale thing again', arc_id: staleArc.id, tags: [FIXTURE_TAG], created_at: old(60) });
  await backdate(staleArc.id, [staleTask.id], 40);
  const doneArc = await arcFor('All done arc (home fixture)', null);
  const doneA = await mk('done_arc_a', { title: 'Finished step one (home fixture)', status: 'done', arc_id: doneArc.id, completed_at: old(3) });
  const doneB = await mk('done_arc_b', { title: 'Finished step two (home fixture)', status: 'done', arc_id: doneArc.id, completed_at: old(2) });
  await backdate(doneArc.id, [doneA.id, doneB.id], 2);
  const sabeenArc = await arcFor('Held by Sabeen arc (home fixture)', null);
  const sabeenTask = await mk('sabeen_task', { title: 'Sabeen: her own step on a shared arc', assignee_id: sabeen.id, created_by_id: sabeen.id, arc_id: sabeenArc.id, created_at: old(60) });
  const sabeenMine = await mk('sabeen_arc_mine', { title: 'Mine on the shared arc (home fixture)', arc_id: sabeenArc.id, created_at: old(60) });
  await backdate(sabeenArc.id, [sabeenTask.id, sabeenMine.id], 40);
  for (let i = 1; i <= 3; i++) await mk(`rowan_${i}`, { title: `Rowan Pottery: open task ${i}`, client_id: rowan.id, created_at: ago(2) });
  bump('arcs: stale / all done / Sabeen / client group with none', 3);

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

  // ---- Slice 6a fixtures: site down incidents, a saved rule, the hands tasks ----
  const kumaSite = await findOrCreateSite('Rowan Pottery site', rowan.id);
  const youngSite = await findOrCreateSite('Alder Books site', (await findOrCreateClient('Alder Books (home fixture)')).id);
  const mailSite = jillsSite;
  const siteHost = (url: string | null) => (url ?? '').replace(/^https?:\/\//, '').replace(/[/?#].*$/, '');
  const [kumaRow, youngRow] = await Promise.all([prisma.site.findUniqueOrThrow({ where: { id: kumaSite.id } }), prisma.site.findUniqueOrThrow({ where: { id: youngSite.id } })]);
  await prisma.homeSiteIncident.create({
    data: {
      user_id: admin.id,
      site_id: kumaSite.id,
      domain: siteHost(kumaRow.url),
      client_id: rowan.id,
      source: 'kuma',
      monitor: 'rowan-pottery',
      started_at: new Date(now.getTime() - 12 * MIN),
      last_checked_at: new Date(now.getTime() - 2 * MIN),
      watchdog_escalated: true,
    },
  });
  await prisma.homeSiteIncident.create({
    data: {
      user_id: admin.id,
      site_id: youngSite.id,
      domain: siteHost(youngRow.url),
      client_id: youngRow.client_id,
      source: 'kuma',
      monitor: 'alder-books',
      started_at: new Date(now.getTime() - 5 * MIN),
      last_checked_at: new Date(now.getTime() - 1 * MIN),
    },
  });
  const jillsMail = await prisma.emailAsk.findFirst({ where: { message_id: `${MID}crisis-jills` }, select: { id: true } });
  if (jillsMail) {
    await prisma.homeSiteIncident.create({
      data: {
        user_id: admin.id,
        site_id: mailSite.id,
        domain: siteHost((await prisma.site.findUniqueOrThrow({ where: { id: mailSite.id } })).url),
        client_id: jills.id,
        source: 'uptime_mail',
        ask_ids: [jillsMail.id],
        started_at: new Date(now.getTime() - 30 * MIN),
        last_checked_at: new Date(now.getTime() - 3 * MIN),
        last_check_up: false,
        check_summary: 'No answer after 3 tries.',
      },
    });
  }
  bump('home_site_incident rows (admin only)', jillsMail ? 3 : 2);

  const wpmuMessage = `${MID}crisis-wpmu`;
  const wpmuFields = {
    thread_id: wpmuMessage,
    account: MINE,
    from_name: 'WPMU DEV',
    from_email: 'alerts@wpmudev.example',
    subject: 'Weekly security report is ready',
    gist: 'The weekly report from the host. Not an outage.',
    queue: 'do' as const,
    severity: 'internal' as const,
    is_urgent: true,
    state: 'open' as const,
    deep_link: `https://mail.google.com/mail/u/0/#inbox/${wpmuMessage}`,
    received_at: new Date(now.getTime() - 3 * HOUR),
  };
  const wpmuAsk = await prisma.emailAsk.upsert({ where: { message_id: wpmuMessage }, create: { message_id: wpmuMessage, ...wpmuFields }, update: wpmuFields });
  const ruleKey = 'home-not-emergency:sender:alerts@wpmudev.example';
  const rule = await prisma.decision.upsert({
    where: { key: ruleKey },
    create: {
      key: ruleKey,
      title: 'Not an emergency: mail from alerts@wpmudev.example is not an emergency',
      text: 'Weekly report, never an outage.',
      kind: 'ruling',
      status: 'confirmed',
      scope: 'lane',
      lane: 'home-emergency',
      author_user_id: admin.id,
      ruled_at: now,
      confirmed_by_user_id: admin.id,
      confirmed_at: now,
      created_by_id: admin.id,
      tags: ['home-screen', 'not-emergency'],
    },
    update: { status: 'confirmed', lane: 'home-emergency', created_by_id: admin.id, confirmed_by_user_id: admin.id, confirmed_at: now },
    select: { id: true },
  });
  await prisma.decisionLink.upsert({
    where: { decision_id_entity_kind_entity_id_relation: { decision_id: rule.id, entity_kind: 'email_ask', entity_id: wpmuAsk.id, relation: 'ruled_on' } },
    create: { decision_id: rule.id, entity_kind: 'email_ask', entity_id: wpmuAsk.id, relation: 'ruled_on' },
    update: {},
  });
  bump('email asks: WPMU DEV urgent mail (covered by the saved rule)');
  bump('decisions: one saved Not an emergency rule (admin)');

  const handsJobs: Array<{ title: string; tags: string[]; minutes: number | null }> = [
    { title: 'Rotate the SFTP password for Grok (home fixture)', tags: ['credential-rotation', FIXTURE_TAG], minutes: 10 },
    { title: 'Rotate the SFTP password for Rowan Pottery (home fixture)', tags: ['credential-rotation', FIXTURE_TAG], minutes: 10 },
    { title: 'Update the DNS record for the Alder subdomain (home fixture)', tags: ['hands', FIXTURE_TAG], minutes: 15 },
    { title: 'Move the Stronghold domain to the new registrar (home fixture)', tags: ['hands', FIXTURE_TAG], minutes: null },
    { title: 'Add the new analytics property to the GA4 admin (home fixture)', tags: ['hands', FIXTURE_TAG], minutes: 5 },
  ];
  for (const j of handsJobs) {
    await prisma.task.create({
      data: { ...base, title: j.title, status: 'not_started', tags: j.tags, estimated_minutes: j.minutes, created_at: new Date(now.getTime() - 9 * DAY) },
    });
  }
  bump('tasks: hands and credential-rotation', handsJobs.length);

  console.log('Seeded:');
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k}: ${v}`);
  console.log('');
  console.log(`Admin login (home_view = home):   ${ADMIN_EMAIL}  /  ${DEV_PASSWORD}`);
  console.log(`Tech login  (home_view = overlook): ${TECH_EMAIL}  /  ${DEV_PASSWORD}`);
  console.log(`Seeded for ${dateStr} (${TZ}).`);
  console.log('Slice 2a fixture task ids (key: id):');
  for (const [k, v] of Object.entries(s2)) console.log(`  ${k}: ${v}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
