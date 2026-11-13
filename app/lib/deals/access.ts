/**
 * Who may read the signed deal (lib/deals/read.ts). The deal carries prices and contract state, so it is never part of an ordinary read:
 *   - the enforced bast-chat lane (Mike's chat): yes, for any project or client it asks about;
 *   - the Dox lane: only under its project binding, the same rule its writes use (the x-dox-project header names a live project and Dox holds an
 *     open pass on it), and then only that project's deal or its own client's deals;
 *   - everyone else (tech, designer, a client's portal session, a bot key with no lane, every other lane): no. They get the route's ordinary
 *     answer with no `deal` key at all.
 * Returns a boolean and never throws, so a refused reader simply sees the route as it was before.
 */
import type { PrismaClient } from '@prisma/client';
import type { AuthPayload } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { CHAT_LANE } from '@/lib/bast-chat/task-filter';
import { isDoxLane, requireProjectInPlay } from '@/lib/dox/guard';
import { MIKE_USER_ID } from '@/lib/oracle/projects/gate-constants';

type Auth = Pick<AuthPayload, 'via' | 'lane' | 'laneEnforced'>;
type Hdrs = Pick<Headers, 'get'>;

export function isEnforcedChatLane(auth: Auth): boolean {
  return auth.via === 'api_key' && auth.lane === CHAT_LANE && auth.laneEnforced === true;
}

/** `projectId` and/or `clientId` is what the read is about. */
export async function mayReadDeal(auth: Auth, headers: Hdrs, about: { projectId?: string | null; clientId?: string | null }, db: PrismaClient = prisma): Promise<boolean> {
  if (isEnforcedChatLane(auth)) return true;
  if (auth.via === 'api_key' && isDoxLane(auth)) {
    try {
      const play = await requireProjectInPlay(headers, about.projectId ?? null, db);
      if (about.projectId) return play.id === about.projectId;
      return !!about.clientId && play.client_id === about.clientId;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * A Triage card for this caller: the deal's detail (line items, prices, retainers) stays only for the owner's own session, the enforced chat lane
 * and the Dox lane inside its project binding. Everyone else (the triage desk, any other key) gets `deal_detail: null` on EVERY route and reply
 * that returns a card (GET, PATCH and PUT of /triage), because a lane that can link a card to a project could otherwise read that project's prices.
 */
export async function cardForCaller<T extends { project: { project_id: string; deal_detail?: unknown } | null }>(auth: Auth & { userId?: string }, headers: Hdrs, card: T): Promise<T> {
  if (!card.project || !card.project.deal_detail) return card;
  if (auth.via === 'session' && auth.userId === MIKE_USER_ID) return card;
  if (await mayReadDeal(auth, headers, { projectId: card.project.project_id })) return card;
  return { ...card, project: { ...card.project, deal_detail: null } };
}
