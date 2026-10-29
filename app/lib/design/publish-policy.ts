/**
 * Designer Portal: who may publish and roll back, and what the confirmation shows (design 5 D5, 7.1, T11,
 * T21, T23 to T25). Pure functions; the routes (W2.4) load the rows and call these.
 *
 * Mike's rulings (2026-10-28) that this module encodes:
 * - Designers may change anything on the site; there is NO copy or code policy here, anywhere.
 * - `DesignPortalSettings.designer_publish_mode`:
 *     per_site (default)  designer may publish when Site.designer_publish (defaults true)
 *     pre_launch_only     Site.designer_publish AND main_role is client_preview
 *     off                 never (the button becomes Request publish)
 * - An admin may always publish (any mode, any flag), but never through an ordinary API key: both publish steps
 *   and rollback need a signed-in session (`via === 'session'`). The ONE exception (Mike, 2026-10-29) is an admin's
 *   design:operator-publish key that route-kit's authActor admitted (`actsAsSignedIn`): it is an admin publisher
 *   on exactly the same path (gates, two-step confirmation, box re-check). A publish started by a session is
 *   confirmed only by a session, one started by an operator key only by that same key (`sameChannel`).
 * - `main_role` decides the confirmation WORDING, never who may publish (except under pre_launch_only).
 *   Unknown = production (the stronger wording).
 * - A publish is refused only for: red (or unknown) gates on the head, a stale head, a running publish, or a
 *   missing/invalid confirmation; plus the actor rule above and the session being over.
 * - A designer's rights are CURRENT (W8.2 H2, H4): she acts only on her own session while she is on its
 *   project now (`designer_on_project`, computed by the caller through access.ts; absent counts as false),
 *   and only while her DATABASE role is designer. Rollback follows the designer-publish switch too: where an
 *   admin turned designer publish off, the admin controls live deploys for that site, rollback included
 *   (Mike's ruling, 2026-10-29); an admin may always roll back.
 */
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { displayHost, toUsd, type DesignActor } from './helpers';

export const DESIGN_PUBLISH_MODES = ['per_site', 'pre_launch_only', 'off'] as const;
export type DesignPublishMode = (typeof DESIGN_PUBLISH_MODES)[number];
export const MAIN_ROLES = ['client_preview', 'production'] as const;
export type MainRole = (typeof MAIN_ROLES)[number];

/** A stored mode outside the three is treated as `off` (fail closed); the admin route only writes the three. */
export function normalizePublishMode(mode: unknown): DesignPublishMode {
  return (DESIGN_PUBLISH_MODES as readonly unknown[]).includes(mode) ? (mode as DesignPublishMode) : 'off';
}

/** Only an explicit `client_preview` is client_preview; anything else (missing, typo, null) is production. */
export function normalizeMainRole(role: unknown): MainRole {
  return role === 'client_preview' ? 'client_preview' : 'production';
}

/** The box-reported role for a site, from DesignWorkerState.site_main_roles ({"<site id>": role}). */
export function mainRoleFor(siteId: string, siteMainRoles: unknown): MainRole {
  if (siteMainRoles && typeof siteMainRoles === 'object' && !Array.isArray(siteMainRoles)) {
    return normalizeMainRole((siteMainRoles as Record<string, unknown>)[siteId]);
  }
  return 'production';
}

/** The D5 table, exactly. Admins never go through this (they may always publish). */
export function designerMayPublish(
  site: { designer_publish: boolean },
  settings: { designer_publish_mode: string },
  mainRole: unknown,
): boolean {
  switch (normalizePublishMode(settings.designer_publish_mode)) {
    case 'per_site':
      return site.designer_publish === true;
    case 'pre_launch_only':
      return site.designer_publish === true && normalizeMainRole(mainRole) === 'client_preview';
    case 'off':
      return false;
  }
}

// ---------------------------------------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------------------------------------

