import type { ReactNode } from 'react';
import { User } from 'lucide-react';
import { IndelibleMark } from '@/components/portal/ui/indelible-mark';

// One message. Indelible ("us") sits left with the Indelible logomark and a square top-left corner; the
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
        author === 'team' ? (
          // A person on the team: a person icon, distinct from the assistant's logomark.
          <span className="av av-person" aria-hidden="true" data-testid="chat-person-mark">
            <User className="i" focusable="false" />
          </span>
        ) : (
          <span className="av av-mark" aria-hidden="true" data-testid="chat-assistant-mark">
            <IndelibleMark size={28} />
          </span>
        )
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
