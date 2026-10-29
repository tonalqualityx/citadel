/**
 * The worker inbox (design 7.3): commands first (oldest first), then undelivered designer messages, then sessions
 * the daemon has not set up yet, plus the settings the daemon obeys. `enabled = false` returns empty arrays.
 * Publish and rollback commands carry the `publish` object the daemon's executor needs; it fails safe when
 * anything is missing, so every snapshot field is filled here from the row (never from the command payload).
 */
import type { PrismaClient } from '@prisma/client';
import { prisma as defaultDb } from '@/lib/db/prisma';
import { inbox } from './commands';
import { normalizeMainRole } from './publish-policy';
import { num } from './worker-kit';

export interface InboxPublish {
  id: string;
  kind: string;
  status: string;
  confirmed_at: Date | null;
  actor_role: string;
  publish_mode: string;
  main_role: string;
  live_url: string | null;
  site_designer_publish: boolean;
  head_sha: string | null;
  rolls_back_id: string | null;
  /** publish: its own (null until it runs). rollback: the TARGET publish's main before. */
  from_main_sha: string | null;
  /** publish: its own (null until it runs). rollback: the TARGET publish's main after. */
  result_sha: string | null;
}

const liveUrlOf = (shown: unknown): string | null => {
  const v = shown && typeof shown === 'object' ? (shown as { live_url?: unknown }).live_url : null;
  return typeof v === 'string' && v ? v : null;
};

/** D11: the project's override, else the client's folder, else null. */
export async function resolveDriveFolder(
  s: { project_id: string | null; task_id: string },
  db: Pick<PrismaClient, 'project' | 'task'> = defaultDb,
): Promise<string | null> {
  if (s.project_id) {
    const p = await db.project.findUnique({ where: { id: s.project_id }, select: { drive_folder_id: true, client: { select: { drive_folder_id: true } } } });
    if (p?.drive_folder_id) return p.drive_folder_id;
    if (p?.client?.drive_folder_id) return p.client.drive_folder_id;
  }
  const t = await db.task.findUnique({ where: { id: s.task_id }, select: { client: { select: { drive_folder_id: true } } } });
  return t?.client?.drive_folder_id ?? null;
}

export async function buildInbox(opts: { max?: number } = {}, db: PrismaClient = defaultDb) {
  const settingsRow = await db.designPortalSettings.findUnique({ where: { id: 1 } });
  const settings = {
    enabled: settingsRow?.enabled ?? false,
    idle_close_minutes: settingsRow?.idle_close_minutes ?? 10,
    max_live_sessions: settingsRow?.max_live_sessions ?? 4,
  };
  if (!settings.enabled) return { commands: [], messages: [], new_sessions: [], settings };

  const max = Math.min(200, Math.max(1, Math.trunc(opts.max ?? 50) || 50));
  const { commands: raw, messages: rawMessages } = await inbox({ max }, db);

  // Publish objects for publish and rollback commands.
  const pubIds = raw
    .filter((c) => c.verb === 'publish' || c.verb === 'rollback')
    .map((c) => (c.payload as { publish_id?: unknown } | null)?.publish_id)
    .filter((x): x is string => typeof x === 'string');
  const pubs = pubIds.length ? await db.designPublish.findMany({ where: { id: { in: pubIds } } }) : [];
  const targetIds = pubs.map((p) => p.rolls_back_id).filter((x): x is string => !!x);
  const targets = targetIds.length ? await db.designPublish.findMany({ where: { id: { in: targetIds } } }) : [];
  const worker = await db.designWorkerState.findUnique({ where: { id: 1 }, select: { site_live_urls: true } });
  const siteUrls = (worker?.site_live_urls && typeof worker.site_live_urls === 'object' ? worker.site_live_urls : {}) as Record<string, unknown>;

  const commands = raw.map((c) => {
    let publish: InboxPublish | undefined;
    const pid = (c.payload as { publish_id?: unknown } | null)?.publish_id;
    const p = typeof pid === 'string' ? pubs.find((x) => x.id === pid) : undefined;
    if (p && (c.verb === 'publish' || c.verb === 'rollback')) {
      const t = p.rolls_back_id ? targets.find((x) => x.id === p.rolls_back_id) : undefined;
      const fallbackUrl = typeof siteUrls[p.site_id] === 'string' ? (siteUrls[p.site_id] as string) : null;
      publish = {
        id: p.id, kind: p.kind, status: p.status, confirmed_at: p.confirmed_at,
        actor_role: p.actor_role, publish_mode: p.publish_mode, main_role: normalizeMainRole(p.main_role),
        live_url: liveUrlOf(p.confirmation_shown) ?? (t ? liveUrlOf(t.confirmation_shown) : null) ?? fallbackUrl,
        site_designer_publish: p.site_designer_publish, head_sha: p.head_sha, rolls_back_id: p.rolls_back_id,
        from_main_sha: p.kind === 'rollback' ? (t?.from_main_sha ?? null) : p.from_main_sha,
        result_sha: p.kind === 'rollback' ? (t?.result_sha ?? null) : p.result_sha,
      };
    }
    return { ...c, ...(publish ? { publish } : {}) };
  });

  const authorIds = [...new Set(rawMessages.map((m) => m.author_id).filter((x): x is string => !!x))];
  const authors = authorIds.length ? await db.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, name: true } }) : [];
  const nameOf = new Map(authors.map((a) => [a.id, a.name]));
  const messages = rawMessages.map((m) => ({
    session_id: m.session_id, seq: m.seq, kind: m.kind, payload: m.payload,
    author: { name: (m.author_id && nameOf.get(m.author_id)) || null },
  }));

  const fresh = await db.designSession.findMany({ where: { status: 'pending' }, orderBy: { created_at: 'asc' }, take: max });
  const new_sessions = [];
  for (const s of fresh) {
    new_sessions.push({
      id: s.id, task_id: s.task_id, site_id: s.site_id, branch: s.branch, preview_alias: s.preview_alias, model: s.model,
      effort: s.effort, budget_usd: num(s.budget_usd), cost_usd: num(s.cost_usd), sdk_session_id: s.sdk_session_id,
      drive_folder_id: await resolveDriveFolder(s, db),
    });
  }

  return { commands, messages, new_sessions, settings };
}
