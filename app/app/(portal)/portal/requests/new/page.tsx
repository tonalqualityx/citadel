import { IntakeChat } from '@/components/portal/intake/intake-chat';
import { PageHeader } from '@/components/portal/ui/page-header';

export const metadata = { title: 'Request work | Indelible Portal' };

// Request work (portal phase B slice 1). The chat is a client component; this page only frames it.
export default function NewRequestPage() {
  return (
    <>
      <PageHeader
        eyebrow={['Requests', 'New request']}
        title="Ask us for something"
        size="page"
        lede="A few short questions, then you check it and send. Nothing reaches the team until you press Send request."
        motif="contours"
      />
      <IntakeChat />
    </>
  );
}
