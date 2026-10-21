import { getMeetingTypes } from '@/lib/portal/booking';
import { BookingPicker } from '@/components/portal/booking-picker';

// Book a meeting (portal MVP A5). Server component so the Calendly URLs (config map plus env
// overrides) are resolved on the server and passed down as plain data.
export const dynamic = 'force-dynamic';

export default function BookMeetingPage() {
  return <BookingPicker types={getMeetingTypes()} />;
}
