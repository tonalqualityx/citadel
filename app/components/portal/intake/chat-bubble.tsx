import type { ReactNode } from 'react';

// One message. Indelible ("us") sits left with the navy I mark and a square top-left corner; the
// person ("you") sits right on the tint. `current` is the prompt being asked now. `onChange` adds a
// Change button under an answer.
export function ChatBubble({
  side,
  who,
  when,
  current,
  author,
  onChange,
  changeLabel,
  children,
}: {
  side: 'us' | 'you';
  who: string;
  when?: string;
  current?: boolean;
  author?: string;
  onChange?: () => void;
  /** Names the Change button for assistive tech, e.g. the question being changed. */
  changeLabel?: string;
  children: ReactNode;
}) {
  return (
    <div className={`msg ${side}${current ? ' current' : ''}`} data-author={author}>
      {side === 'us' ? (
        <span className="av" aria-hidden="true">
          I
        </span>
      ) : null}
      <span className="who">{who}</span>
      <div className="bub">{children}</div>
      {when ? <span className="when">{when}</span> : null}
      {onChange ? (
        <span className="ctl">
          <button type="button" onClick={onChange} aria-label={changeLabel ? `Change your answer: ${changeLabel}` : undefined}>
            Change
          </button>
        </span>
      ) : null}
    </div>
  );
}
