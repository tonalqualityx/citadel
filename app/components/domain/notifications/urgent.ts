// An urgent notification: the urgent email alert (type oracle_urgent_email) or anything filed at
// critical priority. The bell list draws these with a red outline.
export function isUrgentNotification(n: { type: string; priority?: string | null }): boolean {
  return n.type === 'oracle_urgent_email' || n.priority === 'critical';
}
