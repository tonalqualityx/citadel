import { Clock, UserCheck } from 'lucide-react';
import { Callout } from '@/components/portal/ui/callout';

// A person on the team has the conversation. The words come from the server: HANDOFF_BANNER while
// the team has not answered, "<First name> from Indelible replied." once a staff reply is in the thread.
export function HandoffBanner({ text, replied = false }: { text: string; replied?: boolean }) {
  return (
    <div className="chat-banner" data-testid="chat-handoff" data-replied={replied || undefined}>
      <Callout tone="attention" icon={replied ? UserCheck : Clock} title="With the team" id="chat-handoff">
        <p>{text}</p>
      </Callout>
    </div>
  );
}
