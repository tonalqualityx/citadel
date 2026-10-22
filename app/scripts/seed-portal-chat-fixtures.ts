/**
 * Dev fixture seed for the portal chat Playwright coverage (phase C slice C3). Run
 * scripts/seed-portal-v2-phase1-fixtures.ts first (the fixture client, its two sites and owner).
 *
 *   (no flag)       chat mode `on`, both fixture sites switched on, four SitePage rows on site one
 *                   (Home, About with sections, Menu, Contact), and an engine-scope API key whose
 *                   raw value is ENGINE_KEY below (a test constant, never a real credential).
 *   --off           mode `off`, so the other portal specs see the stepper again.
 *   --age-jobs      moves every queued job of the fixture client 70 seconds into the past, which is
 *                   what an unclaimed job looks like after the 60 second tree-mode fallback.
 *   --inspect <id>  prints the task filed for chat intake <id> (tags, state) as one JSON line.
 *   --screens       (after the default setup) two conversations with fixed timestamps for the
 *                   screenshot pass: a request chat waiting on a page choice, and a filed request with
 *                   a numbers reply (with its source line) and a team reply. Prints their ids as JSON.
 *   --lazy-task     a filed portal request with NO conversation yet (a work page whose chat opens on the
 *                   first message); prints its id as JSON.
 *   --staged-task   a portal request staged for the client (status review, a preview url) and assigned to Mike, so
 *                   a cancel has a person to tell; prints its id as JSON.
 *   --live-task     a portal request that is live (status done), for the "Ask for a change" path; prints its id as JSON.
 *   --cancel-inspect <task id>  prints what a cancel left behind (status, tags, conversation state, open waits,
 *                   the assignee's notification rows and the cancel email rows) as one JSON line.
 *   --staff-reply <text>  a client-visible staff comment (what "Reply to client" writes) on the fixture client's newest
 *                   with_person conversation, from Mike. Playwright has no staff session, so this stands in for the
 *                   comments route; prints the first name the client should see.
 *   --cleanup       removes the chat rows, pages and key this seed made, and sets mode off.
 *
 * Refuses to run unless the database name contains "scratch" or "dev".
 */
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';

const dbName = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? '').pathname.replace(/^\//, '');
  } catch {
    return '';
  }
})();
if (!/scratch|dev/i.test(dbName)) {
  console.error(`Refusing to run: DATABASE_URL database "${dbName}" does not contain "scratch" or "dev".`);
  process.exit(1);
}

const prisma = new PrismaClient();

export const ENGINE_KEY = 'citadel_e2e-portal-chat-engine-key-fixture-0001';
const CLIENT_NAME = 'E2E Portal Client (fixture)';
const BAST_USER_ID = 'ca5335e7-a374-4eff-92dc-fd67ceef2297';

const PAGES = [
  { path: '/', title: 'Home', sections: [], depth: 0 },
  { path: '/about/', title: 'About', sections: [{ key: 'team', heading: 'The team' }, { key: 'story', heading: 'Our story' }], depth: 1 },
  { path: '/menu/', title: 'Menu', sections: [], depth: 1 },
  { path: '/contact/', title: 'Contact', sections: [], depth: 1 },
];

async function fixtureClient() {
  return prisma.client.findFirstOrThrow({ where: { name: CLIENT_NAME } });
}

async function setMode(mode: 'on' | 'off') {
  await prisma.appSettings.upsert({ where: { id: 'singleton' }, update: { portal_chat_mode: mode }, create: { id: 'singleton', portal_chat_mode: mode } });
}

