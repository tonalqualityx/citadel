/**
 * An in-memory stand-in for the Prisma calls lib/design/publishes.ts makes, so the publish route tests run the
 * real route AND the real library logic without a database. Flat queries only (no relation selects), simple
 * where operators (equals, in, notIn, not, gt, gte, lt, lte, equals+mode). $transaction runs the callback
 * against the same store (no rollback: a test that expects a refusal checks nothing was written before it).
 * The scratch integration test covers the real database (partial unique indexes, raw SQL).
 */
import crypto from 'crypto';

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

const TABLES = [
  'user', 'site', 'task', 'designSession', 'designPortalSettings', 'designWorkerState', 'designPublish', 'designChange',
  'designCommand', 'designEvent', 'comment', 'taskReceipt', 'notification',
] as const;
type Table = (typeof TABLES)[number];

const DEFAULTS: Partial<Record<Table, () => Row>> = {
  designPublish: () => ({
    kind: 'publish', status: 'queued', rolls_back_id: null, change_ids: [], confirmation_shown: null, confirmation_token_hash: null,
    confirmation_expires_at: null, confirmation_typed: null, confirm_requested_at: null, confirmed_at: null, head_sha: null,
    from_main_sha: null, result_sha: null, deploy_id: null, deploy_url: null, alias_url: null, gates: null, policy: null,
    diff_summary: null, cost_usd: null, error: null, notified_at: null, rolled_back_at: null, rolled_back_by_id: null,
    started_at: null, finished_at: null,
  }),
  designCommand: () => ({ status: 'pending', payload: {}, claimed_at: null, completed_at: null, result: null, error: null }),
};

function cmp(a: unknown, b: unknown): number {
  const x = a instanceof Date ? a.getTime() : (a as number | string);
  const y = b instanceof Date ? b.getTime() : (b as number | string);
  return x < y ? -1 : x > y ? 1 : 0;
}

function eq(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

function matchValue(v: unknown, cond: unknown): boolean {
  if (cond === null || typeof cond !== 'object' || cond instanceof Date || Array.isArray(cond)) return eq(v, cond);
  const c = cond as Record<string, unknown>;
  for (const [op, arg] of Object.entries(c)) {
    switch (op) {
      case 'equals':
        if (c.mode === 'insensitive' && typeof v === 'string' && typeof arg === 'string') {
          if (v.toLowerCase() !== arg.toLowerCase()) return false;
        } else if (!eq(v, arg)) return false;
        break;
      case 'mode':
        break;
      case 'in':
        if (!(arg as unknown[]).some((x) => eq(v, x))) return false;
        break;
      case 'notIn':
        if ((arg as unknown[]).some((x) => eq(v, x))) return false;
        break;
      case 'not':
        if (arg === null ? v === null || v === undefined : matchValue(v, arg)) return false;
        break;
      case 'gt':
        if (v === null || v === undefined || cmp(v, arg) <= 0) return false;
        break;
      case 'gte':
        if (v === null || v === undefined || cmp(v, arg) < 0) return false;
        break;
      case 'lt':
        if (v === null || v === undefined || cmp(v, arg) >= 0) return false;
        break;
      case 'lte':
        if (v === null || v === undefined || cmp(v, arg) > 0) return false;
        break;
      default:
        throw new Error(`fake db: unsupported operator ${op}`);
    }
  }
  return true;
}

export function matches(row: Row, where: Where | undefined): boolean {
  if (!where) return true;
  for (const [k, cond] of Object.entries(where)) {
    if (k === 'AND') {
      if (!(cond as Where[]).every((w) => matches(row, w))) return false;
    } else if (k === 'OR') {
      if (!(cond as Where[]).some((w) => matches(row, w))) return false;
    } else if (!matchValue(row[k], cond)) return false;
  }
  return true;
}

function pick(row: Row | undefined, select: Record<string, unknown> | undefined): Row | null {
  if (!row) return null;
  if (!select) return { ...row };
  const out: Row = {};
  for (const [k, on] of Object.entries(select)) {
    if (on === true) out[k] = row[k];
    else throw new Error(`fake db: relation select ${k} is not supported`);
  }
  return out;
}

function sortRows(rows: Row[], orderBy: unknown): Row[] {
  if (!orderBy) return rows;
  const keys = (Array.isArray(orderBy) ? orderBy : [orderBy]) as Record<string, unknown>[];
  return [...rows].sort((a, b) => {
    for (const k of keys) {
      const [field, spec] = Object.entries(k)[0];
      const dir = typeof spec === 'string' ? spec : (spec as { sort: string }).sort;
      const av = a[field];
      const bv = b[field];
      if (av == null && bv == null) continue;
      if (av == null) return 1;
      if (bv == null) return -1;
      const c = cmp(av, bv) * (dir === 'desc' ? -1 : 1);
      if (c !== 0) return c;
    }
    return 0;
  });
}

function stripJsonNull(data: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(data)) {
    // Prisma.DbNull / JsonNull are objects with a toString of 'DbNull' / 'JsonNull'.
    out[k] = v && typeof v === 'object' && /^(Db|Json)Null$/.test(String((v as object).constructor?.name ?? '')) ? null : v;
  }
  return out;
}

