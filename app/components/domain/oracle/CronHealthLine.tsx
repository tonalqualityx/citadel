'use client';

import { AlertTriangle } from 'lucide-react';
import type { OracleMachineDTO } from '@/lib/types/oracle';
import { erroringCrons } from './oracle-logic';

interface CronHealthLineProps {
  machines: OracleMachineDTO[];
  /** Seeing Stone's header pairs this line with a preceding date string via a literal
   *  "· " on the healthy branch; Fleet's header has no leading text, so it omits the
   *  bullet there. Defaults on (Seeing Stone's original behavior). */
  bullet?: boolean;
}

// Clarity Phase 3c: extracted verbatim from OracleHeader's inline cron-health markup
// so the SAME line can render on both the Seeing Stone header and the Fleet screen
// header (Mike's ruling: "Machine-health/cron-error line stays on the Seeing Stone
// header AND appears here"). Exception-based display is unchanged: healthy crons earn
// only a quiet one-liner, an erroring cron earns the warning-gold icon+text.
export function CronHealthLine({ machines, bullet = true }: CronHealthLineProps) {
  const crons = erroringCrons(machines);

  if (crons.length === 0) {
    return <span>{bullet ? '· ' : ''}all crons healthy</span>;
  }

  return (
    <span
      className="flex items-center gap-1 font-semibold text-[var(--warning)]"
      data-testid="cron-health-warning"
    >
      <AlertTriangle className="h-3 w-3" aria-hidden="true" />
      {crons.length} cron{crons.length === 1 ? '' : 's'} need attention:{' '}
      {crons.map((c) => c.title).join(', ')}
    </span>
  );
}
