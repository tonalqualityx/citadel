import type { Prisma } from '@prisma/client';

// Oracle Projects Phase 1 follow-up (verification, 2026-09-04) — the stale mute is
// derived, never stamped from a single note's until_date. The original Phase 1 cut
// keyed "is this the active parked_until note" on `until_date` TIMESTAMP EQUALITY
// against Project.stale_muted_until, which breaks the instant two parked_until notes
// share a date (deleting either one would clear the mute even though the other still
// wants it live) and can't recover the correct fallback value when the active note is
// removed (it just nulls the mute instead of falling back to the next-latest park).
//
// The fix: Project.stale_muted_until is ALWAYS the MAX(until_date) over this project's
// live (is_deleted: false) parked_until notes — recomputed from scratch, inside the same
// transaction as the note write, on every notes POST and DELETE. There is no other way
// to write this column. This naturally gives:
//   - two parked notes sharing a date, one deleted -> mute unchanged (the other still
//     carries that same MAX date)
//   - the last live park deleted -> mute recomputes to null
//   - an older park still live when a later one is removed -> mute falls back to the
//     older park's date
//   - a NEW park dated earlier than the current mute -> MAX keeps the later existing
//     date; the mute never moves backward
export async function recomputeStaleMutedUntil(
  tx: Prisma.TransactionClient,
  projectId: string
): Promise<Date | null> {
  const result = await tx.projectNote.aggregate({
    where: { project_id: projectId, kind: 'parked_until', is_deleted: false },
    _max: { until_date: true },
  });
  const staleMutedUntil = result._max.until_date ?? null;
  await tx.project.update({
    where: { id: projectId },
    data: { stale_muted_until: staleMutedUntil },
  });
  return staleMutedUntil;
}
