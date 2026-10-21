import Link from 'next/link';
import { TYPE_ICON, type HistoryType, type Kind } from './icons';
import { SiteMark } from './site-mark';

export type TimelineItem = {
  id: string;
  kind: Kind;
  type: HistoryType;
  title: string;
  /** "Completed", "You approved", "Published", "Milestone". */
  what: string;
  /** Already formatted: "Oct 20". */
  at: string;
  kindLabel?: string;
  site?: string | null;
  href?: string | null;
};

// A vertical line with a ringed dot per item. `dated` adds a date column from 700px.
export function Timeline({ items, dated = false }: { items: TimelineItem[]; dated?: boolean }) {
  return (
    <ul className={`tl${dated ? ' dated' : ''}`}>
      {items.map((it) => {
        const Icon = TYPE_ICON[it.type];
        return (
          <li key={it.id} data-kind={it.kind} className={it.type === 'milestone' ? 'mile' : undefined}>
            {dated ? <span className="d num">{it.at}</span> : null}
            <span className="dot" aria-hidden="true">
              <Icon className="i" focusable="false" />
            </span>
            <div className="b">
              <span className="what">
                {it.what}
                <span className="when"> · {it.at}</span>
              </span>
              <span className="t">{it.href ? <Link href={it.href}>{it.title}</Link> : it.title}</span>
              {it.kindLabel || it.site ? (
                <span className="meta">
                  {it.kindLabel ? (
                    <span className="kind" data-kind={it.kind}>
                      {it.kindLabel}
                    </span>
                  ) : null}
                  {it.site ? <SiteMark name={it.site} /> : null}
                </span>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
