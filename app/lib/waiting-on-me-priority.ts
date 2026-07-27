// Clarity Phase 7 (Seeing Stone Reckoning P1) — the do-queue's cross-bucket priority
// float. /api/waiting-on-me's `do` group is a concat of 4 separately-ordered sweep
// buckets (focus, overdue, blocked, open-within-14d); nothing previously re-sorted the
// CONCATENATED list, so a P1 sitting in, say, the open-within-14d bucket rendered below
// a P3/P4/P5 from the focus bucket. This is a stable partition, not a full re-sort:
// priority 1 items float to the top (in their original relative order), then priority 2,
// then everything else in ITS original relative order — never reorders within a tier,
// only promotes the two urgent tiers above the rest. Pure/dependency-free so it's
// unit-testable without touching the DB.

export interface PriorityRankable {
  priority: number | null;
}

export function floatHighPriority<T extends PriorityRankable>(items: T[]): T[] {
  const p1: T[] = [];
  const p2: T[] = [];
  const rest: T[] = [];

  for (const item of items) {
    if (item.priority === 1) {
      p1.push(item);
    } else if (item.priority === 2) {
      p2.push(item);
    } else {
      rest.push(item);
    }
  }

  return [...p1, ...p2, ...rest];
}
