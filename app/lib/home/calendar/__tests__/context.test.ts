import { describe, it, expect, vi } from 'vitest';
import { loadDrawerContext } from '../context';
import { matchEvent, EMPTY_TABLES } from '../match';
import { ev, guest, me, at } from './helpers';

const WRITES = ['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany'];

function fake(rows: Record<string, unknown> = {}) {
  const calls: { model: string; op: string; args: unknown }[] = [];
  const model = (name: string) =>
    new Proxy({}, {
      get: (_t, op: string) =>
        vi.fn(async (args: unknown) => {
          calls.push({ model: name, op, args });
          if (WRITES.includes(op)) throw new Error('write');
          const r = rows[`${name}.${op}`];
          return r === undefined ? (op === 'findMany' ? [] : null) : r;
        }),
    });
  const db = Object.fromEntries(['project', 'resourceLink', 'clientReport', 'emailAsk', 'accord', 'meeting', 'client', 'homeOwedThread'].map((m) => [m, model(m)]));
  return { db: db as never, calls };
}

const e = ev({ attendees: [me(), guest('m@vt.org', 'Morgan')] });
const withClient = matchEvent(e, { ...EMPTY_TABLES, contacts: [{ email: 'm@vt.org', name: 'Morgan', client_id: 'c1', client_name: 'VT' }] });
const noClient = matchEvent(e, EMPTY_TABLES);

describe('loadDrawerContext', () => {
  it('reads the client context, maps projects and never writes', async () => {
    const { db, calls } = fake({
      'project.findMany': [{ id: 'p1', name: 'P', status: 'in_progress', updated_at: at('09:00'), drive_folder_id: 'F1' }, { id: 'p2', name: 'D', status: 'done', updated_at: at('09:00'), drive_folder_id: null }],
      'resourceLink.findMany': [{ project_id: 'p1', name: 'Intelligence report', url: 'https://x.test/r', created_at: at('09:00') }],
      'clientReport.findFirst': { period: '2026-10', url: 'https://x.test/m', published_at: at('09:00') },
      'emailAsk.findFirst': { from_name: 'Morgan', from_email: 'm@vt.org', subject: 'Hi', deep_link: 'https://mail.example/1', received_at: at('08:00') },
      'meeting.findFirst': { id: 'm1', meeting_date: at('08:00') },
      'client.findFirst': { drive_folder_id: 'CF' },
    });
    const c = await loadDrawerContext(db, { userId: 'u1', now: at('11:40'), eventId: 'g1', kind: 'meeting', match: withClient });
    expect(c.projects.map((p) => [p.id, p.live])).toEqual([['p1', true], ['p2', false]]);
    expect(c.resourceLinks).toHaveLength(1);
    expect(c.latestReport?.period).toBe('2026-10');
    expect(c.lastAsk?.subject).toBe('Hi');
    expect(c.meeting?.id).toBe('m1');
    expect(c.clientDriveId).toBe('CF');
    expect(c.answerThreadKey).toBeNull();
    expect(calls.filter((x) => WRITES.includes(x.op))).toEqual([]);
    const proj = calls.find((x) => x.model === 'project')?.args as { where: { client_id: string; is_deleted: boolean } };
    expect(proj.where.client_id).toBe('c1');
    expect(proj.where.is_deleted).toBe(false);
  });

  it('with no client it reads no client tables', async () => {
    const { db, calls } = fake();
    const c = await loadDrawerContext(db, { userId: 'u1', now: at('11:40'), eventId: 'g1', kind: 'meeting', match: noClient });
    expect(c.projects).toEqual([]);
    expect(calls.map((x) => x.model)).toEqual(['emailAsk']);
  });

  it('an answer block reads its own thread key for his user only', async () => {
    const { db, calls } = fake({ 'homeOwedThread.findFirst': { thread_key: 'thread:a:t1' } });
    const c = await loadDrawerContext(db, { userId: 'u1', now: at('11:40'), eventId: 'g9', kind: 'answer', match: noClient });
    expect(c.answerThreadKey).toBe('thread:a:t1');
    expect(calls.find((x) => x.model === 'homeOwedThread')?.args).toEqual({ where: { user_id: 'u1', booked_event_id: 'g9' }, select: { thread_key: true } });
  });

  it('a lead reads its accord', async () => {
    const e2 = ev({ attendees: [me(), guest('e@boot.com', 'Erick')] });
    const m = matchEvent(e2, { ...EMPTY_TABLES, accords: [{ id: 'a1', lead_email: 'e@boot.com', lead_name: 'Erick', lead_business_name: 'Boot', updated_at: new Date() }] });
    const { db } = fake({ 'accord.findFirst': { id: 'a1', name: 'Bootleggers site' } });
    expect((await loadDrawerContext(db, { userId: 'u1', now: at('11:40'), eventId: 'g1', kind: 'meeting', match: m })).accord).toEqual({ id: 'a1', name: 'Bootleggers site' });
  });
});
