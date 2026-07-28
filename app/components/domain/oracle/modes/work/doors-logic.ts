// Clarity Phase 8 (composition) — Work mode's four information-scent doors: Reviews /
// Intake / Pipeline / Due soon. Every door renders even at zero count (a stable landmark,
// same reasoning as IntakeDrawer's trigger) and always navigates somewhere real — never a
// dead click (G11).
import { commandAge } from '@/components/domain/oracle/oracle-logic';
import { dueSoonDoorSummary } from '@/lib/reason-chips';
import type { OracleMode } from '@/components/domain/oracle/modes/mode-shell-logic';

export interface Door {
  id: 'reviews' | 'intake' | 'pipeline' | 'due_soon';
  glyph: string;
  label: string;
  detail: string | null;
  target: OracleMode;
}

export interface BuildDoorsInput {
  reviewCount: number;
  reviewOldestWaitAt: string | null;
  intakeCount: number;
  intakeOldestAt: string | null;
  archivedToday: number;
  pipelineOpenCount: number; // prospect + in_motion
  pipelineNothingMovingCount: number;
  dueSoonTasks: Array<{ id: string; promised_to: string | null; due_date: string | null }>;
  nowMs: number;
}

export function buildDoors(input: BuildDoorsInput): Door[] {
  const dueSoon = dueSoonDoorSummary(input.dueSoonTasks);

  return [
    {
      id: 'reviews',
      glyph: '☑',
      label: input.reviewCount === 0 ? 'Reviews: none waiting' : `Reviews: ${input.reviewCount} waiting`,
      detail: input.reviewOldestWaitAt ? `oldest ${commandAge(input.reviewOldestWaitAt, input.nowMs)}` : null,
      target: 'process',
    },
    {
      id: 'intake',
      glyph: '▤',
      label: `Intake: ${input.intakeCount}`,
      detail:
        input.archivedToday > 0
          ? `${input.archivedToday} auto-archived today`
          : input.intakeOldestAt
            ? `oldest ${commandAge(input.intakeOldestAt, input.nowMs)}`
            : null,
      target: 'process',
    },
    {
      id: 'pipeline',
      glyph: '→',
      label: `Pipeline: ${input.pipelineOpenCount}`,
      detail: input.pipelineNothingMovingCount > 0 ? `${input.pipelineNothingMovingCount} with nothing moving` : null,
      target: 'plan',
    },
    {
      id: 'due_soon',
      glyph: '◷',
      label: `Due soon: ${dueSoon.count}`,
      detail: dueSoon.subtext,
      target: 'plan',
    },
  ];
}