export type PolicyCode =
  | 'session_required' // API key of any kind (admin keys included): 403
  | 'forbidden' // pm, or a role that can see the row but not act: 403
  | 'not_found' // a session or publish the caller may not see: 404
  | 'designer_publish_off' // an admin override switched designer publish off here: 403 (UI: Request publish)
  | 'publish_allowed' // request-publish where the designer may publish herself: 409
  | 'site_not_enabled' // design_portal_enabled is false or the site is deleted: 409
  | 'session_closed' // closed or abandoned: 409
  | 'session_stopped' // halted by a pause, the kill switch or a worker error: 409
  | 'publish_in_progress' // a publish or rollback is queued or running for the session or the site: 409
  | 'stale_head' // no head yet, a turn is running, or the head moved since the actor looked: 409
  | 'gates_not_green' // the precheck for the head is red or missing: 409
  | 'confirmation_missing' // token or typed text absent: 400
  | 'confirmation_expired' // 409
  | 'confirmation_used' // the intent is no longer awaiting confirmation: 409
  | 'confirmation_invalid' // wrong token: 409
  | 'typed_mismatch' // typed text is not the shown main branch: 409
  | 'main_role_changed' // 409
  | 'not_rollbackable' // a rollback row: 409
  | 'not_published' // the publish did not succeed, or was already rolled back: 409
  | 'not_latest'; // a later publish exists: 409 (restore it in a session and publish instead)

const STATUS_FOR: Record<PolicyCode, 400 | 403 | 404 | 409> = {
  session_required: 403,
  forbidden: 403,
  not_found: 404,
  designer_publish_off: 403,
  publish_allowed: 409,
  site_not_enabled: 409,
  session_closed: 409,
  session_stopped: 409,
  publish_in_progress: 409,
  stale_head: 409,
  gates_not_green: 409,
  confirmation_missing: 400,
  confirmation_expired: 409,
  confirmation_used: 409,
  confirmation_invalid: 409,
  typed_mismatch: 409,
  main_role_changed: 409,
  not_rollbackable: 409,
  not_published: 409,
  not_latest: 409,
};

export interface PolicyRefusal {
  ok: false;
  status: 400 | 403 | 404 | 409;
  code: PolicyCode;
  message: string;
}

export function refuse(code: PolicyCode, message: string): PolicyRefusal {
  return { ok: false, status: STATUS_FOR[code], code, message };
}

export type PublishActorRole = 'admin' | 'designer';

/** The actor fields the policy reads. `operator` / `apiKeyId` are only ever set by route-kit's authActor. */
export type PolicyActor = Pick<DesignActor, 'userId' | 'role' | 'via' | 'operator' | 'apiKeyId'>;

/**
 * Stands in for "a signed-in session" on publish, confirm and rollback: a session, or an ADMIN whose
 * design:operator-publish key authActor admitted on this route. A setup-scope key, a plain key, a lane key, or an
 * operator key whose user is not an admin never passes (request-publish keeps the plain session test).
 */
export function actsAsSignedIn(actor: Pick<DesignActor, 'via' | 'operator' | 'apiKeyId'> & { role?: DesignActor['role'] }): boolean {
  if (actor.via === 'session') return true;
  return actor.via === 'api_key' && actor.operator === 'publish' && actor.role === 'admin' && typeof actor.apiKeyId === 'string' && actor.apiKeyId.length > 0;
}

/** How a publish row records the channel its actor used (DesignPublish.actor_via). */
export function actorViaOf(actor: Pick<DesignActor, 'via' | 'operator'>): 'session' | 'operator_key' {
  return actor.via === 'api_key' && actor.operator === 'publish' ? 'operator_key' : 'session';
}

export interface PolicySession {
  id: string;
  designer_id: string;
  status: string;
  head_sha: string | null;
  publish_precheck: unknown;
  /** The session's designer is on the session's project right now (W8.2 H2). Only read for a designer actor. */
  designer_on_project: boolean;
}

export interface PolicySite {
  id: string;
  design_portal_enabled: boolean;
  designer_publish: boolean;
  is_deleted?: boolean;
}

export interface PolicySettings {
  designer_publish_mode: string;
}

/** Who may press Publish on this session, before any state check. */
export function publishActorRule(
  actor: PolicyActor,
  session: Pick<PolicySession, 'designer_id' | 'designer_on_project'>,
  site: Pick<PolicySite, 'designer_publish'>,
  settings: PolicySettings,
  mainRole: unknown,
): { ok: true; actor_role: PublishActorRole } | PolicyRefusal {
  if (!actsAsSignedIn(actor)) return refuse('session_required', 'Publishing needs a signed-in session');
  if (actor.role === 'admin') return { ok: true, actor_role: 'admin' };
  if (actor.role === 'designer') {
    if (session.designer_id !== actor.userId || session.designer_on_project !== true) return refuse('not_found', 'Session not found');
    if (!designerMayPublish(site, settings, mainRole)) {
      return refuse('designer_publish_off', 'Designer publish is switched off for this site; request a publish instead');
    }
    return { ok: true, actor_role: 'designer' };
  }
  if (actor.role === 'pm') return refuse('forbidden', 'A pm cannot publish');
  return refuse('not_found', 'Session not found');
}

