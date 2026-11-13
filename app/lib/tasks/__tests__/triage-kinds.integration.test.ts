// @vitest-environment node
/**
 * Release by kind against a real scratch Postgres: what each kind does, that the card's release_line promises exactly that, the
 * refusals (no kind, no project, quote project), question_only, the older group acts still working, and 72 hour Undo restoring
 * kind, tags, assignee, project status and questions exactly.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { SCRATCH } from '@/lib/engine/__tests__/seed';
import { BAST_USER_ID, MIKE_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { homeActSchema, runHomeAct, runHomeUndo } from '@/lib/home/act';
import { loadCards } from '@/lib/tasks/triage-card';

const NOW = new Date();
const OPTS = { now: NOW, timezone: 'America/New_York', date: NOW.toISOString().slice(0, 10) };

describe.skipIf(!SCRATCH)('release by kind (real database)', () => {
  const tag = `knd${Date.now()}`;
  const ids: string[] = [];
  const projectIds: string[] = [];
  let clientId: string;
  let techId: string;
  let adminId: string;

  const row = (id: string) => prisma.task.findUniqueOrThrow({ where: { id } });
  const mkProject = async (status: 'quote' | 'queue' | 'ready' | 'cancelled') => {
    const p = await prisma.project.create({ data: { name: `${tag} project ${status}`, client_id: clientId, status } });
    projectIds.push(p.id);
    return p.id;
  };
  const mk = async (title: string, data: Record<string, unknown> = {}) => {
    const t = await prisma.task.create({ data: { title: `${tag} ${title}`, status: 'triage', tags: ['keep-me'], ...data } as never });
    ids.push(t.id);
    return t.id;
  };
  const release = async (id: string) => runHomeAct(prisma, MIKE_USER_ID, { action: 'triage_release_card', task_ids: [id], release_version: (await loadCards(prisma, [id]))[0].release_version }, OPTS);
  const undo = (actionId: string) => runHomeUndo(prisma, MIKE_USER_ID, actionId, new Date(NOW.getTime() + 3600_000));
  const question = (task_id: string, over: Record<string, unknown> = {}) =>
    prisma.taskQuestion.create({
      data: { task_id, question: 'Which one?', what_it_is: 'x', sources: [], checked: 'x', unknown: 'x', if_nobody: 'go', if_nobody_action: 'go_with_recommendation', ...over } as never,
    });
  const card = async (id: string) => (await loadCards(prisma, [id]))[0];

  beforeAll(async () => {
    await prisma.user.upsert({ where: { id: MIKE_USER_ID }, update: {}, create: { id: MIKE_USER_ID, email: `mike-${tag}@example.test`, password_hash: 'x', name: 'Mike', role: 'admin' } });
    await prisma.user.upsert({ where: { id: BAST_USER_ID }, update: {}, create: { id: BAST_USER_ID, email: `bast-${tag}@example.test`, password_hash: 'x', name: 'Bast', role: 'pm' } });
    await prisma.userPreference.upsert({ where: { user_id: MIKE_USER_ID }, update: { home_view: 'home' }, create: { user_id: MIKE_USER_ID, home_view: 'home' } });
    clientId = (await prisma.client.create({ data: { name: `${tag} Co` } })).id;
    techId = (await prisma.user.create({ data: { email: `tech-${tag}@example.test`, password_hash: 'x', name: 'Tess', role: 'tech' } })).id;
    adminId = (await prisma.user.create({ data: { email: `adm-${tag}@example.test`, password_hash: 'x', name: 'Adm', role: 'admin' } })).id;
  });
  afterAll(async () => {
    await prisma.homeAction.deleteMany({ where: { user_id: MIKE_USER_ID, action: { startsWith: 'triage_' } } });
    await prisma.taskQuestion.deleteMany({ where: { task_id: { in: ids } } });
    await prisma.comment.deleteMany({ where: { task_id: { in: ids } } });
    await prisma.activityLog.deleteMany({ where: { entity_id: { in: ids } } });
    for (const id of ids) await prisma.task.update({ where: { id }, data: { blocked_by: { set: [] } } }).catch(() => {});
    await prisma.task.deleteMany({ where: { id: { in: ids } } });
    await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
    await prisma.client.deleteMany({ where: { id: clientId } });
    await prisma.user.deleteMany({ where: { id: { in: [techId, adminId] } } });
    await prisma.$disconnect();
  });

  it('project_setup: the project goes ready, the card goes to Bast tagged kickoff and from-triage; Undo restores everything', async () => {
    const project = await mkProject('queue');
    const id = await mk('setup', { triage_kind: 'project_setup', project_id: project, assignee_id: techId, client_id: clientId });
    const q = await question(id);
    const before = await row(id);
    const line = (await card(id)).release_line;
    expect(line).toContain('Starts the project: hands');
    const res = await release(id);
    const after = await row(id);
    expect(after.status).toBe('not_started');
    expect(after.assignee_id).toBe(BAST_USER_ID);
    expect(after.tags).toEqual(expect.arrayContaining(['keep-me', 'kickoff', 'from-triage']));
    expect(after.triage_kind).toBe('project_setup');
    expect((await prisma.project.findUniqueOrThrow({ where: { id: project } })).status).toBe('ready');
    // the question went with the recommendation (default), and Undo opens it again
    expect((await prisma.taskQuestion.findUniqueOrThrow({ where: { id: q.id } })).state).toBe('defaulted');
    await undo(res.action_id);
    const back = await row(id);
    expect(back.status).toBe('triage');
    expect(back.assignee_id).toBe(techId);
    expect([...back.tags].sort()).toEqual([...before.tags].sort());
    expect(back.triage_kind).toBe('project_setup');
    expect((await prisma.project.findUniqueOrThrow({ where: { id: project } })).status).toBe('queue');
    expect((await prisma.taskQuestion.findUniqueOrThrow({ where: { id: q.id } })).state).toBe('open');
  });

  it('project_setup on a quote project is refused with the existing sentence and nothing changes', async () => {
    const project = await mkProject('quote');
    const id = await mk('setup quote', { triage_kind: 'project_setup', project_id: project });
    const c = await card(id);
    expect(c.release_ready).toBe(false);
    expect(c.release_line).toContain('still a quote');
    await expect(release(id)).rejects.toMatchObject({ statusCode: 409, code: 'still_a_quote', message: 'That project is still a quote. Nothing was released.' });
    expect((await row(id)).status).toBe('triage');
    expect((await prisma.project.findUniqueOrThrow({ where: { id: project } })).status).toBe('quote');
  });

  it('project_setup with no project, and a closed project, are refused with a clear 409', async () => {
    const none = await mk('setup none', { triage_kind: 'project_setup' });
    await expect(release(none)).rejects.toMatchObject({ statusCode: 409, code: 'no_project' });
    const closed = await mk('setup closed', { triage_kind: 'project_setup', project_id: await mkProject('cancelled') });
    await expect(release(closed)).rejects.toMatchObject({ statusCode: 409, code: 'project_closed' });
    expect((await row(none)).status).toBe('triage');
    expect((await row(closed)).status).toBe('triage');
  });

  it('a card with no kind: release_ready is false ("Not sorted yet") and Release is refused with a 409', async () => {
    const id = await mk('unsorted');
    const c = await card(id);
    expect(c).toMatchObject({ kind: null, release_ready: false, release_line: 'Not sorted yet', release_block: 'unsorted' });
    await expect(release(id)).rejects.toMatchObject({ statusCode: 409, code: 'not_sorted' });
    expect((await row(id)).status).toBe('triage');
  });

  it.each(['task', 'project_addition', 'reusable_tool', 'rule_proposal'] as const)('%s: not_started, Bast when nobody is assigned, tag from-triage; Undo puts the assignee and tags back', async (kind) => {
    const id = await mk(kind, { triage_kind: kind });
    expect((await card(id)).release_line).toMatch(/^Hands this to Bast\./);
    const before = await row(id);
    const res = await release(id);
    const after = await row(id);
    expect(after.status).toBe('not_started');
    expect(after.assignee_id).toBe(BAST_USER_ID);
    expect(after.tags).toEqual(['keep-me', 'from-triage', 'needs-pm-release']);
    await undo(res.action_id);
    const back = await row(id);
    expect(back.status).toBe('triage');
    expect(back.assignee_id).toBeNull();
    expect(back.tags).toEqual(before.tags);
    expect(back.triage_kind).toBe(kind);
  });

  it('a task that already has an assignee keeps them, and the line names them', async () => {
    const id = await mk('owned', { triage_kind: 'task', assignee_id: techId });
    expect((await card(id)).release_line).toBe('Hands this to Tess.');
    const res = await release(id);
    expect((await row(id)).assignee_id).toBe(techId);
    await undo(res.action_id);
    expect((await row(id)).assignee_id).toBe(techId);
  });

  it('project_addition on a queue project stays on that project and leaves it in the queue', async () => {
    const project = await mkProject('queue');
    const id = await mk('addition', { triage_kind: 'project_addition', project_id: project });
    await release(id);
    expect((await row(id)).project_id).toBe(project);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: project } })).status).toBe('queue');
  });

  it('a task on a quote project is refused (the old rule holds for every kind)', async () => {
    const id = await mk('quote task', { triage_kind: 'task', project_id: await mkProject('quote') });
    await expect(release(id)).rejects.toMatchObject({ statusCode: 409, code: 'still_a_quote' });
  });

  it('question_only: closed as done, the questions and answers stay, Undo returns it to Triage', async () => {
    const id = await mk('just a question', { triage_kind: 'question_only', assignee_id: techId });
    const answered = await question(id, { state: 'answered', answer_text: 'Yes, go.', answered_at: new Date(), answered_by_id: MIKE_USER_ID });
    const res = await release(id);
    const after = await row(id);
    expect(after.status).toBe('done');
    expect(after.assignee_id).toBe(techId);
    expect(after.tags).toEqual(['keep-me']);
    const kept = await prisma.taskQuestion.findUniqueOrThrow({ where: { id: answered.id } });
    expect(kept).toMatchObject({ state: 'answered', answer_text: 'Yes, go.' });
    await undo(res.action_id);
    const back = await row(id);
    expect(back.status).toBe('triage');
    expect(back.triage_kind).toBe('question_only');
    expect((await prisma.taskQuestion.findUniqueOrThrow({ where: { id: answered.id } })).answer_text).toBe('Yes, go.');
  });

  it('Undo leaves a card alone that changed after the release (compare-and-set)', async () => {
    const id = await mk('changed', { triage_kind: 'task' });
    const res = await release(id);
    await prisma.task.update({ where: { id }, data: { priority: 1 } });
    await undo(res.action_id);
    expect((await row(id)).status).toBe('not_started');
  });

  it('only Mike: another user gets a 404 and nothing moves', async () => {
    const id = await mk('not yours', { triage_kind: 'task' });
    await expect(runHomeAct(prisma, adminId, { action: 'triage_release_card', task_ids: [id], release_version: 'v'.repeat(32) }, OPTS)).rejects.toMatchObject({ statusCode: 404 });
    expect((await row(id)).status).toBe('triage');
  });

  it('the older group acts still work: an unsorted card moves to not_started with nothing else; a typed card follows its kind', async () => {
    const plain = await mk('legacy');
    await runHomeAct(prisma, MIKE_USER_ID, { action: 'triage_release', task_ids: [plain] }, OPTS);
    const p = await row(plain);
    expect(p).toMatchObject({ status: 'not_started', assignee_id: null });
    expect(p.tags).toEqual(['keep-me']);
    const typed = await mk('legacy typed', { triage_kind: 'task' });
    await runHomeAct(prisma, MIKE_USER_ID, { action: 'triage_release', task_ids: [typed] }, OPTS);
    expect((await row(typed)).tags).toContain('from-triage');
    const project = await mkProject('queue');
    const inPlan = await mk('plan member', { project_id: project });
    await runHomeAct(prisma, MIKE_USER_ID, { action: 'triage_release_plan', group_key: `project:${project}` }, OPTS);
    expect((await row(inPlan)).status).toBe('not_started');
    expect((await prisma.project.findUniqueOrThrow({ where: { id: project } })).status).toBe('ready');
  });

  it('triage_release_card takes exactly one card', async () => {
    const a = await mk('a', { triage_kind: 'task' });
    const b = await mk('b', { triage_kind: 'task' });
    expect(homeActSchema.safeParse({ action: 'triage_release_card', task_ids: [a, b], release_version: 'v'.repeat(32) }).success).toBe(false);
    expect(homeActSchema.safeParse({ action: 'triage_release_card', task_ids: [], release_version: 'v'.repeat(32) }).success).toBe(false);
    expect(homeActSchema.safeParse({ action: 'triage_release_card', task_ids: [a], release_version: 'v'.repeat(32) }).success).toBe(true);
    expect(homeActSchema.safeParse({ action: 'triage_release_card', task_ids: [a] }).success).toBe(false);
  });
});
