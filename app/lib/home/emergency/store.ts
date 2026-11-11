/**
 * Home screen Slice 6a: the stores behind POST /api/home/rule, its undo, and the home-watch worker routes.
 *
 * Writes only: the Decision a rule press makes (key unique whatever the status, so a re-save after a retract reuses the
 * row), the caller's own home_item_state, home_actions and home_site_incident rows. It never touches an EmailAsk,
 * Task, Site, Client or the watchdog, and it never sends anything or requests any site.
 */

import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { ApiError } from '@/lib/api/errors';
import { ownerOnHome } from '../keeper/run';
import { parseItemKey } from '../item-key';
import { appendHomeAction, getHomeAction, getItemState, markHomeActionUndone, upsertItemState, type HomeDb } from '../state';
import {
  RULE_ACTION,
  RULE_DEFAULT_TEXT,
  RULE_DOMAIN_REFUSED,
  RULE_ITEM_NOT_FOUND,
  RULE_NOT_FOR_ITEM,
  RULE_REASON_MAX,
  RULE_SAVED_MESSAGE,
  RULE_SCOPE_NOT_OFFERED,
  RULE_SENDER_REFUSED,
  RULE_UNDO_CHANGED,
  RULE_UNDO_EXPIRED,
  RULE_UNDO_USED,
  SECURITY_NEVER_RULE,
  SITE_ACTION_CLEARED,
  ruleDecisionTitle,
  ruleSavedLine,
  siteAnswersAgainMailLine,
  siteClearedLine,
} from './copy';
import {
  domainRuleAllowed,
  normalizeHost,
  ruleKey,
  ruleScopesFor,
  RULE_LANE,
  RULE_TAGS,
  RULE_UNDO_DAYS,
  type RuleItem,
  type RuleKind,
} from './rule';
import {
  closeOnCheck,
  closeOnMailHandled,
  closeOnWatchdog,
  downMinutes,
  matchSiteHosts,
  MAIL_MAX_AGE_DAYS,
  parseSiteItemKey,
  siteHostOf,
  siteIncidentShown,
  siteItemKey,
  type IncidentSource,
  type SiteHost,
} from './site';
import { emailDomain, isOwnAddress } from '../rules';
import { loadNotEmergencyRules } from './read';
import { claimLines, loadEmergencySlack, loadWatchItems, previewLines, trackWatch, type WireLine } from './slack-store';
import { claimScans, loadOutsideScan, previewScans, type WireScan } from './scan-store';

export { RULE_ACTION };
const DAY_MS = 86_400_000;

// ============================================================================
// "Not an emergency" rules
// ============================================================================

export const ruleBodySchema = z
  .object({
    item_key: z.string().min(1).max(300),
    scope: z.enum(['sender', 'domain', 'site']),
    reason: z.string().max(RULE_REASON_MAX).optional(),
  })
  .strict();
export type RuleBody = z.infer<typeof ruleBodySchema>;

export interface RuleSaved {
  ok: true;
  action_id: string;
  undo_until: string;
  item_key: string;
  rule: { key: string; kind: RuleKind; value: string; revision: number; line: string };
  message: string;
}

interface ResolvedRuleItem {
  item: RuleItem;
  client_id: string | null;
  site_id: string | null;
  link: { entity_kind: 'email_ask' | 'site'; entity_id: string };
}

