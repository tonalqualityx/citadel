import { Clock } from 'lucide-react';
import { Callout } from '@/components/portal/ui/callout';

// A person on the team has the conversation. The words come from the server (HANDOFF_BANNER).
export function HandoffBanner({ text }: { text: string }) {
  return (
    <div className="chat-banner" data-testid="chat-handoff">
      <Callout tone="attention" icon={Clock} title="With the team" id="chat-handoff">
        <p>{text}</p>
      </Callout>
    </div>
  );
}
