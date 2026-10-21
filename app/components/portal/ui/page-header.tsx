import { Fragment } from 'react';
import { Motif, type MotifName } from './motifs';

// The top card of every signed-in screen: eyebrow, the one H1, a lede, actions, and a landscape.
export function PageHeader({
  eyebrow, title, size = 'page', lede, actions, motif, titleId,
}: {
  eyebrow?: React.ReactNode[];
  title: string;
  size?: 'display' | 'page';
  lede?: string;
  actions?: React.ReactNode;
  motif?: MotifName | null;
  titleId?: string;
}) {
  return (
    <header className={`ph${motif ? '' : ' no-motif'}`}>
      {eyebrow && eyebrow.length > 0 ? (
        <p className="eyebrow">
          {eyebrow.map((e, i) => (
            <Fragment key={i}>
              {i > 0 ? <span aria-hidden="true">·</span> : null}
              <span>{e}</span>
            </Fragment>
          ))}
        </p>
      ) : null}
      <h1 id={titleId} className={size === 'display' ? 'display' : 'h1'}>
        {title}
      </h1>
      {lede ? <p className="lede">{lede}</p> : null}
      {actions ? <div className="actions">{actions}</div> : null}
      {motif ? <Motif name={motif} className="motif" /> : null}
    </header>
  );
}