/** The record behind an item key, as the rule needs it. Throws 400 for a task (a security flag is never a rule). */
export async function resolveRuleItem(db: HomeDb, itemKey: string): Promise<ResolvedRuleItem> {
  const prefix = itemKey.slice(0, itemKey.indexOf(':'));
  if (prefix === 'task') throw new ApiError(SECURITY_NEVER_RULE, 400, 'never_a_rule');
  if (prefix === 'site') {
    const id = parseSiteItemKey(itemKey);
    if (!id) throw new ApiError(RULE_NOT_FOR_ITEM, 400, 'bad_item');
    const site = await db.site.findUnique({ where: { id }, select: { id: true, url: true, client_id: true } });
    const host = siteHostOf(site?.url);
    if (!site || !host) throw new ApiError(RULE_ITEM_NOT_FOUND, 404, 'not_found');
    return { item: { kind: 'site', host }, client_id: site.client_id, site_id: site.id, link: { entity_kind: 'site', entity_id: site.id } };
  }
  const parsed = parseItemKey(itemKey);
  if (!parsed || parsed.kind !== 'crisis') throw new ApiError(RULE_NOT_FOR_ITEM, 400, 'bad_item');
  const ask = await db.emailAsk.findUnique({ where: { id: parsed.id }, select: { id: true, from_email: true, client_id: true } });
  if (!ask) throw new ApiError(RULE_ITEM_NOT_FOUND, 404, 'not_found');
  return {
    item: { kind: 'crisis', from_email: ask.from_email },
    client_id: ask.client_id,
    site_id: null,
    link: { entity_kind: 'email_ask', entity_id: ask.id },
  };
}

function refusalFor(r: ResolvedRuleItem, scope: RuleKind): ApiError {
  if (r.item.kind === 'crisis') {
    if (scope === 'domain') {
      const d = emailDomain(r.item.from_email);
      if (!domainRuleAllowed(d)) return new ApiError(RULE_DOMAIN_REFUSED, 400, 'domain_refused');
    }
    if (scope === 'sender' && isOwnAddress(r.item.from_email)) return new ApiError(RULE_SENDER_REFUSED, 400, 'sender_refused');
  }
  return new ApiError(RULE_SCOPE_NOT_OFFERED, 400, 'scope_not_offered');
}

const isUniqueRace = (e: unknown): boolean => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

/**
 * Save a rule on Mike's press: one transaction with the Decision, its link, the item's not_emergency_at and the
 * home_actions row (undo for 7 days). A key that exists is reused: a retracted (or otherwise not confirmed) row goes
 * back to confirmed with revision + 1; a confirmed row is left as it is.
 */
