/** The project Communication tab's endpoint against a real scratch database: what it includes, what it leaves out, and its order. */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';

vi.mock('@/lib/auth/middleware', async (orig) => ({ ...(await orig<typeof import('@/lib/auth/middleware')>()), requireAuth: vi.fn() }));

import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { SCRATCH } from '@/lib/engine/__tests__/seed';
import { GET } from '@/app/api/projects/[id]/communication/route';
import { MIKE_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { idParams, makeFixture, mikeSession, type Fx } from '@/lib/dox/__tests__/fixture';

describe.skipIf(!SCRATCH)('GET /api/projects/:id/communication (real database)', () => {
  let fx: Fx;
  let project = '', card = '', triageCard = '', otherCard = '', contactId = '';
  const meetingIds: string[] = [];
  const emailIds: string[] = [];

  const ask = async (over: Record<string, unknown>) => {
    const row = await prisma.emailAsk.create({
      data: {
        message_id: `${fx.tag}-${emailIds.length}`,
        account: 'mike@becomeindelible.com',
        from_email: 'lisa@example.test',
        from_name: 'Lisa',
        subject: `${fx.tag} subject ${emailIds.length}`,
        deep_link: `https://mail.google.com/mail/u/0/#inbox/thread${emailIds.length}`,
        received_at: new Date('2026-11-01T10:00:00Z'),
        ...over,
      } as never,
    });
    emailIds.push(row.id);
    return row.id;
  };
  const question = (taskId: string, text: string, over: Record<string, unknown> = {}) =>
    prisma.taskQuestion.create({
      data: {
        task_id: taskId, question: text, what_it_is: 'x', sources: [], checked: 'x', unknown: 'x', if_nobody: 'x', if_nobody_action: 'wait',
        asked_by_user_id: MIKE_USER_ID, ...over,
      } as never,
    });
  const meeting = async (title: string, date: string, over: Record<string, unknown> = {}) => {
    const m = await prisma.meeting.create({ data: { title: `${fx.tag} ${title}`, meeting_date: new Date(date), created_by_id: MIKE_USER_ID, ...over } as never });
    meetingIds.push(m.id);
    return m.id;
  };

  beforeAll(async () => {
    fx = await makeFixture('comm');
    project = await fx.mkProject('Comm', { status: 'in_progress' });
    const other = await fx.mkProject('Other', { status: 'in_progress' });
    contactId = (await prisma.clientContact.create({ data: { client_id: fx.clientId, name: 'Lisa', email: `lisa-${fx.tag}@example.test` } })).id;

    const linkedMeeting = await meeting('Kickoff', '2026-11-03T15:00:00Z', { meeting_projects: { create: [{ project_id: project }] } });
    const cardMeeting = await meeting('Card source call', '2026-11-02T15:00:00Z');
    await meeting('Deleted call', '2026-11-04T15:00:00Z', { is_deleted: true, meeting_projects: { create: [{ project_id: project }] } });
    await meeting('Other project call', '2026-11-04T15:00:00Z', { meeting_projects: { create: [{ project_id: other }] } });
    expect(linkedMeeting).toBeTruthy();

    card = await fx.mkTask('Hero card', { project_id: project, status: 'not_started', meeting_id: cardMeeting });
    triageCard = await fx.mkTask('Triage card', { project_id: project, status: 'triage' });
    otherCard = await fx.mkTask('Other card', { project_id: other, status: 'not_started' });

    await ask({ project_id: project, received_at: new Date('2026-11-05T10:00:00Z') });
    await ask({ task_id: card, rfc_message_id: `${fx.tag}@mail`, received_at: new Date('2026-11-06T10:00:00Z') });
    await ask({ task_id: card, rfc_message_id: `${fx.tag}@mail`, account: 'bast@becomeindelible.com', received_at: new Date('2026-11-06T10:00:02Z') });
    await ask({ task_id: otherCard, received_at: new Date('2026-11-07T10:00:00Z') });
    const deadCard = await fx.mkTask('Deleted card', { project_id: project, status: 'not_started', is_deleted: true });
    await ask({ project_id: project, task_id: deadCard, received_at: new Date('2026-11-01T09:00:00Z') });

    await question(card, `${fx.tag} which crop`, { asked_of_contact_id: contactId, sent_at: new Date('2026-11-08T10:00:00Z') });
    await question(card, `${fx.tag} withdrawn one`, { state: 'withdrawn' });
    await question(triageCard, `${fx.tag} triage one`);
  });

  afterAll(async () => {
    if (!fx) return;
    await prisma.emailAsk.deleteMany({ where: { id: { in: emailIds } } });
    await prisma.taskQuestion.deleteMany({ where: { task_id: { in: fx.taskIds } } });
    await prisma.clientContact.deleteMany({ where: { id: contactId } });
    await fx.cleanup();
    await prisma.meeting.deleteMany({ where: { id: { in: meetingIds } } });
  });

  it('lists the project emails once each, its card questions and its meetings, newest first', async () => {
    (requireAuth as Mock).mockResolvedValue(mikeSession());
    const res = await GET(new NextRequest('http://localhost/api/x'), idParams(project));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { kind: string; title: string; href: string; card: { id: string } | null; detail: string | null }[]; counts: Record<string, number> };

    expect(body.counts).toEqual({ email: 3, question: 1, meeting: 2 });
    expect(body.items.map((i) => i.kind)).toEqual(['question', 'email', 'email', 'meeting', 'meeting', 'email']);
    const [q, cardEmail, projectEmail, kickoff, cardCall, deadCardEmail] = body.items;
    expect(deadCardEmail.card).toBeNull();
    expect(q.title).toBe(`${fx.tag} which crop`);
    expect(q.detail).toBe('Asked of Lisa, open');
    expect(q.href).toBe(`/tasks/${card}`);
    expect(cardEmail.card?.id).toBe(card);
    expect(cardEmail.href).toBe('https://mail.google.com/mail/u/?authuser=mike%40becomeindelible.com#all/thread1');
    expect(projectEmail.card).toBeNull();
    expect(kickoff.title).toBe(`${fx.tag} Kickoff`);
    expect(cardCall.title).toBe(`${fx.tag} Card source call`);
    expect(cardCall.href).toMatch(/^\/meetings\//);
  });

  it('refuses a tech-role caller', async () => {
    const tech = await fx.mkStaff('Tess', 'tech');
    (requireAuth as Mock).mockResolvedValue({ userId: tech, role: 'tech', email: 'tess@test', via: 'session' });
    const res = await GET(new NextRequest('http://localhost/api/x'), idParams(project));
    expect(res.status).toBe(403);
  });
});
