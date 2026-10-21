import { RequestEntry } from '@/components/portal/chat/request-entry';

export const metadata = { title: 'Request work | Indelible Portal' };

// Request work. The chat when it is available for the contact, else the phase B stepper; the
// client component decides after reading /api/portal/intake/context and frames both.
export default function NewRequestPage() {
  return <RequestEntry />;
}
