import { AllClearArt, Motif, type MotifName } from './motifs';

// Art, a title, one sentence and an optional action. Always sits inside a card.
export function EmptyState({
  art, title, body, action,
}: {
  art: MotifName | 'all-clear';
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-card">
      <div className="empty">
        {art === 'all-clear' ? <AllClearArt /> : <Motif name={art} className="art" />}
        <h3>{title}</h3>
        <p>{body}</p>
        {action ? <div className="actions">{action}</div> : null}
      </div>
    </div>
  );
}