export type GateStatus = 'green' | 'red' | 'unknown';

export interface PrecheckGate {
  name: string;
  ok: boolean;
  summary?: string;
}

export interface Precheck {
  head_sha: string | null;
  gates_ok: boolean | null;
  gates: PrecheckGate[];
  files_changed: string[];
  pages_affected: string[];
}

function stringList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** Read DesignSession.publish_precheck ({head_sha, gates_ok, gates?, files_changed?, pages_affected?}). */
export function parsePrecheck(raw: unknown): Precheck | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const gates = Array.isArray(r.gates)
    ? r.gates
        .filter((g): g is Record<string, unknown> => !!g && typeof g === 'object' && typeof (g as Record<string, unknown>).name === 'string')
        .map((g) => ({ name: g.name as string, ok: g.ok === true, ...(typeof g.summary === 'string' ? { summary: g.summary } : {}) }))
    : [];
  return {
    head_sha: typeof r.head_sha === 'string' ? r.head_sha : null,
    gates_ok: typeof r.gates_ok === 'boolean' ? r.gates_ok : null,
    gates,
    files_changed: stringList(r.files_changed),
    pages_affected: stringList(r.pages_affected),
  };
}

/** Green only when the precheck is for this exact head and says gates_ok. A precheck for another head is unknown. */
export function gateStatus(precheck: unknown, headSha: string | null): GateStatus {
  const p = parsePrecheck(precheck);
  if (!p || !headSha || p.head_sha !== headSha || p.gates_ok === null) return 'unknown';
  return p.gates_ok ? 'green' : 'red';
}

/** Session statuses from which a publish intent may start. `paused_budget` is allowed: publishing spends no model money. */
export const PUBLISHABLE_SESSION_STATUSES = ['awaiting_input', 'paused_budget'] as const;

export type PublishDecision =
  | { ok: true; actor_role: PublishActorRole; main_role: MainRole; publish_mode: DesignPublishMode; site_designer_publish: boolean }
  | PolicyRefusal;

/**
 * Step 1 (intent) and the re-check at step 2: the actor rule, then the state the D5 table allows.
 * `ctx.head_sha` is the head the actor saw (the request body); `ctx.publishRunning` is whether a publish or
 * rollback is queued or running for the site.
 */
export function canPublish(
  actor: PolicyActor,
  session: PolicySession,
  site: PolicySite,
  settings: PolicySettings,
  mainRole: unknown,
  ctx: { head_sha?: string | null; publishRunning?: boolean } = {},
): PublishDecision {
  const who = publishActorRule(actor, session, site, settings, mainRole);
  if (!who.ok) return who;
  if (!site.design_portal_enabled || site.is_deleted) return refuse('site_not_enabled', 'The design portal is not enabled for this site');

  switch (session.status) {
    case 'closed':
    case 'abandoned':
      return refuse('session_closed', 'This session is closed');
    case 'publishing':
      return refuse('publish_in_progress', 'A publish is already running for this session');
    case 'pending':
    case 'active':
      return refuse('stale_head', 'The worker is still working; publish when the turn ends');
    case 'stopped':
      return refuse('session_stopped', 'The session is stopped; resume it before publishing');
  }
  if (!(PUBLISHABLE_SESSION_STATUSES as readonly string[]).includes(session.status)) {
    return refuse('stale_head', 'The session is not ready to publish');
  }
  if (ctx.publishRunning) return refuse('publish_in_progress', 'Another publish is queued or running for this site');
  if (!session.head_sha) return refuse('stale_head', 'There is nothing to publish yet');
  if (ctx.head_sha !== undefined && ctx.head_sha !== session.head_sha) {
    return refuse('stale_head', 'The design branch moved since you looked; review again');
  }
  const gates = gateStatus(session.publish_precheck, session.head_sha);
  if (gates !== 'green') {
    return refuse('gates_not_green', gates === 'red' ? 'A gate is red on this version' : 'The gates have not run green on this version yet');
  }
  return {
    ok: true,
    actor_role: who.actor_role,
    main_role: normalizeMainRole(mainRole),
    publish_mode: normalizePublishMode(settings.designer_publish_mode),
    site_designer_publish: site.designer_publish,
  };
}

