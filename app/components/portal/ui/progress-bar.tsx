import type { Kind } from './icons';

// Always prints "N of M complete"; with nothing to count it prints nothing and hides the bar.
export function ProgressBar({ done, total, label, kind, next }: { done: number; total: number; label?: string; kind?: Kind; next?: string | null }) {
  if (total <= 0) return null;
  const pct = Math.max(0, Math.min(100, (done / total) * 100));
  return (
    <div className="prog" data-kind={kind}>
      <div className="lab">
        <span>
          <b className="num">
            {done} of {total}
          </b>{' '}
          {label ?? 'complete'}
        </span>
        {next ? <span>Next: {next}</span> : null}
      </div>
      <div className="bar" aria-hidden="true">
        <i style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
