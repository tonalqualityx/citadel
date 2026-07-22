import type { EmailAsk } from '@/lib/hooks/use-waiting-on-me';

// Clarity Phase 4a — the crisis strip. Pure shaping/labels so the render component stays a
// dumb presentational layer, same split as needs-reshi-logic.ts.

export const SEVERITY_LABEL: Record<NonNullable<EmailAsk['severity']>, string> = {
  client_blocking: 'client-blocking',
  launch_blocking: 'launch-blocking',
  internal: 'internal',
};

/** Direct "From" label: name + email if we have a name, else just the email. */
export function crisisFromLabel(ask: Pick<EmailAsk, 'from_name' | 'from_email'>): string {
  return ask.from_name ? `${ask.from_name} <${ask.from_email}>` : ask.from_email;
}

/** True whenever the strip has anything to show — the exception-based "zero pixels when
 *  calm" gate lives here so the component and any test can share one source of truth. */
export function hasCrisis(crisis: EmailAsk[]): boolean {
  return crisis.length > 0;
}
