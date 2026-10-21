import { Check, Contrast, PenLine } from 'lucide-react';

export type YearMonth = { label: string; state: 'delivered' | 'current' | 'ready' | 'upcoming' | 'past' };

const SR: Record<YearMonth['state'], string> = {
  delivered: 'report delivered',
  current: 'this month, in progress',
  ready: 'plan ready for you',
  upcoming: '',
  past: '',
};

// Twelve months of the plan year. There is no "missed" state: a month is delivered, this one,
// ready for you, still to come, or simply past.
export function YearRibbon({ months }: { months: YearMonth[] }) {
  return (
    <ol className="year" aria-label="Months of the plan year">
      {months.map((m, i) => (
        <li key={`${m.label}-${i}`} className={m.state === 'delivered' ? 'done' : m.state === 'current' ? 'now' : m.state === 'ready' ? 'ready' : undefined}>
          <span className="c" aria-hidden="true">
            {m.state === 'delivered' ? <Check className="i" focusable="false" /> : null}
            {m.state === 'current' ? <Contrast className="i" focusable="false" /> : null}
            {m.state === 'ready' ? <PenLine className="i" focusable="false" /> : null}
          </span>
          <span>{m.label}</span>
          {SR[m.state] ? <span className="vh">{SR[m.state]}</span> : null}
        </li>
      ))}
    </ol>
  );
}
