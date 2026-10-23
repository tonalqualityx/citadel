// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
// Throwaway executed replay of the 19 real drain sends of 2026-10-21 against the REAL recheck/policy/go-live code.


type T = { id: string; is_deleted: boolean; status: string; client_approved_at: Date | null; tags: string[]; staging_preview_url: string | null; approved?: boolean; completed_at?: Date | null; title?: string; client_title?: string | null; client_id?: string | null; requested_by_contact_id?: string | null };
const recipients: { list: Array<{ id: string; email: string; name: string }> } = { list: [{ id: 'c1', email: 'mike@becomeindelible.com', name: 'Mike Dion' }] };
const db: { tasks: Map<string, T>; convos: Map<string, { id: string; state: string }>; comments: any[]; outbox: any[] } = { tasks: new Map(), convos: new Map(), comments: [], outbox: [] };

vi.mock('@/lib/db/prisma', () => {
  const prisma: any = {
    appSettings: { findUnique: async () => null }, // no row => defaults (enforce / shadow)
    task: {
      findUnique: async ({ where }: any) => { const t = db.tasks.get(where.id); return t ? { ...t, client: { name: 'Crappy Music' }, site: null } : null; },
      update: async ({ where, data }: any) => { const t = db.tasks.get(where.id)!; Object.assign(t, data); return t; },
    },
    chatConversation: { findUnique: async ({ where }: any) => db.convos.get(where.task_id) ?? null },
    comment: {
      findFirst: async ({ where }: any) => db.comments.find((c) => c.task_id === where.task_id && (where.is_internal === undefined || c.is_internal === where.is_internal) && (!where.content?.startsWith || c.content.startsWith(where.content.startsWith)) && (!where.OR || where.OR.some((o: any) => (o.content && c.content.startsWith(o.content.startsWith)) || (o.chat_meta && c.chat_meta?.email_notice === o.chat_meta.equals)))) ?? null,
      create: async ({ data }: any) => { db.comments.push(data); return data; },
    },
    emailOutbox: { create: async ({ data }: any) => { db.outbox.push(data); return { id: 'row-' + db.outbox.length }; } },
    approvalRequest: { findUnique: async () => null },
    $executeRaw: async (strings: TemplateStringsArray, ...vals: any[]) => {
      const sql = strings.join('?');
      if (sql.includes('array_append')) { const [tag, id] = vals; const t = db.tasks.get(id)!; if (t.tags.includes(tag)) return 0; t.tags = [...t.tags, tag]; return 1; }
      if (sql.includes('array_remove')) { const [tag, id] = vals; const t = db.tasks.get(id); if (!t || !t.tags.includes(tag)) return 0; t.tags = t.tags.filter((x) => x !== tag); return 1; }
      return 0;
    },
  };
  return { prisma };
});
vi.mock('@/lib/services/activity', () => ({ logStatusChange: async () => undefined, logUpdate: async () => undefined }));
vi.mock('@/lib/services/dependencies', () => ({ unblockEligibleDependents: async () => undefined }));
vi.mock('@/lib/portal/notices', () => ({ workPageUrl: (id: string) => `https://citadel.example/w/${id}`, noticeRecipients: async () => recipients.list, contactCanOpen: () => true }));

import { decideSend } from '@/lib/sends/policy';
import { claimNotice } from '@/lib/sends/recheck';
import { markLive } from '@/lib/portal/go-live';
import type { Govern } from '@/lib/sends/govern';

const U = (s: string) => s; // ids are real task ids
const GENRE = '09c0a052-8d0d-4c21-a736-c088c8aa183e', WHATWEDO = '6b1c76ed-5844-43de-9ce6-b9f0fd3e5350', PICTURE = '4aad9e83-24ea-4904-b053-61a1fbfd5487', NEWREQ = '14d1ef50-a2f3-4d6d-b399-e441736a2f59', RANK = '3808765a-1e9e-44b2-9b4d-76c627688add';
const task = (id: string, o: Partial<T>): T => ({ id, is_deleted: false, status: 'not_started', client_approved_at: null, tags: ['portal-chat'], staging_preview_url: null, ...o });

