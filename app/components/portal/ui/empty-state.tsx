import { AllClearArt, Motif, type MotifName } from './motifs';

// Art, a title, one sentence and an optional action. Always sits inside a card.
export function EmptyState({
  art, title, body, action, headingLevel = 'h3',
}: {
  art: MotifName | 'all-clear';
  title: string;
  body: string;
  action?: React.ReactNode;
  /** h1 when the empty state is the whole page (an expired link). */
  headingLevel?: 'h1' | 'h3';
}) {
  const Heading = headingLevel;
  return (
    <div className="empty-card">
      <div className="empty">
        {art === 'all-clear' ? <AllClearArt /> : <Motif name={art} className="art" />}
        <Heading className={headingLevel === 'h1' ? 'h1' : undefined}>{title}</Heading>
        <p>{body}</p>
        {action ? <div className="actions">{action}</div> : null}
      </div>
    </div>
  );
}