async function setup() {
  const client = await fixtureClient();
  // Chat needs a live runner (a heartbeat inside three minutes) or it falls back to the stepper. The spec plays the
  // runner over the engine routes, which do not post a heartbeat, so the fixture does.
  await prisma.appSettings.upsert({ where: { id: 'singleton' }, update: { portal_chat_runner_seen_at: new Date() }, create: { id: 'singleton', portal_chat_runner_seen_at: new Date() } });
  const sites = await prisma.site.findMany({ where: { client_id: client.id, is_deleted: false }, orderBy: { name: 'asc' } });
  await prisma.site.updateMany({ where: { client_id: client.id }, data: { portal_chat_enabled: true } });
  const first = sites[0];
  for (const p of PAGES) {
    await prisma.sitePage.upsert({
      where: { site_id_path: { site_id: first.id, path: p.path } },
      create: { site_id: first.id, url: `https://e2e-portal-fixture.example${p.path}`, path: p.path, title: p.title, sections: p.sections, depth: p.depth, source: 'sitemap', last_seen_at: new Date() },
      update: { missing_since: null, title: p.title, sections: p.sections },
    });
  }
  await prisma.apiKey.deleteMany({ where: { name: 'e2e portal chat engine' } });
  await prisma.apiKey.create({
    data: {
      user_id: BAST_USER_ID,
      name: 'e2e portal chat engine',
      key_hash: crypto.createHash('sha256').update(ENGINE_KEY).digest('hex'),
      key_prefix: ENGINE_KEY.substring(0, 16),
      scopes: ['engine'],
    },
  });
  await setMode('on');
}

const SCREEN_INTAKE = 'e2e-screens-intake';
const SCREEN_WORK_REF = 'portal-chat:e2e-screens-work';
const at = (hhmm: string) => new Date(`2026-10-21T${hhmm}:00-04:00`);

async function screens() {
  await cleanup();
  await setup();
  const client = await fixtureClient();
  const owner = await prisma.clientContact.findFirstOrThrow({ where: { client_id: client.id, email: 'contact@e2e-portal-fixture.example' } });
  const site = await prisma.site.findFirstOrThrow({ where: { client_id: client.id, is_deleted: false }, orderBy: { name: 'asc' } });
  const page = (title: string) => prisma.sitePage.findFirstOrThrow({ where: { site_id: site.id, title } });
  const [about, home, menu] = await Promise.all([page('About'), page('Home'), page('Menu')]);
  const mkTask = (ref: string, title: string, clientTitle: string) =>
    prisma.task.create({
      data: {
        title, client_title: clientTitle, client_id: client.id, site_id: site.id, requested_by_contact_id: owner.id, source: 'portal', source_ref: ref,
        status: 'not_started', tags: ['portal-chat'], assignee_id: BAST_USER_ID,
      },
    });
  const say = (task_id: string, content: string, when: Date, extra: Record<string, unknown>) =>
    prisma.comment.create({ data: { task_id, content, created_at: when, updated_at: when, client_visible: true, is_internal: false, ...extra } as never });
  const mine = { author_contact_id: owner.id, user_id: null, source: 'portal' };
  const bot = { user_id: BAST_USER_ID, source: 'assistant' };

  // 1. A request chat waiting on a page choice.
  const t1 = await mkTask(`portal-chat:${SCREEN_INTAKE}`, 'Request: Can you add this picture to the website?', 'Add a picture to the website');
  await prisma.chatConversation.create({
    data: {
      task_id: t1.id, client_id: client.id, site_id: site.id, opened_by_contact_id: owner.id, intake_id: SCREEN_INTAKE, state: 'clarifying', email_token: 'e2escreensa1',
      slots: { site_id: site.id, request_type: 'site_change', attachment_ids: [] },
      open_ask: { slot: 'page', question: 'Which page should this photo go on?', choice_ids: [about.id, home.id, menu.id], allow_free_text: true, allow_upload: false },
    },
  });
  await say(t1.id, 'Can you add this picture to the website?', at('13:57'), mine);
  await say(t1.id, "Which page should this photo go on?", at('13:57'), { ...bot, chat_meta: { fixed: false } });

  // 2. A filed request with a numbers reply and a team reply.
  const t2 = await mkTask(SCREEN_WORK_REF, 'Site change: team photo', 'Update the team photo');
  await prisma.chatConversation.create({
    data: { task_id: t2.id, client_id: client.id, site_id: site.id, opened_by_contact_id: owner.id, state: 'filed', confirmed_at: at('09:30'), email_token: 'e2escreensb2', slots: { site_id: site.id } },
  });
  await say(t2.id, 'Please swap the team photo on the About page.', at('09:20'), mine);
  await say(t2.id, 'Thanks. I have what I need and sent it to the team.', at('09:30'), bot);
  await say(t2.id, 'How many people visited the site last week?', at('13:50'), mine);
  await say(t2.id, 'Google Analytics shows 412 visits from October 12 to October 18.', at('13:51'), {
    ...bot,
    chat_meta: { sources: [{ label: 'Google Analytics, Oct 12 to Oct 18, 2026', range: 'Oct 12 to Oct 18, 2026' }] },
  });
  await say(t2.id, 'The new photo is on the preview now. Take a look when you can.', at('13:55'), { user_id: (await prisma.user.findFirstOrThrow({ where: { email: 'admin@indelible.agency' } })).id, source: null });
  console.log(JSON.stringify({ request_intake: SCREEN_INTAKE, request_conversation_id: (await prisma.chatConversation.findUniqueOrThrow({ where: { task_id: t1.id } })).id, work_task_id: t2.id }));
}