export async function saveNotEmergencyRule(
  db: PrismaClient,
  userId: string,
  body: RuleBody,
  now: Date
): Promise<RuleSaved> {
  const resolved = await resolveRuleItem(db, body.item_key);
  const choice = ruleScopesFor(resolved.item).find((s) => s.scope === body.scope);
  if (!choice) throw refusalFor(resolved, body.scope);
  const key = ruleKey(choice.scope, choice.value);
  if (!key) throw new ApiError(RULE_SCOPE_NOT_OFFERED, 400, 'scope_not_offered');
  const reason = (body.reason ?? '').replace(/\s+/g, ' ').trim();
  const undoUntil = new Date(now.getTime() + RULE_UNDO_DAYS * DAY_MS);
  const line = ruleSavedLine(choice.scope, choice.value);

  const run = () =>
    db.$transaction(async (tx) => {
      const existing = await tx.decision.findUnique({ where: { key }, select: { id: true, status: true, revision: true, created_by_id: true } });
      let decisionId: string;
      let revision: number;
      let priorStatus: string | null = null;
      if (!existing) {
        const created = await tx.decision.create({
          data: {
            key,
            title: ruleDecisionTitle(choice.scope, choice.value),
            text: reason || RULE_DEFAULT_TEXT,
            kind: 'ruling',
            status: 'confirmed',
            scope: choice.scope === 'site' ? 'site' : 'lane',
            lane: RULE_LANE,
            client_id: resolved.client_id,
            site_id: resolved.site_id,
            author_user_id: userId,
            ruled_at: now,
            confirmed_by_user_id: userId,
            confirmed_at: now,
            created_by_id: userId,
            tags: [...RULE_TAGS],
          },
          select: { id: true, revision: true },
        });
        decisionId = created.id;
        revision = created.revision;
      } else if (existing.status === 'confirmed' && existing.created_by_id === userId) {
        decisionId = existing.id;
        revision = existing.revision;
        priorStatus = 'confirmed';
      } else {
        const updated = await tx.decision.update({
          where: { id: existing.id },
          data: {
            status: 'confirmed',
            revision: { increment: existing.status === 'confirmed' ? 0 : 1 },
            title: ruleDecisionTitle(choice.scope, choice.value),
            text: reason || RULE_DEFAULT_TEXT,
            confirmed_by_user_id: userId,
            confirmed_at: now,
            ruled_at: now,
            created_by_id: userId,
            client_id: resolved.client_id,
            site_id: resolved.site_id,
          },
          select: { revision: true },
        });
        decisionId = existing.id;
        revision = updated.revision;
        priorStatus = existing.status;
      }
      await tx.decisionLink.upsert({
        where: {
          decision_id_entity_kind_entity_id_relation: {
            decision_id: decisionId,
            entity_kind: resolved.link.entity_kind,
            entity_id: resolved.link.entity_id,
            relation: 'ruled_on',
          },
        },
        create: { decision_id: decisionId, entity_kind: resolved.link.entity_kind, entity_id: resolved.link.entity_id, relation: 'ruled_on' },
        update: {},
      });

      const before = await getItemState(tx, userId, body.item_key);
      await upsertItemState(tx, userId, body.item_key, { not_emergency_at: now });
      const ruleRecord = { decision_id: decisionId, key, kind: choice.scope, value: choice.value, revision };
      const action = await appendHomeAction(tx, userId, {
        item_key: body.item_key,
        action: RULE_ACTION,
        before: {
          states: [{ item_key: body.item_key, existed: before !== null, fields: { not_emergency_at: before?.not_emergency_at?.toISOString() ?? null } }],
          rule: { ...ruleRecord, prior_status: priorStatus },
        },
        after: {
          states: [{ item_key: body.item_key, fields: { not_emergency_at: now.toISOString() } }],
          rule: ruleRecord,
          line,
        },
        undo_until: undoUntil,
      });
      return { action_id: action.id, revision };
    });

  let out: { action_id: string; revision: number };
  try {
    out = await run();
  } catch (e) {
    if (!isUniqueRace(e)) throw e;
    out = await run(); // another press made the row first; this pass reuses it
  }
  return {
    ok: true,
    action_id: out.action_id,
    undo_until: undoUntil.toISOString(),
    item_key: body.item_key,
    rule: { key, kind: choice.scope, value: choice.value, revision: out.revision, line },
    message: RULE_SAVED_MESSAGE,
  };
}

/**
 * Undo a saved rule (seven days). Retracts the Decision only when it is still confirmed at the revision the press
 * wrote (compare and set), clears not_emergency_at on the item, and marks the action undone. 404 for an action that is
 * not the caller's rule action, 409 when used, expired or changed since.
 */
export async function undoNotEmergencyRule(
  db: PrismaClient,
  userId: string,
  actionId: string,
  now: Date
): Promise<{ ok: true; item_key: string | null; message: string }> {
  return db.$transaction(async (tx) => {
    const row = await getHomeAction(tx, userId, actionId);
    if (!row || row.action !== RULE_ACTION) throw new ApiError('Not found', 404, 'not_found');
    if (row.undone_at) throw new ApiError(RULE_UNDO_USED, 409, 'undo_used');
    if (!row.undo_until || now.getTime() > row.undo_until.getTime()) throw new ApiError(RULE_UNDO_EXPIRED, 409, 'undo_expired');
    const after = row.after && typeof row.after === 'object' ? (row.after as { rule?: { decision_id?: string; revision?: number } }) : null;
    const rule = after?.rule;
    if (!rule?.decision_id || typeof rule.revision !== 'number') throw new ApiError('Not found', 404, 'not_found');
    const cas = await tx.decision.updateMany({
      where: { id: rule.decision_id, status: 'confirmed', revision: rule.revision },
      data: { status: 'retracted' },
    });
    if (cas.count !== 1) throw new ApiError(RULE_UNDO_CHANGED, 409, 'undo_changed');
    if (row.item_key) {
      await tx.homeItemState.updateMany({
        where: { user_id: userId, item_key: row.item_key, not_emergency_at: { not: null } },
        data: { not_emergency_at: null },
      });
    }
    await markHomeActionUndone(tx, userId, actionId, now);
    return { ok: true as const, item_key: row.item_key, message: 'Rule removed.' };
  });
}

