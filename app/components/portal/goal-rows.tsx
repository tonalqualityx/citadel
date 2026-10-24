import { TrendingDown, TrendingUp } from 'lucide-react';

// A confirmed goal in client words: what it is, where we are aiming, and where it stands now.
// Rendered only when the API sends goals (the portal KPI switch is on).
export interface GoalView {
  label: string;
  target_text: string;
  direction: 'up' | 'down';
  last_text: string | null;
}

export function GoalRows({ goals }: { goals: GoalView[] }) {
  return (
    <ul className="rows" data-goals>
      {goals.map((g, i) => {
        const Arrow = g.direction === 'down' ? TrendingDown : TrendingUp;
        return (
          <li key={`${g.label}-${i}`}>
            <span className="t">{g.label}</span>
            <span className="meta">
              <span className="goal-target">
                <Arrow className="i" aria-hidden="true" focusable="false" />
                <span>{g.target_text}</span>
              </span>
              {g.last_text ? <span className="num">{g.last_text}</span> : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