// Each row: the send time, the govern the branch's producer would have written, and the governing state AT SEND TIME
// (reconstructed from task comments, client_approved_at, chat state and the drain log).
const rows: Array<{ n: number; id: string; kind: string; at: string; govern: Govern; state?: () => void; rightToSend: boolean }> = [
  { n: 1, id: 'a8569bbc', kind: 'magic_link', at: '2026-10-21T15:52:51Z', govern: { intent: 'magic_link', snapshot: { expires_at: '2026-10-21T16:06:48Z' } }, rightToSend: true }, // queued >= deploy 11:52 EDT (writer+route same commit 5cfd52a), TTL 15m: latest-possible queue time used => earliest expiry bound is conservative below
  { n: 2, id: 'aaee8fd8', kind: 'magic_link', at: '2026-10-21T15:52:52Z', govern: { intent: 'magic_link', snapshot: { expires_at: '2026-10-21T16:06:48Z' } }, rightToSend: true },
  { n: 3, id: '2c205bf0', kind: 'other (Urgent Email notif)', at: '2026-10-21T16:02:16Z', govern: { intent: 'none', reason: 'internal notification email' }, rightToSend: true },
  { n: 4, id: '2e6c00d5', kind: 'notification (new portal request)', at: '2026-10-21T18:27:02Z', govern: { intent: 'notice_internal', task_id: NEWREQ }, state: () => db.tasks.set(NEWREQ, task(NEWREQ, {})), rightToSend: true },
  { n: 5, id: '54c6fc4f', kind: 'portal_golive (Crappy, markLive)', at: '2026-10-21T23:52:02Z', govern: { intent: 'golive', task_id: GENRE, snapshot: { claimed: true } }, state: () => db.tasks.set(GENRE, task(GENRE, { status: 'done', client_approved_at: new Date('2026-10-21T22:52:52Z'), tags: ['portal-chat', 'kind:site-change', 'go-live-notified'] })), rightToSend: false /* duplicate; handled by the claim, see pair test */ },
  { n: 6, id: '39e26bff', kind: 'other (chat handoff notif)', at: '2026-10-22T01:41:03Z', govern: { intent: 'none', reason: 'internal notification email' }, rightToSend: true },
  { n: 7, id: 'b193f7e6', kind: 'other (chat handoff notif)', at: '2026-10-22T01:42:03Z', govern: { intent: 'none', reason: 'internal notification email' }, rightToSend: true },
  { n: 8, id: 'b98b15b0', kind: 'portal_chat (staff reply)', at: '2026-10-22T01:47:02Z', govern: { intent: 'chat', task_id: WHATWEDO }, state: () => { db.tasks.set(WHATWEDO, task(WHATWEDO, { status: 'in_progress' })); db.convos.set(WHATWEDO, { id: 'cv1', state: 'with_person' }); }, rightToSend: true },
  { n: 9, id: '452bdcaa', kind: 'other (chat handoff notif)', at: '2026-10-22T01:47:03Z', govern: { intent: 'none', reason: 'internal notification email' }, rightToSend: true },
  { n: 10, id: 'bd79489c', kind: 'other (chat handoff notif)', at: '2026-10-22T01:50:02Z', govern: { intent: 'none', reason: 'internal notification email' }, rightToSend: true },
  { n: 11, id: '0d028a74', kind: 'other (approval request, markStaged)', at: '2026-10-22T01:55:02Z', govern: { intent: 'approval_request', task_id: WHATWEDO, snapshot: { preview_url: 'https://review-2026-10-21.abbott-septic-service.pages.dev' } }, state: () => db.tasks.set(WHATWEDO, task(WHATWEDO, { status: 'review', staging_preview_url: 'https://review-2026-10-21.abbott-septic-service.pages.dev', tags: ['portal-chat', 'chat-handoff'] })), rightToSend: true },
  { n: 12, id: 'a8a619ac', kind: 'other (portal emergency notif)', at: '2026-10-22T01:57:02Z', govern: { intent: 'none', reason: 'internal notification email' }, rightToSend: true },
  { n: 13, id: 'e1288524', kind: 'other (chat handoff notif)', at: '2026-10-22T02:00:02Z', govern: { intent: 'none', reason: 'internal notification email' }, rightToSend: true },
  { n: 14, id: '051a45ea', kind: 'other (chat handoff notif)', at: '2026-10-22T02:04:02Z', govern: { intent: 'none', reason: 'internal notification email' }, rightToSend: true },
  { n: 15, id: 'd8effccf', kind: 'portal_chat (carries the live line)', at: '2026-10-22T02:28:03Z', govern: { intent: 'chat', task_id: WHATWEDO }, state: () => { db.tasks.set(WHATWEDO, task(WHATWEDO, { status: 'done', client_approved_at: new Date('2026-10-22T02:00:10Z'), tags: ['portal-chat', 'chat-handoff', 'client-approved', 'go-live-notified'] })); db.convos.set(WHATWEDO, { id: 'cv1', state: 'with_person' }); }, rightToSend: true },
  { n: 16, id: '73894b74', kind: 'other (chat handoff notif)', at: '2026-10-22T02:36:03Z', govern: { intent: 'none', reason: 'internal notification email' }, rightToSend: true },
  { n: 17, id: '429d7e1e', kind: 'other (chat handoff notif)', at: '2026-10-22T02:46:02Z', govern: { intent: 'none', reason: 'internal notification email' }, rightToSend: true },
  { n: 18, id: '7b41f04f', kind: 'portal_chat (away, open ask)', at: '2026-10-22T03:03:02Z', govern: { intent: 'chat', task_id: RANK }, state: () => { db.tasks.set(RANK, task(RANK, {})); db.convos.set(RANK, { id: 'cv2', state: 'clarifying' }); }, rightToSend: true },
  { n: 19, id: '1e616c48', kind: 'portal_chat (staff reply)', at: '2026-10-22T03:45:03Z', govern: { intent: 'chat', task_id: PICTURE }, state: () => { db.tasks.set(PICTURE, task(PICTURE, { tags: ['portal-chat', 'kind:site-change', 'awaiting-clarification'] })); db.convos.set(PICTURE, { id: 'cv3', state: 'filed' }); }, rightToSend: true },
];

