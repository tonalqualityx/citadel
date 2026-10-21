import type { LucideIcon } from 'lucide-react';
import { StatusChip, type ChipProps } from './status-chip';
import type { Kind } from './icons';

// A card with a colored left rail (where the work lives), an icon tile, a written kind and a chip.
export function RailCard({
  kind, icon: Icon, eyebrow, title, chip, children, as: Tag = 'article',
}: {
  kind: Kind;
  icon: LucideIcon;
  eyebrow?: string;
  title: string;
  chip?: ChipProps;
  children?: React.ReactNode;
  as?: 'article' | 'div' | 'section';
}) {
  return (
    <Tag className="rcard" data-kind={kind}>
      <div className="row-h">
        <span className="tile-ic" aria-hidden="true">
          <Icon className="i" focusable="false" />
        </span>
        <div>
          {eyebrow ? (
            <p className="kind" data-kind={kind}>
              {eyebrow}
            </p>
          ) : null}
          <h3>{title}</h3>
        </div>
        {chip ? <StatusChip {...chip} /> : null}
      </div>
      {children}
    </Tag>
  );
}
