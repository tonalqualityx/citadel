/**
 * An in-memory stand-in for the slice's Prisma client. It answers only the calls the owed store makes. Any other
 * model (a Task, an EmailOutbox row, a Wait) and any write to an EmailAsk throws, so a test that passes proves the
 * store never touched them. `writes` lists every write method called, in order.
 */

import type { PrismaClient } from '@prisma/client';

export interface FakeAsk {
  id: string;
  account: string;
  thread_id: string | null;
  message_id: string;
  state: string;
  is_urgent: boolean;
  received_at: Date;
  from_name: string | null;
  from_email: string;
}

export interface FakeOptions {
  owner?: { is_active: boolean; role: string; home_view: string | null; timezone?: string };
  asks?: FakeAsk[];
}

type Row = Record<string, unknown>;

export function makeFakeDb(opts: FakeOptions = {}) {
  const owner = opts.owner ?? { is_active: true, role: 'admin', home_view: 'home' };
  const asks = opts.asks ?? [];
  const rows = new Map<string, Row>();
  const runs = new Map<string, Row>();
  const actions: Row[] = [];
  const writes: string[] = [];
  const reads: string[] = [];
  let seq = 0;
  const w = (name: string) => writes.push(name);
  const rd = (name: string) => reads.push(name);

  const rowKey = (where: { user_id_thread_key: { user_id: string; thread_key: string } }) => `${where.user_id_thread_key.user_id}|${where.user_id_thread_key.thread_key}`;

  const models = {
    user: {
      findUnique: async () => {
        rd('user.findUnique');
        return { is_active: owner.is_active, role: owner.role, preferences: owner.home_view === undefined ? null : { home_view: owner.home_view, timezone: owner.timezone ?? 'America/New_York' } };
      },
    },
    emailAsk: {
      findFirst: async (args: { where: { account: string; OR: { thread_id?: string | null; message_id?: string }[] } }) => {
        rd('emailAsk.findFirst');
        const { account, OR } = args.where;
        const hit = asks
          .filter((a) => a.account === account && a.state === 'open' && !a.is_urgent)
          .filter((a) => OR.some((o) => (o.message_id !== undefined ? a.thread_id === null && a.message_id === o.message_id : a.thread_id === o.thread_id)))
          .sort((a, b) => b.received_at.getTime() - a.received_at.getTime())[0];
        return hit ? { id: hit.id, from_name: hit.from_name, from_email: hit.from_email } : null;
      },
    },
    // Slice 4c: his item states (read for the wake rule); the fake has none.
    homeItemState: {
      findMany: async () => {
        rd('homeItemState.findMany');
        return [];
      },
    },
    homeOwedThread: {
      findMany: async (args: { where: { user_id: string } }) => {
        rd('homeOwedThread.findMany');
        return [...rows.values()].filter((r) => r.user_id === args.where.user_id);
      },
      findUnique: async (args: { where: { user_id_thread_key: { user_id: string; thread_key: string } } }) => {
        rd('homeOwedThread.findUnique');
        return rows.get(rowKey(args.where)) ?? null;
      },
      update: async (args: { where: { user_id_thread_key: { user_id: string; thread_key: string } }; data: Row }) => {
        w('homeOwedThread.update');
        const r = rows.get(rowKey(args.where));
        if (!r) throw new Error('update of a missing row');
        Object.assign(r, args.data, { updated_at: new Date() });
        return r;
      },
      upsert: async (args: { where: { user_id_thread_key: { user_id: string; thread_key: string } }; create: Row; update: Row }) => {
        w('homeOwedThread.upsert');
        const k = rowKey(args.where);
        const r = rows.get(k);
        if (r) Object.assign(r, args.update, { updated_at: new Date() });
        else
          rows.set(k, {
            state: 'queued', request_kind: null, requested_at: null, draft_id: null, draft_message_id: null, draft_hash: null, draft_text: null,
            draft_for_ask_id: null, drafted_at: null, mike_edited_at: null, bast_read: null, suggested_answer: null, needs_commitment: false,
            thought_since: null, attempts: 0, last_error: null, last_model: null, updated_at: new Date(), ...args.create,
          });
        return rows.get(k);
      },
      updateMany: async (args: { where: { user_id: string; thread_key: string; request_kind: string }; data: Row }) => {
        w('homeOwedThread.updateMany');
        const r = [...rows.values()].find((x) => x.user_id === args.where.user_id && x.thread_key === args.where.thread_key && x.request_kind === args.where.request_kind);
        if (!r) return { count: 0 };
        Object.assign(r, args.data);
        return { count: 1 };
      },
    },
    homeKeeperRun: {
      findUnique: async (args: { where: { user_id_date_kind: { user_id: string; date: Date; kind: string } } }) => {
        rd('homeKeeperRun.findUnique');
        const k = args.where.user_id_date_kind;
        return runs.get(`${k.user_id}|${k.date.toISOString()}|${k.kind}`) ?? null;
      },
      upsert: async (args: { where: { user_id_date_kind: { user_id: string; date: Date; kind: string } }; create: Row; update: Row }) => {
        w('homeKeeperRun.upsert');
        const k = args.where.user_id_date_kind;
        const key = `${k.user_id}|${k.date.toISOString()}|${k.kind}`;
        const r = runs.get(key);
        if (r) Object.assign(r, args.update);
        else runs.set(key, { ...args.create });
        return runs.get(key);
      },
    },
    homeAction: {
      create: async (args: { data: Row }) => {
        w('homeAction.create');
        const row = { id: `action-${++seq}`, undone_at: null, created_at: new Date(), ...args.data };
        actions.push(row);
        return row;
      },
    },
  };

  const db = new Proxy(
    { ...models, $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db) } as Record<string, unknown>,
    {
      get(target, prop: string) {
        if (prop in target) return target[prop];
        if (prop === 'then') return undefined;
        throw new Error(`The owed store touched ${prop}, which it must never do`);
      },
    },
  ) as unknown as PrismaClient;

  return { db, rows, runs, actions, writes, reads };
}

export const WRITE_METHODS = ['update', 'upsert', 'create', 'updateMany', 'delete'];
