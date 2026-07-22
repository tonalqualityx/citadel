// Clarity Phase 4a — the intake drawer. Pure formatting so the render component stays a
// dumb presentational layer, same split as needs-reshi-logic.ts / crisis-strip-logic.ts.

/** "2:41 PM" in the given IANA zone — always render in the RESOLVED user timezone, never
 *  the browser's implicit locale zone (the exact class of bug Phase 3d fixed elsewhere on
 *  this page — see lib/services/user-timezone.ts). */
export function formatNewestAt(iso: string, timezone: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: timezone });
}

/** The collapsed summary line's full text: "📬 Intake · N" (+ newest time when there's at
 *  least one item — an empty drawer has nothing to report a time for). */
export function intakeSummaryLine(count: number, newestAt: string | null, timezone: string): string {
  const base = `📬 Intake · ${count}`;
  if (count === 0 || !newestAt) return base;
  return `${base} · newest ${formatNewestAt(newestAt, timezone)}`;
}
