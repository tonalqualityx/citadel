import { ChevronDown } from 'lucide-react';
import type { Kind } from './icons';
import { Timeline, type TimelineItem } from './timeline';

const KINDS: Kind[] = ['project', 'retainer', 'request'];

// One month: a heading, a summary line, a bar split by kind, then its dated timeline. A month
// folds to its header with a Show control (a native <details>).
export function MonthGroup({
  monthKey, label, summary, byKind, items, defaultOpen, empty = 'Nothing of this kind this month.',
}: {
  monthKey: string;
  label: string;
  summary: string;
  byKind: Record<string, number>;
  items: TimelineItem[];
  defaultOpen: boolean;
  empty?: string;
}) {
  return (
    <details className="month" open={defaultOpen} data-month={monthKey}>
      <summary>
        <div className="mh">
          <div className="mh-top">
            <h2>{label}</h2>
          </div>
          <p className="sum">{summary}</p>
          <span className="mbar" aria-hidden="true">
            {KINDS.filter((k) => byKind[k]).map((k) => (
              <i key={k} data-kind={k} style={{ flexGrow: byKind[k] }} />
            ))}
          </span>
        </div>
        <span className="chev">
          <span className="close-t">Show</span>
          <span className="open-t">Hide</span>
          <ChevronDown className="i" aria-hidden="true" focusable="false" />
        </span>
      </summary>
      {items.length > 0 ? <Timeline items={items} dated /> : <p className="month-empty">{empty}</p>}
    </details>
  );
}
