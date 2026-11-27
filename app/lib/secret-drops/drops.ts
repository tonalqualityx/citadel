/**
 * Secret drop (task 0f36c806; Mike, 2026-11-27: "I want to be able to give this stuff to you. This is my primary interface. Make it so I can give
 * it to you and you can put it where it can be accessed."). Handbook section 3 item 4: handing over a credential is Mike's own act; the link only
 * gives him a safe place to do it.
 *
 *   mintDrop        POST /api/secret-drops                    the Bast machine (~/.claude/tools/secret-drop) asks for a one-time link for a named key (and the task waiting on it)
 *   readDropPage    GET  /api/secret-drop-links/:token        the page Mike opens on his phone (or, as JSON, its status)
 *   submitDrop      POST /api/secret-drop-links/:token        his browser sends the key, already encrypted
 *   machineView     GET  /api/secret-drops/:id                the machine collects the ciphertext
 *   recordResult    POST /api/secret-drops/:id/result         the machine says stored (or why not); the ciphertext is wiped, the waiting task moves
 *
 * Where the key travels. The machine makes an RSA key pair per drop and keeps the private half on the machine. The page encrypts the pasted key in
 * the browser (a fresh AES-GCM key, wrapped with RSA-OAEP-256 to the drop's public key) before anything is sent, so Citadel only ever receives and
 * holds ciphertext it cannot read, and holds that only until the machine stores the key. Nothing here logs a request body.
 *
 * The URL token is `<drop id>.<HMAC-SHA256 of the id>` with a key derived from the server secret (the same pattern as the report answer links,
 * lib/tasks/answer-links.ts), so an altered link matches nothing. A drop takes one key, once.
 */