/**
 * POST .../request-publish: only where an admin override stops the designer publishing on this site (else
 * 409 publish_allowed: publish it yourself). The session's designer or an admin; pm 403; others 404.
 */
export function canRequestPublish(
  actor: Pick<DesignActor, 'userId' | 'role' | 'via'>,
  session: Pick<PolicySession, 'designer_id' | 'status' | 'designer_on_project'>,
  site: PolicySite,
  settings: PolicySettings,
  mainRole: unknown,
): { ok: true } | PolicyRefusal {
  if (actor.via !== 'session') return refuse('session_required', 'Requesting a publish needs a signed-in session');
  if (actor.role === 'pm') return refuse('forbidden', 'A pm cannot request a publish');
  if (actor.role !== 'admin' && !(actor.role === 'designer' && session.designer_id === actor.userId && session.designer_on_project === true)) {
    return refuse('not_found', 'Session not found');
  }
  if (!site.design_portal_enabled || site.is_deleted) return refuse('site_not_enabled', 'The design portal is not enabled for this site');
  if (designerMayPublish(site, settings, mainRole)) return refuse('publish_allowed', 'Designer publish is on for this site: publish it yourself');
  if (session.status === 'closed' || session.status === 'abandoned') return refuse('session_closed', 'This session is closed');
  if (session.status === 'publishing') return refuse('publish_in_progress', 'A publish is already running for this session');
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------------------
// The confirmation (D5 step 1 builds it, step 2 checks it)
// ---------------------------------------------------------------------------------------------------------

export interface ConfirmationShown {
  /** Short label for the target: "Live production site" or "Client preview". */
  target_label: string;
  /** The target in words, as the dialog states it. */
  target_words: string;
  heading: string;
  button_label: string;
  tone: MainRole;
  live_url: string | null;
  main_role: MainRole;
  /** What the actor must type at step 2. */
  main_branch: string;
  type_to_confirm: string;
  head_sha: string | null;
  diff_summary: { files_changed: number; insertions: number; deletions: number };
  files_changed: string[];
  pages_affected: string[];
  gates: { status: GateStatus; entries: PrecheckGate[] };
  cost_usd: number;
}

export interface ConfirmationInput {
  site: { name: string; url: string | null; prod_branch?: string | null; repo_branch?: string | null };
  mainRole: unknown;
  /** Where `main` deploys (the main alias, or the production host). Falls back to Site.url on production only. */
  liveUrl?: string | null;
  /** The site's main branch as the box knows it; falls back to prod_branch, repo_branch, then "main". */
  mainBranch?: string | null;
  session: { head_sha: string | null; cost_usd: number | string | { toString(): string } | null; diff_summary: unknown; publish_precheck: unknown };
  /** Changes included since the previous publish (their pages and files fill gaps in the precheck). */
  changes?: ReadonlyArray<{ pages?: readonly string[]; files?: readonly string[] }>;
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function uniqSorted(list: Iterable<string>): string[] {
  return [...new Set(list)].filter((s) => s.length > 0).sort();
}

export function confirmationShown(input: ConfirmationInput): ConfirmationShown {
  const mainRole = normalizeMainRole(input.mainRole);
  const liveUrl = input.liveUrl?.trim() || (mainRole === 'production' ? input.site.url?.trim() || null : null);
  const host = displayHost(liveUrl);
  const mainBranch = input.mainBranch?.trim() || input.site.prod_branch?.trim() || input.site.repo_branch?.trim() || 'main';

  const production = mainRole === 'production';
  const where = host ? `at ${host}` : `for ${input.site.name}`;
  const target_words = production ? `the LIVE production site ${where}` : `the client preview ${where}`;
  const heading = production
    ? host ? `Publish to the live site ${host}` : `Publish to the live site for ${input.site.name}`
    : host ? `Publish to the client preview (${host})` : `Publish to the client preview for ${input.site.name}`;

  const ds = input.session.diff_summary && typeof input.session.diff_summary === 'object' ? (input.session.diff_summary as Record<string, unknown>) : {};
  const diffFiles = Array.isArray(ds.files)
    ? ds.files.map((f) => (f && typeof f === 'object' ? (f as Record<string, unknown>).path : null)).filter((p): p is string => typeof p === 'string')
    : [];
  const precheck = parsePrecheck(input.session.publish_precheck);
  const precheckForHead = precheck && precheck.head_sha === input.session.head_sha ? precheck : null;
  const changes = input.changes ?? [];

  const files_changed = uniqSorted(
    diffFiles.length > 0 ? diffFiles : precheckForHead?.files_changed.length ? precheckForHead.files_changed : changes.flatMap((c) => c.files ?? []),
  );
  const pages_affected = uniqSorted(precheckForHead?.pages_affected.length ? precheckForHead.pages_affected : changes.flatMap((c) => c.pages ?? []));

  return {
    target_label: production ? 'Live production site' : 'Client preview',
    target_words,
    heading,
    button_label: production ? 'Publish to the live site' : 'Publish to the client preview',
    tone: mainRole,
    live_url: liveUrl,
    main_role: mainRole,
    main_branch: mainBranch,
    type_to_confirm: `Type ${mainBranch} to confirm`,
    head_sha: input.session.head_sha,
    diff_summary: {
      files_changed: typeof ds.files_changed === 'number' ? ds.files_changed : files_changed.length,
      insertions: num(ds.insertions),
      deletions: num(ds.deletions),
    },
    files_changed,
    pages_affected,
    gates: { status: gateStatus(input.session.publish_precheck, input.session.head_sha), entries: precheckForHead?.gates ?? [] },
    cost_usd: toUsd(input.session.cost_usd),
  };
}

/** 32 random bytes, url-safe. Only its sha256 is stored (D5). */
export function newConfirmationToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashConfirmationToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}

export interface ConfirmCheckInput {
  /** `role` is only read for an operator key (it must be an admin's); a session caller may omit it. */
  actor: Pick<DesignActor, 'userId' | 'via' | 'operator' | 'apiKeyId'> & { role?: DesignActor['role'] };
  publish: {
    actor_id: string;
    /** 'session' | 'operator_key' (absent on rows from before the column: session). */
    actor_via?: string | null;
    actor_api_key_id?: string | null;
    status: string;
    confirmation_token_hash: string | null;
    confirmation_expires_at: Date | null;
    head_sha: string | null;
    main_role: string;
    confirmation_shown: unknown;
  };
  token: string | null | undefined;
  typed: string | null | undefined;
  /** The state now: the session head, the gate status for it, and the box-reported main_role. */
  current: { head_sha: string | null; gate_status: GateStatus; main_role: unknown };
  now?: Date;
}

/**
 * The confirm must come through the channel the intent did: a session intent by a session, an operator intent by
 * the very key that created it. Mike's browser cannot finish Bast's intent and Bast's key cannot finish Mike's.
 */
export function sameChannel(
  actor: Pick<DesignActor, 'via' | 'operator' | 'apiKeyId'>,
  publish: { actor_via?: string | null; actor_api_key_id?: string | null },
): boolean {
  const rowVia = publish.actor_via === 'operator_key' ? 'operator_key' : 'session';
  if (actorViaOf(actor) !== rowVia) return false;
  return rowVia === 'session' || (!!publish.actor_api_key_id && publish.actor_api_key_id === actor.apiKeyId);
}

/**
 * Step 2 (confirm), D5 and T25: same signed-in actor (else 404), token and typed text present (else 400),
 * then 409 for a used, expired or wrong token, typed text that is not the shown main branch, or a head,
 * gate status or main_role that changed since step 1.
 */
export function checkConfirmation(input: ConfirmCheckInput): { ok: true } | PolicyRefusal {
  const { actor, publish } = input;
  if (!actsAsSignedIn(actor)) return refuse('session_required', 'Confirming a publish needs a signed-in session');
  if (publish.actor_id !== actor.userId || !sameChannel(actor, publish)) return refuse('not_found', 'Publish not found');
  const token = input.token?.trim() ?? '';
  const typed = input.typed?.trim() ?? '';
  if (!token || !typed) return refuse('confirmation_missing', 'Both the confirmation token and the typed branch name are required');
  if (publish.status !== 'awaiting_confirmation') return refuse('confirmation_used', 'This confirmation was already used or superseded');
  const now = input.now ?? new Date();
  if (!publish.confirmation_expires_at || publish.confirmation_expires_at <= now) {
    return refuse('confirmation_expired', 'The confirmation expired; review the publish again');
  }
  if (!publish.confirmation_token_hash || !sameHash(hashConfirmationToken(token), publish.confirmation_token_hash)) {
    return refuse('confirmation_invalid', 'The confirmation token does not match this publish');
  }
  const shown = publish.confirmation_shown && typeof publish.confirmation_shown === 'object' ? (publish.confirmation_shown as Record<string, unknown>) : {};
  const mainBranch = typeof shown.main_branch === 'string' ? shown.main_branch : null;
  if (!mainBranch || typed !== mainBranch) return refuse('typed_mismatch', 'Type the main branch name exactly as shown');
  if (input.current.head_sha !== publish.head_sha) return refuse('stale_head', 'The design branch moved since the review; review again');
  if (input.current.gate_status !== 'green') return refuse('gates_not_green', 'The gates are no longer green on this version');
  if (normalizeMainRole(input.current.main_role) !== normalizeMainRole(publish.main_role)) {
    return refuse('main_role_changed', 'Where this site publishes changed since the review; review again');
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------------------
// Rollback
// ---------------------------------------------------------------------------------------------------------

export interface RollbackPublish {
  id: string;
  kind: string;
  status: string;
  actor_id: string;
  result_sha: string | null;
}

/** What the "her publish" rollback path needs to know about a designer actor right now (W8.2 H2, H4, N4). */
export interface DesignerRollbackStanding {
  /** She still owns the publish's session and is on its project (access.ts currentSessionAccess). */
  has_session_access: boolean;
  /** designerMayPublish() for the site now: the designer-publish switch and mode. */
  may_publish: boolean;
}

/**
 * D5 and T23: admin, or that publish's actor while she is a designer with current access to the session
 * (pm 403, anyone else 404, including a publisher demoted to tech or removed from the project); a designer
 * also needs designer publish on for the site (403 designer_publish_off; Mike's ruling: switching designer
 * publish off hands live deploys, rollback included, to the admin). Signed-in session only; only a
 * `published` publish of kind `publish` that is the site's latest successful publish (`latest`, the newest
 * `published` row of either kind for the site), with the same result_sha. Older ones: 409 not_latest.
 * `ctx.designer` absent = no access (fail closed).
 */
export function canRollback(
  actor: PolicyActor,
  publish: RollbackPublish,
  latest: { id: string; result_sha: string | null } | null,
  ctx: { publishRunning?: boolean; designer?: DesignerRollbackStanding } = {},
): { ok: true } | PolicyRefusal {
  if (!actsAsSignedIn(actor)) return refuse('session_required', 'Rolling back needs a signed-in session');
  if (actor.role !== 'admin') {
    const herPublish = actor.role === 'designer' && publish.actor_id === actor.userId && ctx.designer?.has_session_access === true;
    if (!herPublish) return actor.role === 'pm' ? refuse('forbidden', 'A pm cannot roll back') : refuse('not_found', 'Publish not found');
    if (ctx.designer?.may_publish !== true) {
      return refuse('designer_publish_off', 'Designer publish is switched off for this site, so an admin rolls it back');
    }
  }
  if (publish.kind !== 'publish') return refuse('not_rollbackable', 'A rollback cannot itself be rolled back; restore a version and publish it');
  if (publish.status !== 'published') return refuse('not_published', 'Only a successful publish can be rolled back');
  if (!latest || latest.id !== publish.id || !publish.result_sha || latest.result_sha !== publish.result_sha) {
    return refuse('not_latest', 'A later publish exists; restore this version in a session and publish it instead');
  }
  if (ctx.publishRunning) return refuse('publish_in_progress', 'Another publish is queued or running for this site');
  return { ok: true };
}

/** Prisma pieces for `latest` (W2.4): the newest successful publish or rollback of a site. */
export function latestPublishedQuery(siteId: string) {
  return {
    where: { site_id: siteId, status: 'published' as const },
    orderBy: [{ finished_at: { sort: 'desc' as const, nulls: 'last' as const } }, { created_at: 'desc' as const }],
    select: { id: true, result_sha: true },
  };
}
