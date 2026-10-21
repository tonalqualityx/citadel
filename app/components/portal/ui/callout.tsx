import type { LucideIcon } from 'lucide-react';

// "Needs you" (attention) and errors (urgent). The count badge has an accessible label.
export function Callout({
  tone = 'attention', icon: Icon, title, count, note, id, children,
}: {
  tone?: 'attention' | 'urgent';
  icon: LucideIcon;
  title: string;
  count?: number;
  note?: string;
  id?: string;
  children?: React.ReactNode;
}) {
  const hid = `${id ?? 'callout'}-h`;
  return (
    <section className="callout" data-tone={tone} aria-labelledby={hid} id={id}>
      <div className="sec-h">
        <span className="tile-ic" aria-hidden="true">
          <Icon className="i" focusable="false" />
        </span>
        <h2 id={hid}>{title}</h2>
        {typeof count === 'number' ? (
          <span className="count num" aria-label={`${count} ${count === 1 ? 'item' : 'items'}`}>
            {count}
          </span>
        ) : null}
      </div>
      {note ? <p className="note">{note}</p> : null}
      {children}
    </section>
  );
}
