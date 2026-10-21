import { Bot } from 'lucide-react';
import { DISCLOSURE_LINE } from '@/lib/portal/chat/copy';

// The one line under the page header that says replies marked Indelible assistant are written by an AI.
export function DisclosureLine() {
  return (
    <p className="chat-disclosure" data-testid="chat-disclosure">
      <Bot className="i" aria-hidden="true" focusable="false" />
      <span>{DISCLOSURE_LINE}</span>
    </p>
  );
}
