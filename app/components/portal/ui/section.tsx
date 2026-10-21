import type { LucideIcon } from 'lucide-react';
import type { Kind } from './icons';

// A titled block. The icon tile takes the kind color; the lede is one short line.
export function Section({
  id, title, icon: Icon, kind, lede, aside, children,
}: {
  id: string;
  title: string;
  icon?: LucideIcon;
  kind?: Kind;
  lede?: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="sec" aria-labelledby={`${id}-h`} data-kind={kind}>
      <div className="sec-h">
        {Icon ? (
          <span className="tile-ic" aria-hidden="true">
            <Icon className="i" focusable="false" />
          </span>
        ) : null}
        <h2 id={`${id}-h`}>{title}</h2>
        {aside ? <span className="aside meta">{aside}</span> : null}
      </div>
      {lede ? <p className="sec-lede">{lede}</p> : null}
      {children}
    </section>
  );
}
