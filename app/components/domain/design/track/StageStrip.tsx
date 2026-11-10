'use client';

import type { DesignSessionTrack } from '@/lib/hooks/use-design';

/** The seven steps the designer sees, in order (SPEC 4). */
export const STAGE_STEPS = ['Research', 'Outline', 'Direction', 'Home', 'Refine', 'Rest of site', 'Review'] as const;
export type StageStepLabel = (typeof STAGE_STEPS)[number];

/**
 * Server stage (SPEC 2.5) to the current step. The outline (content wireframe) is built during the server's `research`
 * stage and has no stage of its own, so it counts as finished when the track reaches `art_direction`.
 * `done` has no current step: every step is complete. Unknown stages (`cancelled`) return null: no strip.
 */
const CURRENT_STEP: Record<string, number | 'all'> = {
  research: 0,
  art_direction: 2,
  home_build: 3,
  refine: 4,
  rest_build: 5,
  review: 6,
  done: 'all',
};

export function stageProgress(stage: string): { current: number | null; allDone: boolean } | null {
  const v = CURRENT_STEP[stage];
  if (v === undefined) return null;
  return v === 'all' ? { current: null, allDone: true } : { current: v, allDone: false };
}

/** The stage strip of a tracked session's workspace header. Renders nothing for an untracked session. */
export function StageStrip({ track }: { track: DesignSessionTrack | null | undefined }) {
  if (!track) return null;
  const progress = stageProgress(track.stage);
  if (!progress) return null;
  return (
    <div className="flex w-full min-w-0 flex-col gap-1" data-testid="stage-strip">
      <nav aria-label="Design stages">
        <ol className="flex flex-wrap gap-x-1 gap-y-1 text-xs">
          {STAGE_STEPS.map((label, i) => {
            const isCurrent = progress.current === i;
            const complete = progress.allDone || (progress.current !== null && i < progress.current);
            return (
              <li
                key={label}
                aria-current={isCurrent ? 'step' : undefined}
                data-state={isCurrent ? 'current' : complete ? 'complete' : 'upcoming'}
                className={
                  'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 ' +
                  (isCurrent
                    ? 'border-primary bg-primary/10 font-semibold text-text-main'
                    : complete
                      ? 'border-border-warm bg-background-light text-text-main'
                      : 'border-border-warm text-text-sub')
                }
              >
                {complete && <span aria-hidden="true">&#10003;</span>}
                <span>{label}</span>
                {isCurrent && <span className="font-normal text-text-sub">(now)</span>}
                {complete && <span className="sr-only">(done)</span>}
                {!isCurrent && !complete && <span className="sr-only">(not started)</span>}
              </li>
            );
          })}
        </ol>
      </nav>
      <p role="status" aria-live="polite" className="min-h-0 text-xs text-text-sub" data-testid="stage-busy-line">
        {track.busy && track.busy_line ? track.busy_line : ''}
      </p>
    </div>
  );
}
