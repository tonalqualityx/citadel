import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getMeetingTypes } from '@/lib/portal/booking';
import { BookingPicker } from '@/components/portal/booking-picker';
import { CLIENT_SESSION_COOKIE, validateClientSession } from '@/lib/services/client-auth';

// Book a meeting (portal MVP A5). Server component so the Calendly URLs (config map plus env
// overrides) are resolved on the server and passed down as plain data. Needs a signed-in session:
// without a valid one the person goes to the login page. validateClientSession is read-only (it
// does not slide the cookie, which a server component cannot set).
export const dynamic = 'force-dynamic';

export default async function BookMeetingPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(CLIENT_SESSION_COOKIE)?.value;
  const identity = token ? await validateClientSession(token) : null;
  if (!identity) redirect('/portal/login');
  return <BookingPicker types={getMeetingTypes()} />;
}