describe('executed replay, 19 drain sends 2026-10-21', () => {
  beforeEach(() => { db.tasks.clear(); db.convos.clear(); db.comments.length = 0; db.outbox.length = 0; vi.useRealTimers(); });
  const table: string[] = [];
  for (const r of rows) {
    it(`row ${r.n} ${r.id}`, async () => {
      vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(r.at));
      r.state?.();
      const d = await decideSend(r.govern, r.id);
      const dropped = !d.ok;
      table.push(`${r.n}\t${r.id}\t${r.kind}\t${r.govern.intent}\tdrop=${dropped}${d.reason ? '(' + d.reason + ')' : ''}${d.would_drop ? ' shadow:' + d.would_drop.reason : ''}\tright=${r.rightToSend}`);
      if (r.rightToSend) expect(dropped).toBe(false);
    });
  }
  it('magic link boundary: worst case (queued at 11:48 EDT commit time) still passes at 11:52:52', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-21T15:52:52Z'));
    expect((await decideSend({ intent: 'magic_link', snapshot: { expires_at: '2026-10-21T16:03:24Z' } })).ok).toBe(true);
  });
  it('Crappy Music pair: worker guard at 19:45 claims live, markLive(force) at 19:51 queues nothing', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-21T23:45:10Z'));
    db.tasks.set(GENRE, task(GENRE, { status: 'review', client_approved_at: new Date('2026-10-21T22:52:52Z'), tags: ['portal-chat', 'kind:site-change', 'client-approved'], title: 'Genre', requested_by_contact_id: 'c1' }));
    const g: Govern = { intent: 'golive', task_id: GENRE, snapshot: { before_live: true } }; // what send_guard builds
    const d = await decideSend(g); expect(d.ok).toBe(true);
    expect(await claimNotice(GENRE, 'live')).toBe(true);
    vi.setSystemTime(new Date('2026-10-21T23:51:15Z'));
    const res = await markLive({ taskId: GENRE, authorId: '00000000-0000-4000-8000-000000000000', liveUrl: 'https://crappymusic.io/', force: true });
    table.push(`PAIR\tworker 19:45 ok=${d.ok}; markLive 19:51 already_notified=${res.already_notified} lane=${res.lane} outbox_rows=${db.outbox.length} visible_live_lines=${db.comments.filter((c) => c.client_visible).length}`);
    expect(res.already_notified).toBe(true); expect(db.outbox.length).toBe(0);
  });
  it('control: /live with no lane gives the claim back, so the worker note through the guard still sends', async () => {
    recipients.list = [];
    db.tasks.set(GENRE, task(GENRE, { status: 'review', client_approved_at: null, tags: ['client-approved'], title: 'Email task', requested_by_contact_id: null }));
    const res = await markLive({ taskId: GENRE, authorId: '00000000-0000-4000-8000-000000000000', liveUrl: 'https://crappymusic.io/', force: true });
    expect(res.lane).toBe('none');
    expect(db.tasks.get(GENRE)!.tags).not.toContain('go-live-notified');
    const d = await decideSend({ intent: 'golive', task_id: GENRE, snapshot: { before_live: true } });
    expect(d.ok).toBe(true);
    expect(await claimNotice(GENRE, 'live')).toBe(true);
    recipients.list = [{ id: 'c1', email: 'mike@becomeindelible.com', name: 'Mike Dion' }];
    console.log('\n' + table.join('\n'));
  });
});