export { loadNotEmergencyRules };

// ============================================================================
// home-watch (worker)
// ============================================================================

export const KUMA_CAP = 200;
export const CHECKS_CAP = 100;
export const WATCH_BODY_BYTES = 64 * 1024;
const CANDIDATE_ASK_CAP = 300;

const dateLike = z
  .union([z.string().min(1).max(40), z.number()])
  .transform((v, ctx) => {
    const d = typeof v === 'number' ? new Date(v < 1e11 ? v * 1000 : v) : new Date(v);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: 'custom', message: 'bad date' });
      return z.NEVER;
    }
    return d;
  });

export const watchBodySchema = z
  .object({
    kuma: z
      .array(
        z
          .object({
            monitor: z.string().max(255),
            domain: z.string().min(1).max(255),
            client_id: z.string().uuid().nullable().optional(),
            started: dateLike,
            escalated: z.boolean().optional(),
          })
          .strict()
      )
      .max(KUMA_CAP)
      .nullable()
      .default(null),
    checks: z
      .array(
        z
          .object({
            key: z.string().min(1).max(60),
            up: z.boolean(),
            summary: z.string().max(500).optional(),
            checked_at: dateLike,
          })
          .strict()
      )
      .max(CHECKS_CAP)
      .default([]),
    // What this machine script can do. Lines are handed out only to a request that lists "slack", scans only to one that lists "scan".
    caps: z.array(z.string().min(1).max(30)).max(10).optional(),
  })
  .strict();
export type WatchBody = z.infer<typeof watchBodySchema>;

type WatchSite = SiteHost;

/** Sites of active clients with a usable host (the only domains the machine may ever be asked to check). */
export async function loadWatchSites(db: HomeDb): Promise<WatchSite[]> {
  const rows = await db.site.findMany({
    where: { url: { not: null }, client: { is: { status: 'active' } } },
    select: { id: true, url: true, client_id: true, client: { select: { name: true } } },
    take: 2000,
  });
  const out: WatchSite[] = [];
  for (const r of rows) {
    const host = siteHostOf(r.url);
    if (host) out.push({ id: r.id, host, client_id: r.client_id, client_name: r.client?.name ?? null });
  }
  return out;
}

interface Candidate {
  site: WatchSite;
  ask_ids: string[];
}

/** Open urgent mail from the last few days that names a watched site, grouped by site. Noise sites never appear. */
async function loadCandidates(db: HomeDb, sites: readonly WatchSite[], now: Date): Promise<Candidate[]> {
  const asks = await db.emailAsk.findMany({
    where: { state: 'open', is_urgent: true, received_at: { gte: new Date(now.getTime() - MAIL_MAX_AGE_DAYS * DAY_MS) } },
    select: { id: true, subject: true, gist: true },
    orderBy: { received_at: 'desc' },
    take: CANDIDATE_ASK_CAP,
  });
  const by = new Map<string, Candidate>();
  for (const a of asks) {
    for (const s of matchSiteHosts(`${a.subject}\n${a.gist ?? ''}`, sites)) {
      const c = by.get(s.id) ?? { site: s, ask_ids: [] };
      c.ask_ids.push(a.id);
      by.set(s.id, c);
    }
  }
  return Array.from(by.values());
}

async function loadOpenIncidents(db: HomeDb, userId: string) {
  return db.homeSiteIncident.findMany({ where: { user_id: userId, closed_at: null }, orderBy: { started_at: 'asc' }, take: 500 });
}