async function cleanup() {
  const client = await fixtureClient();
  const tasks = await prisma.task.findMany({ where: { client_id: client.id, source_ref: { startsWith: 'portal-chat:' } }, select: { id: true } });
  const convos = await prisma.chatConversation.findMany({ where: { client_id: client.id }, select: { id: true, task_id: true } });
  const taskIds = [...new Set([...tasks.map((t) => t.id), ...convos.map((c) => c.task_id)])];
  const jobs = await prisma.engineJob.findMany({ where: { client_id: client.id }, select: { id: true } });
  const jobIds = jobs.map((j) => j.id);
  await prisma.engineToolCall.deleteMany({ where: { job_id: { in: jobIds } } });
  await prisma.engineRun.deleteMany({ where: { job_id: { in: jobIds } } });
  await prisma.engineJob.deleteMany({ where: { id: { in: jobIds } } });
  await prisma.waitEvent.deleteMany({ where: { wait: { task_id: { in: taskIds } } } });
  await prisma.wait.deleteMany({ where: { task_id: { in: taskIds } } });
  await prisma.notification.deleteMany({ where: { entity_id: { in: taskIds } } });
  await prisma.emailOutbox.deleteMany({ where: { dedupe_key: { in: taskIds.map((id) => `portal-cancel:${id}`) } } });
  await prisma.portalAttachment.deleteMany({ where: { client_id: client.id } });
  await prisma.chatConversation.deleteMany({ where: { client_id: client.id } });
  await prisma.comment.deleteMany({ where: { task_id: { in: taskIds } } });
  await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
  await prisma.sitePage.deleteMany({ where: { site: { client_id: client.id } } });
  await prisma.site.updateMany({ where: { client_id: client.id }, data: { portal_chat_enabled: false } });
  await prisma.apiKey.deleteMany({ where: { name: 'e2e portal chat engine' } });
  await setMode('off');
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--off')) return setMode('off');
  if (args.includes('--cleanup')) return cleanup();
  if (args.includes('--lazy-task')) {
    const client = await fixtureClient();
    const owner = await prisma.clientContact.findFirstOrThrow({ where: { client_id: client.id, email: 'contact@e2e-portal-fixture.example' } });
    const site = await prisma.site.findFirstOrThrow({ where: { client_id: client.id, is_deleted: false }, orderBy: { name: 'asc' } });
    const task = await prisma.task.create({
      data: {
        title: 'Site change: lazy chat', client_title: 'Lazy chat request', client_id: client.id, site_id: site.id, requested_by_contact_id: owner.id,
        source: 'portal', source_ref: 'portal-chat:e2e-lazy', status: 'not_started', tags: ['portal-chat'], assignee_id: BAST_USER_ID,
      },
    });
    console.log(JSON.stringify({ task_id: task.id }));
    return;
  }
  if (args.includes('--staged-task')) {
    const client = await fixtureClient();
    const owner = await prisma.clientContact.findFirstOrThrow({ where: { client_id: client.id, email: 'contact@e2e-portal-fixture.example' } });
    const site = await prisma.site.findFirstOrThrow({ where: { client_id: client.id, is_deleted: false }, orderBy: { name: 'asc' } });
    const mike = await prisma.user.findFirstOrThrow({ where: { email: 'mike@becomeindelible.com' }, select: { id: true } });
    const task = await prisma.task.create({
      data: {
        title: 'Site change: staged for cancel', client_title: 'Staged hours change', client_id: client.id, site_id: site.id, requested_by_contact_id: owner.id,
        source: 'portal', source_ref: `portal-chat:e2e-staged-${Date.now()}`, status: 'review', tags: ['portal-chat'], assignee_id: mike.id,
        staging_preview_url: 'https://preview.e2e-portal-fixture.example/hours', staging_deployed_at: new Date(),
      },
    });
    console.log(JSON.stringify({ task_id: task.id }));
    return;
  }
  if (args.includes('--live-task')) {
    const client = await fixtureClient();
    const owner = await prisma.clientContact.findFirstOrThrow({ where: { client_id: client.id, email: 'contact@e2e-portal-fixture.example' } });
    const site = await prisma.site.findFirstOrThrow({ where: { client_id: client.id, is_deleted: false }, orderBy: { name: 'asc' } });
    const task = await prisma.task.create({
      data: {
        title: 'Site change: live hours', client_title: 'Live hours change', client_id: client.id, site_id: site.id, requested_by_contact_id: owner.id,
        source: 'portal', source_ref: `portal-chat:e2e-live-${Date.now()}`, status: 'done', completed_at: new Date(), tags: ['portal-chat'], assignee_id: BAST_USER_ID,
      },
    });
    console.log(JSON.stringify({ task_id: task.id }));
    return;
  }
  const ci = args.indexOf('--cancel-inspect');
  if (ci >= 0) {
    const id = args[ci + 1];
    const task = await prisma.task.findUniqueOrThrow({ where: { id }, select: { status: true, tags: true, assignee_id: true } });
    const convo = await prisma.chatConversation.findUnique({ where: { task_id: id }, select: { state: true } });
    const waits = await prisma.wait.findMany({ where: { task_id: id }, select: { state: true, resolution: true } });
    const notifications = task.assignee_id ? await prisma.notification.count({ where: { entity_type: 'task', entity_id: id, user_id: task.assignee_id, title: { startsWith: 'Client cancelled a request' } } }) : 0;
    const emails = await prisma.emailOutbox.count({ where: { dedupe_key: `portal-cancel:${id}` } });
    const lines = await prisma.comment.count({ where: { task_id: id, content: 'You cancelled this request.' } });
    console.log(JSON.stringify({ task, convo, waits, notifications, emails, lines }));
    return;
  }
  if (args.includes('--screens')) return screens();
  if (args.includes('--age-jobs')) {
    const client = await fixtureClient();
    const past = new Date(Date.now() - 70_000);
    const r = await prisma.engineJob.updateMany({ where: { client_id: client.id, status: 'queued' }, data: { queued_at: past } });
    console.log(JSON.stringify({ aged: r.count }));
    return;
  }
  const sr = args.indexOf('--staff-reply');
  if (sr >= 0) {
    const client = await fixtureClient();
    const convo = await prisma.chatConversation.findFirstOrThrow({ where: { client_id: client.id, state: 'with_person' }, orderBy: { created_at: 'desc' } });
    const mike = await prisma.user.findFirstOrThrow({ where: { email: 'mike@becomeindelible.com' }, select: { id: true, name: true } });
    await prisma.comment.create({ data: { task_id: convo.task_id, user_id: mike.id, content: args[sr + 1], client_visible: true } });
    console.log(JSON.stringify({ first_name: mike.name.trim().split(/\s+/)[0] }));
    return;
  }
  const i = args.indexOf('--inspect');
  if (i >= 0) {
    const task = await prisma.task.findFirst({ where: { source_ref: `portal-chat:${args[i + 1]}` }, select: { id: true, title: true, tags: true, status: true } });
    const convo = task ? await prisma.chatConversation.findUnique({ where: { task_id: task.id }, select: { state: true, mode: true } }) : null;
    console.log(JSON.stringify({ task, convo }));
    return;
  }
  await setup();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
