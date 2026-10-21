/**
 * The sweeper skip condition `portal_answered` for portal.first_response (portal phase B).
 *
 * A first-response clock exists so no client request sits silent. Once the task has left
 * not_started, or is staged for the client, someone has answered, and the clock must not fire.
 * A staff reply made visible to the client (slice 2) will be added here as a third signal.
 */
export function isPortalTaskAnswered(task: {
  status: string;
  staging_preview_url?: string | null;
}): boolean {
  if (task.status !== 'not_started') return true;
  return typeof task.staging_preview_url === 'string' && task.staging_preview_url.length > 0;
}