/** Candidates whose current mails an earlier "answered" check already covered are not checked again. */
async function uncovered(db: HomeDb, userId: string, cands: Candidate[]): Promise<Candidate[]> {
  if (cands.length === 0) return [];
  const done = await db.homeSiteIncident.findMany({
    where: { user_id: userId, source: 'uptime_mail', close_reason: 'answered', site_id: { in: cands.map((c) => c.site.id) } },
    select: { site_id: true, ask_ids: true },
  });
  return cands.filter((c) => {
    const covered = new Set(done.filter((d) => d.site_id === c.site.id).flatMap((d) => d.ask_ids));
    return c.ask_ids.some((id) => !covered.has(id));
  });
}

export interface WatchGet {
  dry_run: true;
  skipped?: 'home_off';
  checks: Array<{ key: string; site_id: string; domain: string }>;
  open: Array<{
    key: string;
    site_id: string;
    domain: string;
    source: string;
    started_at: string;
    last_checked_at: string | null;
    last_check_up: boolean | null;
    ask_ids: string[];
  }>;
  /** Slice 6b: the Slack lines a real run would hand out now (empty when the switch is off). Writes nothing. */
  would_post: WireLine[];
  /** Slice 6c: the outside scans a real run would hand out now (empty when the switch is off). Writes nothing. */
  would_scan: Array<{ key: string; host: string }>;
}

/** What the machine should check now and what is open. Writes nothing. */
export async function watchPlan(db: PrismaClient, ownerId: string, now: Date): Promise<WatchGet> {
  const { ok, timezone } = await ownerOnHome(db, ownerId);
  if (!ok) return { dry_run: true, skipped: 'home_off', checks: [], open: [], would_post: [], would_scan: [] };
  const sites = await loadWatchSites(db);
  const open = await loadOpenIncidents(db, ownerId);
  const cands = await uncovered(db, ownerId, await loadCandidates(db, sites, now));
  const checks = new Map<string, { key: string; site_id: string; domain: string }>();
  for (const c of cands) checks.set(c.site.id, { key: siteItemKey(c.site.id), site_id: c.site.id, domain: c.site.host });
  // A mail incident that is still open keeps being checked until the site answers or its mail is handled.
  for (const i of open) {
    if (i.source === 'uptime_mail' && !checks.has(i.site_id)) checks.set(i.site_id, { key: siteItemKey(i.site_id), site_id: i.site_id, domain: i.domain });
  }
  const [slackOn, scanOn] = await Promise.all([loadEmergencySlack(db, ownerId), loadOutsideScan(db, ownerId)]);
  const watchItems = slackOn || scanOn ? await loadWatchItems(db, ownerId, now, timezone) : [];
  const would_post = slackOn ? await previewLines(db, ownerId, watchItems, now, timezone) : [];
  const would_scan = scanOn ? (await previewScans(db, ownerId, watchItems.map((i) => i.key), sites, now)).map((p) => ({ key: p.key, host: p.host })) : [];
  return {
    dry_run: true,
    would_post,
    would_scan,
    checks: Array.from(checks.values()),
    open: open.map((i) => ({
      key: siteItemKey(i.site_id),
      site_id: i.site_id,
      domain: i.domain,
      source: i.source,
      started_at: i.started_at.toISOString(),
      last_checked_at: i.last_checked_at?.toISOString() ?? null,
      last_check_up: i.last_check_up,
      ask_ids: i.ask_ids,
    })),
  };
}

export interface WatchPost {
  lines: WireLine[];
  /** Slice 6c: present only when the body carried caps ["scan"]. At most 2, each marked requested now; [] when the switch is off. */
  scans?: Array<WireScan>;
  skipped?: 'home_off';
  counts: { opened: number; updated: number; closed: number; ignored: number };
}

