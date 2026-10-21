/**
 * Where a notification click goes. The row's entity wins; when a row has no usable entity (an older
 * alert, a hand-made one), a staff task link inside the message ("Open the task: https://host/tasks/<id>")
 * is the fallback, so a portal request or message alert always opens its task.
 */
export interface NotificationTargetInput {
  type?: string | null;
  message?: string | null;
  entity_type: string | null;
  entity_id: string | null;
}

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

export function notificationTarget(n: NotificationTargetInput): string | null {
  if (n.entity_type && n.entity_id) {
    const routes: Record<string, string> = {
      task: `/tasks/${n.entity_id}`,
      project: `/projects/${n.entity_id}`,
      sop: `/grimoire/runes/${n.entity_id}`,
      recipe: `/grimoire/rituals/${n.entity_id}`,
    };
    if (routes[n.entity_type]) return routes[n.entity_type];
  }
  const m = n.message?.match(new RegExp(`/tasks/(${UUID})(?![0-9a-fA-F-])`));
  return m ? `/tasks/${m[1]}` : null;
}