import { createHmac, timingSafeEqual } from 'crypto';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import type { AuthPayload } from '@/lib/auth/middleware';
import { BAST_USER_ID, MIKE_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { releaseTasksIfReleasable, unblockEligibleDependents } from '@/lib/services/dependencies';
import { closeAsksForTask } from '@/lib/work/ask-closure'; // Work stage A: the one closure of a finished task's emails

type Auth = Pick<AuthPayload, 'userId' | 'via' | 'lane'>;

export const AWAITING_KEY_TAG = 'awaiting-key';
export const NEEDS_MIKE_TAG = 'needs-mike';
export const MINUTES_DEFAULT = 60;
export const MINUTES_MAX = 24 * 60;
/** The longest key the page accepts, in characters. A service account file fits; a pasted novel does not. */
export const VALUE_MAX = 8000;

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Who may mint and collect: Mike himself, or the Bast user's worker key on the machine (the secret-drop tool). Never Dox or another lane.

export function mayUseDrops(auth: Auth): boolean {
  if (auth.userId === MIKE_USER_ID) return true;
  return auth.userId === BAST_USER_ID && (!auth.lane || auth.lane === 'bast');
}

function assertMayUse(auth: Auth) {
  if (!mayUseDrops(auth)) throw new ApiError('Only Mike or the Bast machine use secret drops.', 403, 'drop_not_allowed');
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Signing

function linkKey(): Buffer {
  const secret = process.env.QUESTION_LINK_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new ApiError('Secret drop links are not set up on this server.', 500, 'link_secret_missing');
  return createHmac('sha256', secret).update('citadel:secret-drop-link:v1').digest();
}

function sign(id: string): string {
  return createHmac('sha256', linkKey()).update(id).digest('base64url');
}

const TOKEN_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/;

export function dropToken(id: string): string {
  return `${id}.${sign(id)}`;
}

export function verifyDropToken(token: string): string | null {
  const m = TOKEN_RE.exec(token);
  if (!m) return null;
  const want = Buffer.from(sign(m[1]));
  const got = Buffer.from(m[2]);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  return m[1];
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Shapes

const B64URL = /^[A-Za-z0-9_-]+$/;

export const publicKeySchema = z
  .object({
    kty: z.literal('RSA'),
    // 2048 to 4096 bit modulus, base64url
    n: z.string().regex(B64URL).min(340).max(700),
    e: z.string().regex(B64URL).min(2).max(8),
    alg: z.literal('RSA-OAEP-256').optional(),
    ext: z.boolean().optional(),
    key_ops: z.array(z.string()).optional(),
  })
  .strip();

export const mintSchema = z
  .object({
    key_name: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/, 'key_name is the name the key is stored under: capitals, digits and underscores, like DATAFORSEO_PASSWORD.'),
    label: z.string().trim().min(1).max(120).optional(),
    task_id: z.string().uuid().optional(),
    mike_task_id: z.string().uuid().optional(),
    public_key: publicKeySchema,
    expires_in_minutes: z.number().int().min(5).max(MINUTES_MAX).optional(),
    replaces_existing: z.boolean().optional(),
  })
  .strict();
export type MintBody = z.infer<typeof mintSchema>;

export const envelopeSchema = z
  .object({
    v: z.literal(1),
    // the AES key wrapped with RSA-OAEP-256 (2048 to 4096 bits)
    ek: z.string().regex(B64URL).min(340).max(700),
    iv: z.string().regex(B64URL).length(16),
    // AES-GCM ciphertext plus its 16-byte tag: room for VALUE_MAX characters of UTF-8
    ct: z.string().regex(B64URL).min(24).max(Math.ceil(((VALUE_MAX * 4 + 16) * 4) / 3) + 4),
  })
  .strict();

export const resultSchema = z.union([
  z.object({ ok: z.literal(true), stored_where: z.string().trim().min(1).max(200) }).strict(),
  z.object({ ok: z.literal(false), reason: z.string().trim().min(1).max(300) }).strict(),
]);

export type DropStatus = 'waiting' | 'received' | 'stored' | 'failed' | 'expired';

type DropRow = NonNullable<Awaited<ReturnType<typeof prisma.secretDrop.findUnique>>>;

export function statusOf(d: Pick<DropRow, 'submitted_at' | 'stored_at' | 'failed_at' | 'expires_at'>, now: Date = new Date()): DropStatus {
  if (d.stored_at) return 'stored';
  if (d.failed_at) return 'failed';
  if (d.submitted_at) return 'received';
  return d.expires_at.getTime() <= now.getTime() ? 'expired' : 'waiting';
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Minting

export interface MintedDrop {
  id: string;
  key_name: string;
  url: string;
  expires_at: string;
  task_id: string | null;
}

export async function mintDrop(auth: Auth, body: MintBody, baseUrl: string, now: Date = new Date()): Promise<MintedDrop> {
  assertMayUse(auth);
  linkKey(); // fail before writing anything when the server has no secret
  const expires = new Date(now.getTime() + (body.expires_in_minutes ?? MINUTES_DEFAULT) * 60_000);
  const drop = await prisma.$transaction(async (tx) => {
    let addedNeedsMike = false;
    if (body.task_id) {
      const task = await tx.task.findFirst({ where: { id: body.task_id, is_deleted: false }, select: { id: true, tags: true } });
      if (!task) throw new ApiError('The waiting task was not found.', 404, 'task_not_found');
      const tags = task.tags ?? [];
      addedNeedsMike = !tags.includes(NEEDS_MIKE_TAG);
      const next = [...tags];
      if (!next.includes(AWAITING_KEY_TAG)) next.push(AWAITING_KEY_TAG);
      if (addedNeedsMike) next.push(NEEDS_MIKE_TAG);
      if (next.length !== tags.length) await tx.task.update({ where: { id: task.id }, data: { tags: next } });
    }
    if (body.mike_task_id) {
      const mt = await tx.task.findFirst({ where: { id: body.mike_task_id, is_deleted: false }, select: { id: true } });
      if (!mt) throw new ApiError("Mike's task was not found.", 404, 'mike_task_not_found');
    }
    return tx.secretDrop.create({
      data: {
        key_name: body.key_name,
        label: body.label ?? body.key_name,
        task_id: body.task_id ?? null,
        mike_task_id: body.mike_task_id ?? null,
        public_key: { kty: 'RSA', n: body.public_key.n, e: body.public_key.e, alg: 'RSA-OAEP-256' },
        replaces_existing: body.replaces_existing ?? false,
        added_needs_mike: addedNeedsMike,
        expires_at: expires,
        minted_by_id: auth.userId,
      },
    });
  });
  const root = baseUrl.replace(/\/+$/, '');
  return { id: drop.id, key_name: drop.key_name, url: `${root}/api/secret-drop-links/${dropToken(drop.id)}`, expires_at: drop.expires_at.toISOString(), task_id: drop.task_id };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The machine's side

export interface MachineView {
  id: string;
  key_name: string;
  status: DropStatus;
  /** Present only while the key is received and not yet stored. */
  ciphertext?: unknown;
  expires_at: string;
  submitted_at: string | null;
  stored_at: string | null;
  failed_reason: string | null;
}

export async function machineView(auth: Auth, id: string, now: Date = new Date()): Promise<MachineView> {
  assertMayUse(auth);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError('Drop not found', 404);
  const d = await prisma.secretDrop.findUnique({ where: { id } });
  if (!d) throw new ApiError('Drop not found', 404);
  const status = statusOf(d, now);
  const view: MachineView = {
    id: d.id,
    key_name: d.key_name,
    status,
    expires_at: d.expires_at.toISOString(),
    submitted_at: d.submitted_at?.toISOString() ?? null,
    stored_at: d.stored_at?.toISOString() ?? null,
    failed_reason: d.failed_reason,
  };
  if (status === 'received' && d.ciphertext) view.ciphertext = JSON.parse(d.ciphertext);
  return view;
}

function dateWords(d: Date): string {
  return d.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'long', day: 'numeric', year: 'numeric' });
}

export interface ResultOutcome {
  id: string;
  status: DropStatus;
  released_task_ids: string[];
}

/** The machine's answer: stored (where, in words), or why not. Either way the ciphertext is wiped. Storing moves the waiting task. */
export async function recordResult(auth: Auth, id: string, body: z.infer<typeof resultSchema>, now: Date = new Date()): Promise<ResultOutcome> {
  assertMayUse(auth);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError('Drop not found', 404);
  const out = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM secret_drops WHERE id = ${id}::uuid FOR UPDATE`;
    const d = await tx.secretDrop.findUnique({ where: { id } });
    if (!d) throw new ApiError('Drop not found', 404);
    const was = statusOf(d, now);
    if (was === 'stored' || was === 'failed') return { drop: d, fresh: false };
    if (was !== 'received') throw new ApiError('Nothing has been received on that link yet.', 409, 'not_received');

    if (!body.ok) {
      const drop = await tx.secretDrop.update({ where: { id }, data: { ciphertext: null, failed_at: now, failed_reason: body.reason } });
      return { drop, fresh: true };
    }
    const drop = await tx.secretDrop.update({ where: { id }, data: { ciphertext: null, stored_at: now, stored_where: body.stored_where } });
    const date = dateWords(now);

    if (d.task_id) {
      const task = await tx.task.findFirst({ where: { id: d.task_id, is_deleted: false }, select: { id: true, tags: true } });
      if (task) {
        // Another link for this task still open keeps the hold on.
        const openOthers = await tx.secretDrop.count({ where: { task_id: task.id, id: { not: id }, stored_at: null, failed_at: null, expires_at: { gt: now } } });
        if (openOthers === 0) {
          // needs-mike comes off only when this link put it on, or when it stood for Mike's own task asking for this key (now closed).
          const liftNeedsMike = d.added_needs_mike || !!d.mike_task_id;
          const next = (task.tags ?? []).filter((t) => t !== AWAITING_KEY_TAG && !(liftNeedsMike && t === NEEDS_MIKE_TAG));
          if (next.length !== (task.tags ?? []).length) await tx.task.update({ where: { id: task.id }, data: { tags: next } });
        }
        // Written as Bast: a note for the record, not a human reply, so it never wakes the card by itself.
        await tx.comment.create({
          data: {
            task_id: task.id,
            user_id: BAST_USER_ID,
            content: `Mike handed over ${d.label} through a one-time link on ${date}. It is stored on the Bast machine under ${d.key_name} (${body.stored_where}). ~ Bast`,
            mentioned_user_ids: [],
            is_internal: true,
            client_visible: false,
            client_question: false,
          },
        });
      }
    }
    let closedMikeTask: string | null = null;
    if (d.mike_task_id) {
      const mt = await tx.task.findFirst({ where: { id: d.mike_task_id, is_deleted: false }, select: { id: true, status: true } });
      if (mt && mt.status !== 'done' && mt.status !== 'abandoned') {
        await tx.task.update({ where: { id: mt.id }, data: { status: 'done', completed_at: now } });
        await tx.comment.create({
          data: {
            task_id: mt.id,
            user_id: BAST_USER_ID,
            content: `Done: Mike handed over ${d.label} through the one-time link on ${date}, and it is stored under ${d.key_name}. ~ Bast`,
            mentioned_user_ids: [],
            is_internal: true,
            client_visible: false,
            client_question: false,
          },
        });
        closedMikeTask = mt.id;
      }
    }
    return { drop, fresh: true, closedMikeTask };
  });

  const released: string[] = [];
  if (out.fresh && out.drop.stored_at) {
    if ('closedMikeTask' in out && out.closedMikeTask) {
      await closeAsksForTask(prisma, out.closedMikeTask, 'done'); // Work stage A
      released.push(...(await unblockEligibleDependents(out.closedMikeTask)));
    }
    if (out.drop.task_id) released.push(...(await releaseTasksIfReleasable([out.drop.task_id])));
  }
  return { id: out.drop.id, status: statusOf(out.drop, now), released_task_ids: [...new Set(released)] };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Mike's side (no session: the signed token is the permission)

export interface PublicView {
  ok: boolean;
  status: DropStatus | 'altered';
  key_name?: string;
  label?: string;
  replaces_existing?: boolean;
  failed_reason?: string | null;
  public_key?: unknown;
}

const ALTERED: PublicView = { ok: false, status: 'altered' };

export async function publicView(token: string, now: Date = new Date()): Promise<PublicView> {
  const id = verifyDropToken(token);
  if (!id) return ALTERED;
  const d = await prisma.secretDrop.findUnique({ where: { id } });
  if (!d) return ALTERED;
  const status = statusOf(d, now);
  const v: PublicView = { ok: true, status, key_name: d.key_name, label: d.label, replaces_existing: d.replaces_existing };
  if (status === 'waiting') v.public_key = d.public_key;
  if (status === 'failed') v.failed_reason = d.failed_reason;
  return v;
}

export interface SubmitOutcome {
  ok: boolean;
  status: DropStatus | 'altered';
  code: 'received' | 'altered' | 'used' | 'expired';
  httpStatus: number;
}

/** Takes the encrypted key, once. The envelope is opaque here: Citadel cannot read it and never tries. */
export async function submitDrop(token: string, envelope: z.infer<typeof envelopeSchema>, now: Date = new Date()): Promise<SubmitOutcome> {
  const id = verifyDropToken(token);
  if (!id) return { ok: false, status: 'altered', code: 'altered', httpStatus: 400 };
  const d = await prisma.secretDrop.findUnique({ where: { id }, select: { id: true, submitted_at: true, stored_at: true, failed_at: true, expires_at: true } });
  if (!d) return { ok: false, status: 'altered', code: 'altered', httpStatus: 400 };
  const status = statusOf(d, now);
  if (status === 'expired') return { ok: false, status, code: 'expired', httpStatus: 410 };
  if (status !== 'waiting') return { ok: false, status, code: 'used', httpStatus: 410 };
  const claimed = await prisma.secretDrop.updateMany({
    where: { id, submitted_at: null, expires_at: { gt: now } },
    data: { submitted_at: now, ciphertext: JSON.stringify(envelope) },
  });
  if (claimed.count !== 1) return { ok: false, status: 'received', code: 'used', httpStatus: 410 };
  return { ok: true, status: 'received', code: 'received', httpStatus: 200 };
}

/** A POST from Mike's page: no Origin, the opaque "null" one, or Citadel's own host. A script on any other site may not post a key. */
export function postOriginAllowed(origin: string | null, ownHosts: Array<string | null | undefined>): boolean {
  if (origin === null || origin === '' || origin === 'null') return true;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  return ownHosts.some((h) => !!h && h.toLowerCase() === host.toLowerCase());
}
