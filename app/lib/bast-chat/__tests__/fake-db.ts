/* eslint-disable @typescript-eslint/no-explicit-any */
/** A small in-memory stand-in for the chat tables, for the mocked-Prisma tests. Only what the code under test calls. */
import { vi } from 'vitest';

export interface FakeEvent { conversation_id: string; seq: number; role: string; kind: string; payload: unknown; context?: unknown; client_ref?: string | null; delivered_at: Date | null; expired_at: Date | null; created_at: Date; turn?: number | null }
export interface FakeConv { id: string; owner_id: string; status: string; last_seq: number; title: string | null; cost_usd: number; last_message_at: Date | null }

const matchesJson = (payload: unknown, w: { path: string[]; equals: unknown }) => (payload as Record<string, unknown> | null)?.[w.path[0]] === w.equals;

export interface FakeChatDb {
  conv: FakeConv;
  events: FakeEvent[];
  usage: { turns: number; writes: number; cost: number };
  _n?: number;
  [k: string]: any;
}

export function makeChatDb(opts: { conv?: Partial<FakeConv>; settings?: Record<string, unknown> | null } = {}): any {
  const conv: FakeConv = { id: 'c1111111-1111-4111-8111-111111111111', owner_id: 'o1111111-1111-4111-8111-111111111111', status: 'idle', last_seq: 0, title: null, cost_usd: 0, last_message_at: null, ...opts.conv };
  const events: FakeEvent[] = [];
  const usage = { turns: 0, writes: 0, cost: 0 };
  const settings = opts.settings === undefined ? null : opts.settings;

  const where = (e: FakeEvent, w: Record<string, any> = {}): boolean => {
    for (const [k, v] of Object.entries(w)) {
      if (k === 'conversation') continue;
      if (k === 'OR') continue;
      const val = (e as any)[k];
      if (v && typeof v === 'object' && !(v instanceof Date)) {
        if ('lt' in v && !(val < v.lt)) return false;
        if ('gt' in v && !(val > v.gt)) return false;
        if ('in' in v && !v.in.includes(val)) return false;
        if ('path' in v && !matchesJson(val, v)) return false;
      } else if (val !== v && !(v === null && val == null)) return false;
    }
    return true;
  };

  const api: any = {
    conv, events, usage,
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      if (sql.includes('FOR UPDATE')) return [{ status: conv.status, owner_id: conv.owner_id }];
      if (sql.includes('last_seq = last_seq +')) {
        conv.last_seq += (api._n ?? 1);
        return [{ last_seq: conv.last_seq }];
      }
      return [];
    }),
    bastChatEvent: {
      findUnique: vi.fn(async ({ where: w }: any) => {
        const k = w.conversation_id_client_ref;
        return events.find((e) => e.conversation_id === k.conversation_id && e.client_ref === k.client_ref) ?? null;
      }),
      create: vi.fn(async ({ data }: any) => { events.push({ delivered_at: null, expired_at: null, created_at: new Date(), client_ref: null, ...data }); return data; }),
      createMany: vi.fn(async ({ data }: any) => { for (const d of data) events.push({ delivered_at: null, expired_at: null, created_at: new Date(), client_ref: null, ...d }); return { count: data.length }; }),
      findMany: vi.fn(async ({ where: w }: any) => events.filter((e) => where(e, w)).map((e) => ({ ...e, conversation: conv }))),
      count: vi.fn(async ({ where: w }: any) => events.filter((e) => where(e, w)).length),
      updateMany: vi.fn(async ({ where: w, data }: any) => { const hit = events.filter((e) => where(e, w)); hit.forEach((e) => Object.assign(e, data)); return { count: hit.length }; }),
    },
    bastChatConversation: {
      findUnique: vi.fn(async () => conv),
      updateMany: vi.fn(async () => ({ count: 0 })),
      update: vi.fn(async ({ data }: any) => { for (const [k, v] of Object.entries(data)) { (conv as any)[k] = v && typeof v === 'object' && 'increment' in (v as object) ? (conv as any)[k] + (v as any).increment : v; } return { owner_id: conv.owner_id }; }),
    },
    bastChatUsage: {
      findUnique: vi.fn(async () => ({ turns: usage.turns, writes: usage.writes, cost_usd: { toString: () => String(usage.cost) } })),
      upsert: vi.fn(async ({ update }: any) => { usage.turns += update.turns.increment; usage.writes += update.writes.increment; usage.cost += update.cost_usd.increment; return {}; }),
    },
    bastChatSettings: { findUnique: vi.fn(async () => settings) },
    $transaction: vi.fn(async (fn: any) => fn(api)),
  };
  return api;
}
