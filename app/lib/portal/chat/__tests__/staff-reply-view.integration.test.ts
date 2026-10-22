import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { BAST_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { MIKE_USER_ID } from '@/lib/waits/owner';
import { cleanup, SCRATCH, seedClient, type Seeded } from '@/lib/engine/__tests__/seed';
import { loadChatView } from '../view';
import { clientIsWatching, STAFF_HOLD_MS, WATCHING_MS } from '../mailer';
import { HANDOFF_BANNER } from '../copy';

// The client's view after a handoff: the banner stays until a person on the team answers, then it names them;
// and the presence rule the staff composer hint reads (a staff reply is emailed only when the client is away).
describe.skipIf(!SCRATCH)('staff reply in the client view (real database)', () => {
  let a: Seeded;
  const access = () => ({ contactId: a.ownerId, clientId: a.clientId, role: 'owner' as const });

  beforeAll(async () => {
    a = await seedClient(`sr${Date.now()}`);
    await prisma.chatConversation.update({ where: { id: a.conversationId }, data: { state: 'with_person', mode: 'model' } });
    await prisma.comment.create({ data: { task_id: a.taskId, content: 'I would like a person.', author_contact_id: a.ownerId, client_visible: true, source: 'portal', created_at: new Date('2026-10-22T01:40:00Z') } });
    await prisma.comment.create({ data: { task_id: a.taskId, user_id: BAST_USER_ID, content: 'A person will reply.', client_visible: true, source: 'assistant', created_at: new Date('2026-10-22T01:41:00Z') } });
    await prisma.comment.create({ data: { task_id: a.taskId, user_id: BAST_USER_ID, content: 'Handoff note', is_internal: true, chat_meta: { handoff: true }, created_at: new Date('2026-10-22T01:41:30Z') } });
  });
  afterAll(async () => {
    await cleanup([a]);
    await prisma.$disconnect();
  });

  it('shows the handoff banner, then "<First name> from Indelible replied." once staff answer; the bubble is "Indelible team"', async () => {
    const before = await loadChatView(access(), a.conversationId);
    expect(before.banner).toBe(HANDOFF_BANNER);
    expect(before.staff_reply).toBeNull();

    const staff = await prisma.user.findUniqueOrThrow({ where: { id: MIKE_USER_ID }, select: { name: true } });
    const reply = await prisma.comment.create({ data: { task_id: a.taskId, user_id: MIKE_USER_ID, content: 'We fixed it.', client_visible: true, created_at: new Date('2026-10-22T01:43:00Z') } });
    const first = staff.name.trim().split(/\s+/)[0];

    // A poll that asks only for what is new still knows a person has replied.
    const after = await loadChatView(access(), a.conversationId, { after: (await prisma.comment.findFirstOrThrow({ where: { task_id: a.taskId, source: 'assistant' } })).id });
    expect(after.banner).toBe(`${first} from Indelible replied.`);
    expect(after.staff_reply?.first_name).toBe(first);
    const msg = after.messages.find((m) => m.id === reply.id)!;
    expect(msg.who).toBe('team');
    expect(msg.name).toBe('Indelible team');
    expect(JSON.stringify(after)).not.toContain(staff.name.trim().split(/\s+/).slice(1).join(' ') || '\u0000');
  });

  it('a staff reply from before the handoff does not count', async () => {
    const b = await seedClient(`sb${Date.now()}`);
    try {
      await prisma.comment.create({ data: { task_id: b.taskId, user_id: MIKE_USER_ID, content: 'Old reply', client_visible: true, created_at: new Date('2026-10-22T01:00:00Z') } });
      await prisma.comment.create({ data: { task_id: b.taskId, user_id: BAST_USER_ID, content: 'Handoff note', is_internal: true, chat_meta: { handoff: true }, created_at: new Date('2026-10-22T01:30:00Z') } });
      await prisma.chatConversation.update({ where: { id: b.conversationId }, data: { state: 'with_person' } });
      const v = await loadChatView({ contactId: b.ownerId, clientId: b.clientId, role: 'owner' }, b.conversationId);
      expect(v.banner).toBe(HANDOFF_BANNER);
    } finally {
      await cleanup([b]);
    }
  });
});

describe('the presence rule for staff replies', () => {
  const now = new Date('2026-10-22T02:00:00Z');
  it('the client is present only with a visible tab seen inside the window; the hold is two minutes', () => {
    expect(STAFF_HOLD_MS).toBe(120_000);
    expect(clientIsWatching({ last_seen_at: new Date(now.getTime() - 30_000), page_hidden_at: null }, now)).toBe(true);
    expect(clientIsWatching({ last_seen_at: new Date(now.getTime() - WATCHING_MS), page_hidden_at: null }, now)).toBe(false);
    expect(clientIsWatching({ last_seen_at: new Date(now.getTime() - 30_000), page_hidden_at: new Date(now.getTime() - 10_000) }, now)).toBe(false);
    expect(clientIsWatching({ last_seen_at: null, page_hidden_at: null }, now)).toBe(false);
  });
});
