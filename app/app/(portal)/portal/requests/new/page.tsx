import { IntakeChat } from '@/components/portal/intake/intake-chat';

export const metadata = { title: 'Request work | Indelible Portal' };

// Request work (portal phase B slice 1). The chat is a client component; this page only frames it.
export default function NewRequestPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold text-text-main">Request work</h1>
      <IntakeChat />
    </div>
  );
}
