import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getMeetingTypes, MEETING_TYPE_KEYS, type MeetingTypeKey } from '@/lib/portal/booking';
import { BookingPicker } from '@/components/portal/booking-picker';
import { CLIENT_SESSION_COOKIE, validateClientSession } from '@/lib/services/client-auth';

// Book a meeting (portal MVP A5). Server component so the Calendly URLs (config map plus env
// overrides) are resolved on the server and passed down as plain data. Needs a signed-in session:
// without a valid one the person goes to the login page. validateClientSession is read-only (it
// does not slide the cookie, which a server component cannot set).
export const dynamic = 'force-dynamic';

export default async function BookMeetingPage({
  searchParams,
}: {
  searchParams?: Promise<{ type?: string | string[] }>;
} = {}) {
  const cookieStore = await cookies();
  const token = cookieStore.get(CLIENT_SESSION_COOKIE)?.value;
  const identity = token ? await validateClientSession(token) : null;
  if (!identity) redirect('/portal/login');
  // ?type=marketing (the Retainer page's "Book a meeting") opens that meeting type directly.
  const raw = (await searchParams)?.type;
  const wanted = Array.isArray(raw) ? raw[0] : raw;
  const initialType = (MEETING_TYPE_KEYS as readonly string[]).includes(wanted ?? '') ? (wanted as MeetingTypeKey) : null;
  return <BookingPicker types={getMeetingTypes()} initialType={initialType} />;
}
