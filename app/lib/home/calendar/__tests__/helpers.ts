import type { CalEvent } from '../classify';

export const ZONE = 'America/New_York';
/** Wednesday 2026-11-11, New York is UTC-5. */
export const at = (hhmm: string, day = '2026-11-11'): Date => {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCHours(h + 5, m);
  return d;
};

let n = 0;
export function ev(over: Partial<CalEvent> & { start?: string; end?: string; day?: string }): CalEvent {
  n += 1;
  const { start, end, day, ...rest } = over;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    event_id: `g${n}`,
    title: 'Event',
    starts_at: at(start ?? '10:00', day),
    ends_at: at(end ?? '10:30', day),
    all_day: false,
    description: null,
    meet_url: null,
    location: null,
    attendees: null,
    ...rest,
  };
}

export const guest = (email: string, name: string | null = null, status = 'accepted') => ({ email, display_name: name, response_status: status, organizer: false, self: false });
export const me = (status = 'accepted') => ({ email: 'mike@becomeindelible.com', display_name: 'Mike', response_status: status, organizer: true, self: true });
