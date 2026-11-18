/**
 * Client proposals in Triage (Mike, 2026-11-18): a plan Bast wrote for an underspecified client ask, waiting for his yes.
 *
 * Such a task is NOT in status `triage`: it is `not_started`, assigned to Mike and tagged `plan-approval`, because the worker's spawn
 * gate and the emailed-yes flip (plan_approval.py) key on those tags and only Mike's session may move a task out of status triage.
 * So the Triage tab shows these tasks by tag instead: `client-proposal` (origin, set by recommend.sh) AND `plan-approval` (still
 * waiting). The emailed yes drops `plan-approval`, which is what takes the card out of the list.
 */
import type { Prisma } from '@prisma/client';
import type { HomeClientProposal } from '@/lib/home/types';

export const CLIENT_PROPOSAL_TAG = 'client-proposal';
export const PLAN_APPROVAL_TAG = 'plan-approval';

/** Tasks that are a client proposal still waiting for the owner's yes. */
export function clientProposalWhere(): Prisma.TaskWhereInput {
  return {
    is_deleted: false,
    status: { notIn: ['triage', 'done', 'abandoned'] },
    AND: [{ tags: { has: CLIENT_PROPOSAL_TAG } }, { tags: { has: PLAN_APPROVAL_TAG } }],
  };
}

export const PROPOSAL_SELECT = {
  id: true,
  title: true,
  created_at: true,
  client: { select: { name: true } },
  site: { select: { name: true, client: { select: { name: true } } } },
} satisfies Prisma.TaskSelect;
export type ProposalRow = Prisma.TaskGetPayload<{ select: typeof PROPOSAL_SELECT }>;

export function proposalClientName(r: ProposalRow): string | null {
  return r.client?.name ?? r.site?.client?.name ?? null;
}

export function toClientProposal(r: ProposalRow, now: Date = new Date()): HomeClientProposal {
  return {
    task_id: r.id,
    title: r.title,
    href: `/tasks/${r.id}`,
    client_name: proposalClientName(r),
    site_name: r.site?.name ?? null,
    created_at: r.created_at.toISOString(),
    age_days: Math.max(0, Math.floor((now.getTime() - r.created_at.getTime()) / 86_400_000)),
  };
}
