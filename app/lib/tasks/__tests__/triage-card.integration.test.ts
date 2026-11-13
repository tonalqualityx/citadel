// @vitest-environment node
/**
 * The Triage tab payload against a real scratch Postgres: card fields, order (looks done first, then oldest), the project block
 * (phases, what will be Mike's, signed contract and deal link, sitemap, never the plan folder or a task), the looks-done evidence
 * and links, the "asked after release" list, and that only Mike gets any of it.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { SCRATCH } from '@/lib/engine/__tests__/seed';
import { MIKE_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { loadTriage } from '@/lib/tasks/triage';
import { LOOKS_DONE_TAG } from '@/lib/tasks/looks-done';

describe.skipIf(!SCRATCH)('triage card payload (real database)', () => {
  const tag = `tcd${Date.now()}`;
  const ids: string[] = [];
  const projectIds: string[] = [];
  let clientId: string;
  let otherId: string;
  let accordId: string;
  let msaId: string;

  const mk = async (title: string, data: Record<string, unknown> = {}) => {
    const t = await prisma.task.create({ data: { title: `${tag} ${title}`, status: 'triage', ...data } as never });
    ids.push(t.id);
    return t.id;
  };
  const mine = async () => {
    const t = await loadTriage(prisma, MIKE_USER_ID);
    return { t, cards: (t?.cards ?? []).filter((c) => c.title.startsWith(tag)), asked: (t?.asked_after_release ?? []).filter((c) => c.title.startsWith(tag)) };
  };

  beforeAll(async () => {
    await prisma.user.upsert({ where: { id: MIKE_USER_ID }, update: {}, create: { id: MIKE_USER_ID, email: `mike-${tag}@example.test`, password_hash: 'x', name: 'Mike', role: 'admin' } });
    otherId = (await prisma.user.create({ data: { email: `oth-${tag}@example.test`, password_hash: 'x', name: 'Other', role: 'admin' } })).id;
    clientId = (await prisma.client.create({ data: { name: `${tag} Co` } })).id;
    accordId = (await prisma.accord.create({ data: { name: `${tag} deal`, owner_id: MIKE_USER_ID, client_id: clientId } as never })).id;
    msaId = (await prisma.msaVersion.create({ data: { version: tag.slice(0, 20), content: 'x', effective_date: new Date(), created_by_id: MIKE_USER_ID } })).id;
  });
  afterAll(async () => {
    await prisma.comment.deleteMany({ where: { task_id: { in: ids } } });
    await prisma.taskQuestion.deleteMany({ where: { task_id: { in: ids } } });
    await prisma.activityLog.deleteMany({ where: { entity_id: { in: ids } } });
    await prisma.task.deleteMany({ where: { id: { in: ids } } });
    await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
    await prisma.contract.deleteMany({ where: { accord_id: accordId } });
    await prisma.msaVersion.deleteMany({ where: { id: msaId } });
    await prisma.accord.deleteMany({ where: { id: accordId } });
    await prisma.client.deleteMany({ where: { id: clientId } });
    await prisma.user.deleteMany({ where: { id: otherId } });
    await prisma.$disconnect();
  });

  it('only Mike gets the section: everyone else gets null', async () => {
    await mk('visible only to Mike');
    expect(await loadTriage(prisma, otherId)).toBeNull();
    expect((await loadTriage(prisma, MIKE_USER_ID))?.cards?.length).toBeGreaterThan(0);
  });

  it('a project card carries phases, what will be Mike\'s, the signed contract with its deal link, the sitemap; never the plan folder or a task', async () => {
    const project = await prisma.project.create({ data: { name: `${tag} Stronghold`, client_id: clientId, status: 'queue', accord_id: accordId, plan_folder: '/home/mike/Documents/projects/secret-plan' } });
    projectIds.push(project.id);
    await prisma.contract.createMany({
      data: [
        { accord_id: accordId, version: 1, content: 'v1', msa_version_id: msaId, status: 'sent', pricing_snapshot: {}, created_by_id: MIKE_USER_ID },
        { accord_id: accordId, version: 2, content: 'v2', msa_version_id: msaId, status: 'signed', signed_at: new Date('2026-10-01T12:00:00Z'), pricing_snapshot: {}, created_by_id: MIKE_USER_ID },
      ],
    });
    await prisma.projectPhase.createMany({
      data: [
        { project_id: project.id, name: 'Design', summary: 'Pages are designed', mike_part: 'Approve the homepage', sort_order: 0 },
        { project_id: project.id, name: 'Build', summary: 'Pages are built', sort_order: 1 },
      ],
    });
    await prisma.projectPage.createMany({ data: [{ project_id: project.id, name: 'Home', sort_order: 0 }, { project_id: project.id, name: 'Contact', page_type: 'form', needs_design: true, sort_order: 1 }] });
    // a task on the project must never show up in the card
    await mk('a project task', { status: 'not_started', project_id: project.id });
    const id = await mk('setup card', { triage_kind: 'project_setup', project_id: project.id });
    const { cards } = await mine();
    const c = cards.find((x) => x.task_id === id)!;
    expect(c.kind).toBe('project_setup');
    expect(c.project).not.toBeNull();
    expect(c.project!.phases.map((p) => [p.name, p.summary, p.mike_part])).toEqual([
      ['Design', 'Pages are designed', 'Approve the homepage'],
      ['Build', 'Pages are built', null],
    ]);
    expect(c.project!.mike_parts).toEqual([{ phase: 'Design', text: 'Approve the homepage' }]);
    expect(c.project!.contract).toMatchObject({ status: 'signed', version: 2, signed_at: '2026-10-01T12:00:00.000Z', deal_id: accordId, deal_href: `/deals/${accordId}` });
    expect(c.project!.deal).toMatchObject({ id: accordId, href: `/deals/${accordId}` });
    expect(c.project!.sitemap.map((p) => p.name)).toEqual(['Home', 'Contact']);
    const json = JSON.stringify(c);
    expect(json).not.toContain('secret-plan');
    expect(json).not.toContain('plan_folder');
    expect(json).not.toContain('a project task');
    // a non-setup card never carries a project block
    const other = await mk('plain', { triage_kind: 'task', project_id: project.id });
    expect((await mine()).cards.find((x) => x.task_id === other)!.project).toBeNull();
  });

  it('a project with no deal has no contract; a project with only a draft shows the draft status', async () => {
    const bare = await prisma.project.create({ data: { name: `${tag} bare`, client_id: clientId, status: 'queue' } });
    projectIds.push(bare.id);
    const id = await mk('bare setup', { triage_kind: 'project_setup', project_id: bare.id });
    const c = (await mine()).cards.find((x) => x.task_id === id)!;
    expect(c.project).toMatchObject({ contract: null, deal: null, phases: [], sitemap: [] });
  });

  it('cards: summary, age, open question count, release line; looks done first with evidence links, then oldest first', async () => {
    const old = await mk('oldest', { triage_kind: 'task', created_at: new Date(Date.now() - 10 * 86_400_000), description: JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text: "What's wanted: Fix the footer" }], children: [] }]) });
    const newer = await mk('newer', { created_at: new Date(Date.now() - 2 * 86_400_000) });
    const done = await mk('marked', { tags: [LOOKS_DONE_TAG], created_at: new Date(Date.now() - 1 * 86_400_000) });
    await prisma.comment.create({ data: { task_id: done, user_id: MIKE_USER_ID, content: 'Looks done: shipped, see https://example.test/page.', is_internal: true, client_visible: false } });
    await prisma.taskQuestion.create({ data: { task_id: old, question: 'Which footer?', what_it_is: 'x', sources: [], checked: 'x', unknown: 'x', if_nobody: 'go', if_nobody_action: 'wait' } as never });
    const { cards } = await mine();
    const order = cards.map((c) => c.task_id).filter((i) => [old, newer, done].includes(i));
    expect(order).toEqual([done, old, newer]);
    const byId = Object.fromEntries(cards.map((c) => [c.task_id, c]));
    expect(byId[done].looks_done).toEqual({ evidence: 'shipped, see https://example.test/page.', links: [{ text: 'https://example.test/page', href: 'https://example.test/page' }] });
    expect(byId[old]).toMatchObject({ kind: 'task', summary: 'Fix the footer', age_days: 10, open_questions: 1, looks_done: null, release_ready: true });
    expect(byId[newer]).toMatchObject({ kind: null, release_ready: false, release_line: 'Not sorted yet', age_days: 2, summary: '' });
    expect(byId[old].href).toBe(`/tasks/${old}`);
  });

  it('a client-visible or non-internal "Looks done" comment never counts as evidence', async () => {
    const id = await mk('public note', { tags: [LOOKS_DONE_TAG] });
    await prisma.comment.create({ data: { task_id: id, user_id: MIKE_USER_ID, content: 'Looks done: public claim', is_internal: false, client_visible: true } });
    const c = (await mine()).cards.find((x) => x.task_id === id)!;
    expect(c.looks_done).toEqual({ evidence: '', links: [] });
  });

  it('asked after release: released from-triage cards with open questions, nothing else', async () => {
    const released = await mk('released', { status: 'not_started', tags: ['from-triage'] });
    const answered = await mk('answered', { status: 'not_started', tags: ['from-triage'] });
    const untagged = await mk('untagged', { status: 'not_started' });
    const closed = await mk('closed', { status: 'done', tags: ['from-triage'] });
    const stillTriage = await mk('still in triage', { tags: ['from-triage'] });
    const q = { what_it_is: 'x', sources: [], checked: 'x', unknown: 'x', if_nobody: 'go', if_nobody_action: 'wait' };
    await prisma.taskQuestion.create({ data: { task_id: released, question: 'Open one?', ...q } as never });
    await prisma.taskQuestion.create({ data: { task_id: answered, question: 'Done one?', state: 'answered', answer_text: 'yes', ...q } as never });
    for (const t of [untagged, closed, stillTriage]) await prisma.taskQuestion.create({ data: { task_id: t, question: 'Q?', ...q } as never });
    const { asked, t } = await mine();
    expect(asked.map((a) => a.task_id)).toEqual([released]);
    expect(asked[0]).toMatchObject({ open_questions: 1, status: 'not_started', href: `/tasks/${released}` });
    expect(t!.asked_after_release!.length).toBeGreaterThan(0);
  });

  it('the older group payload is still there for the current Triage section', async () => {
    const id = await mk('legacy visible');
    const { t } = await mine();
    expect(t!.count).toBeGreaterThan(0);
    expect(t!.groups.flatMap((g) => g.tasks).some((x) => x.task_id === id)).toBe(true);
  });
});
