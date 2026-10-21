import { Check } from 'lucide-react';
import type { Kind } from './icons';

export type PhaseItem = { name: string; state: 'done' | 'current' | 'upcoming' };

// Dots on a line: done is filled with a check, current is ringed and says "Now".
export function PhaseTrack({ phases, kind }: { phases: PhaseItem[]; kind: Kind }) {
  if (phases.length === 0) return null;
  return (
    <ol className="phases" aria-label="Phases" data-kind={kind} style={{ gridTemplateColumns: `repeat(${phases.length}, minmax(0, 1fr))` }}>
      {phases.map((p, i) => (
        <li key={`${p.name}-${i}`} className={p.state === 'done' ? 'done' : p.state === 'current' ? 'now' : undefined}>
          <span className="pd" aria-hidden="true">
            {p.state === 'done' ? <Check className="i" focusable="false" /> : null}
          </span>
          <span>
            {p.name}
            {p.state === 'done' ? <span className="vh"> (done)</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}