function model(store: Record<Table, Row[]>, table: Table) {
  const rows = () => store[table];
  return {
    findUnique: async (args: { where: Where; select?: Record<string, unknown> }) => pick(rows().find((r) => matches(r, args.where)), args.select),
    findUniqueOrThrow: async (args: { where: Where; select?: Record<string, unknown> }) => {
      const r = rows().find((x) => matches(x, args.where));
      if (!r) throw new Error(`fake db: ${table} not found`);
      return pick(r, args.select);
    },
    findFirst: async (args: { where?: Where; orderBy?: unknown; select?: Record<string, unknown> } = {}) =>
      pick(sortRows(rows().filter((r) => matches(r, args.where)), args.orderBy)[0], args.select),
    findMany: async (args: { where?: Where; orderBy?: unknown; select?: Record<string, unknown>; take?: number } = {}) => {
      const list = sortRows(rows().filter((r) => matches(r, args.where)), args.orderBy);
      return (args.take ? list.slice(0, args.take) : list).map((r) => pick(r, args.select) as Row);
    },
    count: async (args: { where?: Where } = {}) => rows().filter((r) => matches(r, args.where)).length,
    create: async (args: { data: Row; select?: Record<string, unknown> }) => {
      const now = new Date();
      const row: Row = { id: crypto.randomUUID(), created_at: now, updated_at: now, ...(DEFAULTS[table]?.() ?? {}), ...stripJsonNull(args.data) };
      rows().push(row);
      return pick(row, args.select);
    },
    update: async (args: { where: Where; data: Row }) => {
      const r = rows().find((x) => matches(x, args.where));
      if (!r) throw new Error(`fake db: ${table} not found for update`);
      Object.assign(r, stripJsonNull(args.data), { updated_at: new Date() });
      return { ...r };
    },
    updateMany: async (args: { where: Where; data: Row }) => {
      const hit = rows().filter((r) => matches(r, args.where));
      for (const r of hit) Object.assign(r, stripJsonNull(args.data), { updated_at: new Date() });
      return { count: hit.length };
    },
  };
}

export function createFakeDb() {
  const store = Object.fromEntries(TABLES.map((t) => [t, [] as Row[]])) as Record<Table, Row[]>;
  const db: Record<string, unknown> = {
    store,
    reset() {
      for (const t of TABLES) store[t].length = 0;
    },
    $executeRaw: async () => 0,
    $queryRaw: async () => {
      throw new Error('fake db: raw queries are covered by the scratch integration test');
    },
  };
  for (const t of TABLES) db[t] = model(store, t);
  db.$transaction = async (arg: unknown) => (typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(db) : Promise.all(arg as unknown[]));
  return db as Record<Table, ReturnType<typeof model>> & {
    store: Record<Table, Row[]>;
    reset(): void;
    $transaction: (fn: unknown) => Promise<unknown>;
  };
}

/** One shared instance: route tests mock `@/lib/db/prisma` with `{ prisma: fakeDb }`. */
export const fakeDb = createFakeDb();
