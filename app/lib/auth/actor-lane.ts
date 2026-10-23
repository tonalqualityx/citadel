/**
 * Fleet item 6: which machine lane made this write. Read on the server from the request's own
 * bearer key (its lane:<name> scope), never from client input. Null for browser sessions, for
 * keys without a lane, for engine keys (an engine key cannot carry a lane) and outside a request.
 * Staff views may show "Bast · <lane>"; portal projections never select it.
 */
import { cookies, headers } from 'next/headers';
import { prisma } from '@/lib/db/prisma';
import { hashApiKey } from './api-keys';
import { laneScopesOf } from './lane-scopes';

const TTL_MS = 60_000;
const MAX_CACHED = 500;
const laneByKeyHash = new Map<string, { lane: string | null; at: number }>();

/** authenticateApiKey records each key's lane here, so a later write in the request needs no query. */
export function rememberKeyLane(keyHash: string, lane: string | null, now: number = Date.now()) {
  laneByKeyHash.delete(keyHash);
  laneByKeyHash.set(keyHash, { lane, at: now });
  while (laneByKeyHash.size > MAX_CACHED) {
    const first = laneByKeyHash.keys().next();
    if (first.done) break;
    laneByKeyHash.delete(first.value);
  }
}

export function resetActorLaneCache() {
  laneByKeyHash.clear();
}

export async function currentActorLane(): Promise<string | null> {
  try {
    const h = await headers();
    const authz = h.get('authorization');
    if (!authz?.startsWith('Bearer ')) return null;
    // requireAuth prefers the session cookie; then the actor is a person, not a lane.
    const c = await cookies();
    if (c.get('access_token')?.value) return null;
    const keyHash = hashApiKey(authz.slice(7));
    const hit = laneByKeyHash.get(keyHash);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.lane;
    const key = await prisma.apiKey.findFirst({
      where: { key_hash: keyHash, is_revoked: false },
      select: { scopes: true },
    });
    const lanes = laneScopesOf(key?.scopes);
    const lane = lanes.length > 0 ? lanes.join(',').slice(0, 40) : null;
    rememberKeyLane(keyHash, lane);
    return lane;
  } catch {
    return null;
  }
}

/** Spread into a comment or activity-log create: `{ ...(await actorLaneField()) }`. */
export async function actorLaneField(): Promise<{ actor_lane?: string }> {
  const lane = await currentActorLane();
  return lane ? { actor_lane: lane } : {};
}
