import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { BAST_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { MIKE_USER_ID } from '@/lib/waits/owner';
import { cleanup, SCRATCH, seedClient, type Seeded } from '@/lib/engine/__tests__/seed';
import { getChatSettings, recordRunnerHeartbeat, updateChatSettings } from '../switches';
import { runSweep } from '../sweep';
import { ingestEmailReply, emailRef, senderVerified } from '../inbound';
import { chatRecipientAllowed, recordChatSend } from '../outbox-guard';
import { chatReplyTo, chatRef, buildAwayBody, buildReplyBody, buildStaffBody } from '../mailer';
import { allChatStrings } from '../copy';
import { queuePortalNotices } from '@/lib/portal/notices';

// Phase C slice C4: the email leg against a real scratch Postgres (spec 7.2 to 7.4).
const MIN = 60_000;
describe.skipIf(!SCRATCH)('chat email leg (real database)', () => {
  const tag = `e${Date.now()}`;
  let a: Seeded;
  let token = '';
  let before: Awaited<ReturnType<typeof getChatSettings>>;
  const T0 = new Date('2026-10-22T15:00:00Z');
  const at = (min: number, sec = 0) => new Date(T0.getTime() + min * MIN + sec * 1000);
  let askCommentId = '';

  const scope = () => ({ conversationIds: [a.conversationId] });
  const outbox = () => prisma.emailOutbox.findMany({ where: { task_id: a.taskId }, orderBy: { created_at: 'asc' } });

  beforeAll(async () => {
    before = await getChatSettings();
    a = await seedClient(tag);
    token = (await prisma.chatConversation.findUniqueOrThrow({ where: { id: a.conversationId } })).email_token;
  });
  afterAll(async () => {
    await updateChatSettings({ mode: before.mode, pilot_contact_ids: before.pilot_contact_ids, daily_cap_usd: before.daily_cap_usd });
    await prisma.emailOutbox.deleteMany({ where: { task_id: a.taskId } });
    await prisma.wait.deleteMany({ where: { task_id: a.taskId } });
    await cleanup([a]);
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await updateChatSettings({ mode: 'on', pilot_contact_ids: [], daily_cap_usd: 30 });
    await recordRunnerHeartbeat(at(11)); // a live runner at the test's clock
    await prisma.emailOutbox.deleteMany({ where: { task_id: a.taskId } });
    await prisma.waitEvent.deleteMany({ where: { wait: { task_id: a.taskId } } });
    await prisma.wait.deleteMany({ where: { task_id: a.taskId } });
    await prisma.engineJob.deleteMany({ where: { conversation_id: a.conversationId } });
    await prisma.comment.deleteMany({ where: { task_id: a.taskId } });
    await prisma.task.update({ where: { id: a.taskId }, data: { tags: ['portal-chat', 'chat-clarifying'], status: 'not_started' } });
    // A client message, then Bast's question at T0.
    const first = await prisma.comment.create({ data: { task_id: a.taskId, content: 'Please add this picture', author_contact_id: a.ownerId, client_visible: true, source: 'portal', created_at: at(-1) } });
    const q = await prisma.comment.create({ data: { task_id: a.taskId, user_id: BAST_USER_ID, content: 'Which page should it go on?', client_visible: true, source: 'assistant', created_at: T0 } });
    askCommentId = q.id;
    await prisma.chatConversation.update({
      where: { id: a.conversationId },
      data: {
        state: 'clarifying', mode: 'model', away_sent_for_comment_id: null, last_seen_at: null, last_typing_at: null, page_hidden_at: null, last_outbound_gmail_id: null, gmail_thread_id: null,
        slots: {}, open_ask: { slot: 'change', question: 'Which page should it go on?', choice_ids: [], allow_free_text: true, allow_upload: false, comment_id: q.id },
      },
    });
    void first;
  });

  it('9:59 of silence: no email; 10:00: exactly one, from bast@, with the reply-to and the frame', async () => {
    expect((await runSweep(at(9, 59), scope())).away).toBe(0);
    expect((await outbox()).length).toBe(0);
    expect((await runSweep(at(10), scope())).away).toBe(1);
    const rows = await outbox();
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.kind).toBe('portal_chat');
    expect(r.from_account).toBe('bast@becomeindelible.com');
    expect(r.to).toBe(`olive-${tag}@example.test`);
    expect(r.allow_external).toBe(true);
    expect(r.reply_to).toBe(chatReplyTo(token));
    expect(r.reply_to_gmail_id).toBeNull();
    expect(r.subject).toBe('One question about your request: Request: ' + tag);
    expect(r.text).toContain('Hi Olive');
    expect(r.text).toContain('Which page should it go on?');
    expect(r.text).toContain(`Ref: ${chatRef(token)}`);
    expect(r.text).toContain('Indelible support');
    expect(r.text).not.toMatch(/[–—]/);
    const waits = await prisma.wait.findMany({ where: { task_id: a.taskId } });
    expect(waits.map((w) => w.template_key)).toContain('portal.awaiting_client');
  });

  it('no reminders ever: later sweeps, an hour and a day on, send nothing more', async () => {
    await runSweep(at(10), scope());
    await runSweep(at(11), scope());
    await runSweep(at(70), scope());
    await runSweep(at(60 * 24), scope());
    expect((await outbox()).filter((r) => r.dedupe_key?.startsWith('chat:'))).toHaveLength(1);
  });

  it('a scoped sweep leaves every other conversation alone; no scope sweeps it', async () => {
    const other = await seedClient(`${tag}o`);
    try {
      await prisma.comment.create({ data: { task_id: other.taskId, content: 'Hello?', author_contact_id: other.ownerId, client_visible: true, source: 'portal', created_at: at(0) } });
      await runSweep(at(30), scope());
      expect((await prisma.chatConversation.findUniqueOrThrow({ where: { id: other.conversationId } })).state).toBe('clarifying');
      await runSweep(at(30), { createdAfter: new Date(Date.now() - 60_000), conversationIds: [a.conversationId] });
      expect((await prisma.chatConversation.findUniqueOrThrow({ where: { id: other.conversationId } })).state).toBe('clarifying');
      await runSweep(at(30)); // the cron call: everything
      expect((await prisma.chatConversation.findUniqueOrThrow({ where: { id: other.conversationId } })).state).toBe('with_person');
    } finally {
      await cleanup([other]);
    }
  });

  it('an unconfirmed request is filed with what is known after 48 hours, by C2\'s step', async () => {
    expect((await runSweep(at(47 * 60), scope())).filed_unconfirmed).toBe(0);
    expect((await runSweep(at(49 * 60), scope())).filed_unconfirmed).toBe(1);
    const t = await prisma.task.findUniqueOrThrow({ where: { id: a.taskId } });
    expect(t.tags).toEqual(expect.arrayContaining(['unconfirmed-chat', 'needs-mike']));
    expect(t.tags).not.toContain('chat-clarifying');
  });

  it('typing keeps the clock: a typing signal 5 minutes ago holds the email back', async () => {
    await prisma.chatConversation.update({ where: { id: a.conversationId }, data: { last_typing_at: at(5) } });
    expect((await runSweep(at(10), scope())).away).toBe(0);
    expect((await runSweep(at(15), scope())).away).toBe(1);
  });

  it('a closed tab: 2:59 no, 3:00 yes', async () => {
    await prisma.chatConversation.update({ where: { id: a.conversationId }, data: { page_hidden_at: at(1) } });
    expect((await runSweep(at(3, 59), scope())).away).toBe(0);
    expect((await runSweep(at(4), scope())).away).toBe(1);
  });

  it('the client answered first: nothing is sent', async () => {
    await prisma.comment.create({ data: { task_id: a.taskId, content: 'The about page', author_contact_id: a.ownerId, client_visible: true, source: 'portal', created_at: at(5) } });
    expect((await runSweep(at(30), scope())).away).toBe(0);
  });

  it('a with_person conversation and a switched-off chat get no away email', async () => {
    await updateChatSettings({ mode: 'off' });
    expect((await runSweep(at(30), scope())).away).toBe(0);
    await updateChatSettings({ mode: 'on' });
    await prisma.chatConversation.update({ where: { id: a.conversationId }, data: { state: 'with_person' } });
    expect((await runSweep(at(30), scope())).away).toBe(0);
  });

  it('a summary waiting for a yes goes as the summary with the send line', async () => {
    await prisma.chatConversation.update({ where: { id: a.conversationId }, data: { state: 'confirming', open_ask: { set: null } as never, summary_text: 'Add the photo to the About page, team section.' } }).catch(async () => {
      await prisma.chatConversation.update({ where: { id: a.conversationId }, data: { state: 'confirming', summary_text: 'Add the photo to the About page, team section.' } });
    });
    await runSweep(at(10), scope());
    const [r] = await outbox();
    expect(r.text).toContain('Add the photo to the About page, team section.');
    expect(r.text).toContain("Reply 'send'");
  });

  it('a staff reply while the client is away goes by the chat lane after the 120 second hold, and never as a PortalNotice', async () => {
    const staff = await prisma.comment.create({ data: { task_id: a.taskId, user_id: MIKE_USER_ID, content: 'We added the photo to the About page.', client_visible: true, created_at: at(20) } });
    const task = { id: a.taskId, client_title: 'Request', client_id: a.clientId, requested_by_contact_id: a.ownerId };
    expect(await queuePortalNotices(task, { id: staff.id })).toEqual({ queued: 0, absorbed: 0 });
    expect(await prisma.portalNotice.count({ where: { task_id: a.taskId } })).toBe(0);
    expect((await runSweep(at(21, 59), scope())).staff).toBe(0);
    expect((await runSweep(at(22), scope())).staff).toBe(1);
    expect((await runSweep(at(23), scope())).staff).toBe(0);
    const rows = (await outbox()).filter((r) => r.dedupe_key?.startsWith('chatstaff:'));
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toContain('We added the photo to the About page.');
    expect(rows[0].reply_to).toBe(chatReplyTo(token));
  });

  it('a staff reply while the client is watching sends nothing', async () => {
    await prisma.comment.create({ data: { task_id: a.taskId, user_id: MIKE_USER_ID, content: 'Done.', client_visible: true, created_at: at(20) } });
    await prisma.chatConversation.update({ where: { id: a.conversationId }, data: { last_seen_at: at(21) } });
    expect((await runSweep(at(22, 30), scope())).staff).toBe(0);
    expect((await outbox()).filter((r) => r.dedupe_key?.startsWith('chatstaff:'))).toHaveLength(0);
  });

  it('a staff reply made internal during the hold never goes', async () => {
    const c = await prisma.comment.create({ data: { task_id: a.taskId, user_id: MIKE_USER_ID, content: 'Oops.', client_visible: true, created_at: at(20) } });
    await prisma.comment.update({ where: { id: c.id }, data: { is_internal: true } });
    expect((await runSweep(at(23), scope())).staff).toBe(0);
  });

  it('a stall: a client message with no reply after 3 minutes goes to a person with the fixed line', async () => {
    await prisma.comment.create({ data: { task_id: a.taskId, content: 'Hello?', author_contact_id: a.ownerId, client_visible: true, source: 'portal', created_at: at(30) } });
    expect((await runSweep(at(32, 59), scope())).stalled).toBe(0);
    expect((await runSweep(at(33), scope())).stalled).toBe(1);
    const c = await prisma.chatConversation.findUniqueOrThrow({ where: { id: a.conversationId } });
    expect(c.state).toBe('with_person');
  });

  it('a question chat closes as done 24 hours after the answer', async () => {
    await prisma.task.update({ where: { id: a.taskId }, data: { tags: ['portal-chat', 'chat-question'] } });
    await prisma.chatConversation.update({ where: { id: a.conversationId }, data: { open_ask: { set: null } as never, slots: { question_closed_at: at(0).toISOString() } } }).catch(async () => {
      await prisma.chatConversation.update({ where: { id: a.conversationId }, data: { slots: { question_closed_at: at(0).toISOString() } } });
    });
    expect((await runSweep(at(23 * 60), scope())).closed).toBe(0);
    expect((await runSweep(at(24 * 60 + 1), scope())).closed).toBe(1);
    const t = await prisma.task.findUniqueOrThrow({ where: { id: a.taskId } });
    expect(t.status).toBe('done');
  });

  describe('inbound replies', () => {
    const base = () => ({ token, from_email: `olive-${tag}@example.test`, text: 'The about page, please.', raw: 'raw body', gmail_id: 'g1', rfc_message_id: `<m-${tag}-1@mail.test>`, gmail_thread_id: 't1', auth_pass: true, attachment_ids: [] as string[] });

    it('stores the client message, closes the awaiting clock, queues one chat_email_reply job, and is idempotent', async () => {
      await runSweep(at(10), scope());
      const out = await ingestEmailReply(base(), { now: at(12) });
      expect(out.status).toBe('ingested');
      const again = await ingestEmailReply(base(), { now: at(12) });
      expect(again.status).toBe('repeat');
      const msgs = await prisma.comment.findMany({ where: { task_id: a.taskId, source: 'email' } });
      expect(msgs).toHaveLength(1);
      expect(msgs[0].author_contact_id).toBe(a.ownerId);
      expect(msgs[0].content).toBe('The about page, please.');
      expect(msgs[0].client_ref).toBe(emailRef(base().rfc_message_id));
      expect(msgs[0].client_ref!.length).toBeLessThanOrEqual(64);
      const jobs = await prisma.engineJob.findMany({ where: { conversation_id: a.conversationId } });
      expect(jobs.map((j) => j.type)).toEqual(['chat_email_reply']);
      const waits = await prisma.wait.findMany({ where: { task_id: a.taskId, template_key: 'portal.awaiting_client' } });
      expect(waits.every((w) => !['waiting', 'needs_human'].includes(w.state))).toBe(true);
      const c = await prisma.chatConversation.findUniqueOrThrow({ where: { id: a.conversationId } });
      expect(c.gmail_thread_id).toBe('t1');
    });

    it('an unknown sender is quarantined: internal note, needs-mike, no client message, no job', async () => {
      const out = await ingestEmailReply({ ...base(), from_email: 'stranger@evil.test', rfc_message_id: `<m-${tag}-2@x>` }, { now: at(12) });
      expect(out.status).toBe('quarantined');
      expect(await prisma.comment.count({ where: { task_id: a.taskId, source: 'email', is_internal: false } })).toBe(0);
      const note = await prisma.comment.findFirstOrThrow({ where: { task_id: a.taskId, source: 'email', is_internal: true } });
      expect(note.content).toContain('stranger@evil.test');
      expect(note.content).toContain('not shown to the client');
      expect((await prisma.task.findUniqueOrThrow({ where: { id: a.taskId } })).tags).toContain('needs-mike');
      expect(await prisma.engineJob.count({ where: { conversation_id: a.conversationId } })).toBe(0);
    });

    it('a failed DKIM and DMARC check is quarantined even from a known address', async () => {
      const out = await ingestEmailReply({ ...base(), auth_pass: false, rfc_message_id: `<m-${tag}-3@x>` }, { now: at(12) });
      expect(out).toMatchObject({ status: 'quarantined', reason: 'auth' });
      expect(await prisma.engineJob.count({ where: { conversation_id: a.conversationId } })).toBe(0);
    });

    it('the sender match is case-insensitive and a viewer who never wrote is not a person on the chat', async () => {
      expect((await ingestEmailReply({ ...base(), from_email: `OLIVE-${tag}@Example.Test`, rfc_message_id: `<m-${tag}-4@x>` }, { now: at(12) })).status).toBe('ingested');
      const out = await ingestEmailReply({ ...base(), from_email: `vera-${tag}@example.test`, rfc_message_id: `<m-${tag}-5@x>` }, { now: at(12) });
      expect(out.status).toBe('quarantined');
    });

    it('same-domain mail verified by Google delivery is accepted; the same claim from an outside address is quarantined', async () => {
      const pilot = await prisma.clientContact.create({ data: { client_id: a.clientId, name: 'Pilot Person', email: `pilot-${tag}@becomeindelible.com`, portal_role: 'owner', can_initiate_work: true } });
      await prisma.task.update({ where: { id: a.taskId }, data: { requested_by_contact_id: pilot.id } });
      const internal = { ...base(), from_email: pilot.email!, auth_pass: true, auth_basis: 'google_internal' as const, rfc_message_id: `<m-${tag}-7@x>` };
      expect((await ingestEmailReply(internal, { now: at(12) })).status).toBe('ingested');
      // external address claiming the internal path
      const spoof = { ...base(), from_email: `olive-${tag}@example.test`, auth_pass: true, auth_basis: 'google_internal' as const, rfc_message_id: `<m-${tag}-8@x>` };
      expect(await ingestEmailReply(spoof, { now: at(12) })).toMatchObject({ status: 'quarantined', reason: 'auth' });
      // external without any verification
      expect(await ingestEmailReply({ ...base(), auth_pass: false, rfc_message_id: `<m-${tag}-9@x>` }, { now: at(12) })).toMatchObject({ status: 'quarantined', reason: 'auth' });
      await prisma.task.update({ where: { id: a.taskId }, data: { requested_by_contact_id: a.ownerId } });
      await prisma.comment.deleteMany({ where: { task_id: a.taskId } });
      await prisma.clientContact.delete({ where: { id: pilot.id } });
    });

    it('senderVerified: the internal basis needs our domain', () => {
      expect(senderVerified({ auth_pass: true, auth_basis: 'google_internal', from_email: 'Mike@BecomeIndelible.com' })).toBe(true);
      expect(senderVerified({ auth_pass: true, auth_basis: 'google_internal', from_email: 'mike@becomeindelible.com.evil.test' })).toBe(false);
      expect(senderVerified({ auth_pass: true, auth_basis: 'authentication_results', from_email: 'pat@client.com' })).toBe(true);
      expect(senderVerified({ auth_pass: false, from_email: 'mike@becomeindelible.com' })).toBe(false);
    });

    it('an unknown token and no task id finds no conversation', async () => {
      expect((await ingestEmailReply({ ...base(), token: 'zzzzzzzzzzzz' })).status).toBe('no_conversation');
    });

    it('with the chat switched off a person reads it, and the client is told by email', async () => {
      await updateChatSettings({ mode: 'off' });
      const out = await ingestEmailReply({ ...base(), rfc_message_id: `<m-${tag}-6@x>` }, { now: at(12) });
      expect(out).toMatchObject({ status: 'ingested', route: 'person' });
      expect(await prisma.engineJob.count({ where: { conversation_id: a.conversationId } })).toBe(0);
      const c = await prisma.chatConversation.findUniqueOrThrow({ where: { id: a.conversationId } });
      expect(c.state).toBe('with_person');
      expect((await outbox()).some((r) => r.text.includes('A person on the team will read this'))).toBe(true);
    });
  });

  describe('outbox guard and threading', () => {
    it('only a person on the chat can be emailed, and one address at a time', async () => {
      await prisma.comment.create({ data: { task_id: a.taskId, content: 'hi', author_contact_id: a.ownerId, client_visible: true, source: 'portal' } });
      expect(await chatRecipientAllowed({ to: `olive-${tag}@example.test`, task_id: a.taskId })).toBe(true);
      expect(await chatRecipientAllowed({ to: `stranger@evil.test`, task_id: a.taskId })).toBe(false);
      expect(await chatRecipientAllowed({ to: `olive-${tag}@example.test`, cc: 'x@y.test', task_id: a.taskId })).toBe(false);
      expect(await chatRecipientAllowed({ to: `olive-${tag}@example.test`, task_id: null })).toBe(false);
    });

    it('after a send, the next email replies to the newest message and keeps the thread subject', async () => {
      await runSweep(at(10), scope());
      const [first] = await outbox();
      await recordChatSend(a.taskId, 'gmail-msg-1', 'gmail-thread-1');
      await prisma.comment.create({ data: { task_id: a.taskId, user_id: MIKE_USER_ID, content: 'Fixed.', client_visible: true, created_at: at(20) } });
      await runSweep(at(23), scope());
      const rows = await outbox();
      const staff = rows.find((r) => r.dedupe_key?.startsWith('chatstaff:'))!;
      expect(staff.reply_to_gmail_id).toBe('gmail-msg-1');
      expect(staff.subject).toBe(`Re: ${first.subject}`);
    });
  });

  describe('frames', () => {
    const f = { firstName: 'Olive', clientTitle: 'Update hours', domain: 'example.com', workUrl: 'https://citadel.example/portal/work/1', token: 'abcdefghijkl' };
    it('are standalone, dash-free, and carry the reference', () => {
      const away = buildAwayBody({ ...f, question: 'Which page?', choices: [{ label: 'Home' }, { label: 'About' }] });
      const reply = buildReplyBody({ ...f, reply: 'Thanks. I have the page.', sources: [{ label: 'Google Analytics, Oct 1 to Oct 20, 2026' }] });
      const staff = buildStaffBody({ ...f, replies: ['One.', 'Two.'] });
      for (const t of [away, reply, staff]) {
        expect(t).not.toMatch(/[–—]| - /);
        expect(t.split('\n')[0]).toBe('Hi Olive,');
        expect(t).toContain('Ref: IC-ABCDEF');
      }
      expect(away).toContain('1. Home\n2. About');
      expect(away).toContain('"Update hours" (example.com)');
      expect(reply).toContain('Source: Google Analytics, Oct 1 to Oct 20, 2026');
    });
    it('the fixed chat strings stay clean of dashes (copy scan)', () => {
      for (const s of allChatStrings()) expect(s).not.toMatch(/[–—]/);
    });
  });
});