const typed = <T extends { source: string }>(r: T): T & { source: IncidentSource } => ({ ...r, source: r.source as IncidentSource });
const clampPast = (d: Date, now: Date): Date => (d.getTime() > now.getTime() ? now : d);

async function writeLine(tx: HomeDb, userId: string, action: string, siteKey: string, line: string, domain: string) {
  await appendHomeAction(tx, userId, { item_key: siteKey, action, source: 'keeper', before: null, after: { line, details: [domain] } });
}

/**
 * Apply one watch report for the owner: upsert and close site incidents, and write the "answers again" lines.
 * `kuma: null` (the watchdog's state could not be read) closes nothing. A check for a site Citadel did not ask about
 * is ignored.
 */
export async function applyWatch(db: PrismaClient, ownerId: string, body: WatchBody, now: Date): Promise<WatchPost> {
  const { ok, timezone } = await ownerOnHome(db, ownerId);
  if (!ok) return { lines: [], skipped: 'home_off', counts: { opened: 0, updated: 0, closed: 0, ignored: 0 } };
  const counts = { opened: 0, updated: 0, closed: 0, ignored: 0 };
  const sites = await loadWatchSites(db);
  const siteById = new Map(sites.map((s) => [s.id, s]));

  const wantsSlack = (body.caps ?? []).includes('slack');
  const wantsScan = (body.caps ?? []).includes('scan');
  const result = await db.$transaction(
    async (tx) => {
      // ---- Kuma ----
      if (body.kuma !== null) {
        const listed = new Set<string>();
        for (const k of body.kuma) {
          const host = normalizeHost(k.domain);
          const matches = sites.filter((s) => s.host === host);
          const site = matches.find((s) => k.client_id && s.client_id === k.client_id) ?? matches[0];
          if (!site) {
            counts.ignored += 1;
            continue;
          }
          listed.add(site.id);
          const open = await tx.homeSiteIncident.findFirst({ where: { user_id: ownerId, site_id: site.id, source: 'kuma', closed_at: null } });
          if (open) {
            await tx.homeSiteIncident.update({
              where: { id: open.id },
              data: { monitor: k.monitor || open.monitor, watchdog_escalated: open.watchdog_escalated || k.escalated === true, last_checked_at: now },
            });
            counts.updated += 1;
          } else {
            await tx.homeSiteIncident.create({
              data: {
                user_id: ownerId,
                site_id: site.id,
                domain: site.host,
                client_id: site.client_id,
                source: 'kuma',
                monitor: k.monitor || null,
                started_at: clampPast(k.started, now),
                last_checked_at: now,
                watchdog_escalated: k.escalated === true,
              },
            });
            counts.opened += 1;
          }
        }
        const openKuma = (await tx.homeSiteIncident.findMany({ where: { user_id: ownerId, source: 'kuma', closed_at: null } })).map(typed);
        const toClose = new Set(closeOnWatchdog(openKuma, listed));
        for (const i of openKuma) {
          if (!toClose.has(i.site_id)) continue;
          await tx.homeSiteIncident.update({ where: { id: i.id }, data: { closed_at: now, close_reason: 'watchdog_closed' } });
          counts.closed += 1;
          if (siteIncidentShown({ ...i, closed_at: null }, now)) {
            await writeLine(tx, ownerId, SITE_ACTION_CLEARED, siteItemKey(i.site_id), siteClearedLine(i.domain, downMinutes(i, now)), i.domain);
          }
        }
      }

      // ---- Bast's own checks of uptime-mail sites ----
      if (body.checks.length > 0) {
        const cands = new Map((await loadCandidates(tx, sites, now)).map((c) => [c.site.id, c]));
        const openMail = (await tx.homeSiteIncident.findMany({ where: { user_id: ownerId, source: 'uptime_mail', closed_at: null } })).map(typed);
        for (const c of body.checks) {
          const siteId = parseSiteItemKey(c.key);
          const site = siteId ? siteById.get(siteId) : undefined;
          const cand = siteId ? cands.get(siteId) : undefined;
          const open = openMail.find((i) => i.site_id === siteId);
          if (!siteId || !site || (!cand && !open)) {
            counts.ignored += 1;
            continue;
          }
          const checkedAt = clampPast(c.checked_at, now);
          const summary = (c.summary ?? '').slice(0, 500) || null;
          const askIds = Array.from(new Set([...(open?.ask_ids ?? []), ...(cand?.ask_ids ?? [])]));
          if (open) {
            const verdict = closeOnCheck(open, c.up);
            if (verdict.close) {
              const wasShown = open.last_check_up === false;
              await tx.homeSiteIncident.update({
                where: { id: open.id },
                data: { closed_at: now, close_reason: verdict.reason, last_checked_at: checkedAt, last_check_up: true, check_summary: summary, ask_ids: askIds },
              });
              counts.closed += 1;
              await writeLine(
                tx,
                ownerId,
                SITE_ACTION_CLEARED,
                siteItemKey(siteId),
                wasShown ? siteClearedLine(open.domain, downMinutes(open, checkedAt)) : siteAnswersAgainMailLine(open.domain, checkedAt, timezone),
                open.domain
              );
            } else {
              const handled = closeOnMailHandled(open, cand ? cand.ask_ids.length : 0);
              await tx.homeSiteIncident.update({
                where: { id: open.id },
                data: handled.close
                  ? { closed_at: now, close_reason: handled.reason, last_checked_at: checkedAt, last_check_up: c.up, check_summary: summary }
                  : { last_checked_at: checkedAt, last_check_up: c.up, check_summary: summary, ask_ids: askIds },
              });
              counts[handled.close ? 'closed' : 'updated'] += 1;
            }
          } else if (c.up) {
            // First check found the site up: keep a closed record so the mail stays out of Needs you now.
            await tx.homeSiteIncident.create({
              data: {
                user_id: ownerId,
                site_id: siteId,
                domain: site.host,
                client_id: site.client_id,
                source: 'uptime_mail',
                ask_ids: cand?.ask_ids ?? [],
                started_at: checkedAt,
                last_checked_at: checkedAt,
                last_check_up: true,
                check_summary: summary,
                closed_at: now,
                close_reason: 'answered',
              },
            });
            counts.closed += 1;
            await writeLine(tx, ownerId, SITE_ACTION_CLEARED, siteItemKey(siteId), siteAnswersAgainMailLine(site.host, checkedAt, timezone), site.host);
          } else {
            await tx.homeSiteIncident.create({
              data: {
                user_id: ownerId,
                site_id: siteId,
                domain: site.host,
                client_id: site.client_id,
                source: 'uptime_mail',
                ask_ids: cand?.ask_ids ?? [],
                started_at: checkedAt,
                last_checked_at: checkedAt,
                last_check_up: false,
                check_summary: summary,
              },
            });
            counts.opened += 1;
          }
        }
      }
      return { lines: [] as WireLine[], counts };
    },
    { timeout: 30_000 }
  );

  // Slice 6b: track what is in Needs you now (always); hand out lines only with the switch on and the "slack" cap.
  const items = await loadWatchItems(db, ownerId, now, timezone);
  const slackOn = wantsSlack && (await loadEmergencySlack(db, ownerId));
  const lines = await db.$transaction(
    async (tx) => {
      await trackWatch(tx, ownerId, items, now);
      return slackOn ? claimLines(tx, ownerId, items, now, timezone) : [];
    },
    { timeout: 30_000 }
  );
  if (!wantsScan) return { lines, counts: result.counts };
  // Slice 6c: scans only for a script that says it can run them, and only with the switch on.
  const scans = await db.$transaction(
    async (tx) => ((await loadOutsideScan(tx, ownerId)) ? claimScans(tx, ownerId, items.map((i) => i.key), sites, now) : []),
    { timeout: 30_000 }
  );
  return { lines, scans, counts: result.counts };
}

