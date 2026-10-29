/**
 * Designer Portal operator keys (Mike, 2026-10-29): the allowlist, the policy's stand-in for a signed-in session,
 * the channel binding between intent and confirm, and how an operator publish is recorded (approval source,
 * comment text). Pure; the route matrix is operator-matrix.test.ts and the real-DB path operator.integration.test.ts.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/services/notification-dispatcher', () => ({ dispatchNotification: vi.fn() }));

import { DESIGN_OPERATOR_PUBLISH_SCOPE, DESIGN_OPERATOR_SETUP_SCOPE, HUMAN_GRANTED_SCOPES, keyScopesSchema } from '@/lib/auth/key-scopes';
import { cleanApprovalSource } from '@/lib/portal/receipts';
import { DESIGN_OPERATOR_ROUTES, OPERATOR_SCOPE, firstName, operatorPhrase, operatorRouteAllowed } from '../operator';
import { actorViaOf, actsAsSignedIn, canPublish, canRequestPublish, canRollback, checkConfirmation, hashConfirmationToken, sameChannel } from '../publish-policy';
import { approvalSourceFor, publishCommentText } from '../publishes';

const ID = '3f2b8c1e-9d4a-4e6b-8a1f-0c2d3e4f5a6b';
const KEY = '6cd749cc-b4e1-490d-8df8-2a34f87c9e9e';
const MIKE = 'aaaaaaaa-1111-4111-8111-111111111111';

const opPublish = { userId: MIKE, role: 'admin' as const, via: 'api_key' as const, operator: 'publish' as const, apiKeyId: KEY };
const opSetup = { ...opPublish, operator: 'setup' as const };
const session = { userId: MIKE, role: 'admin' as const, via: 'session' as const };
const plainKey = { userId: MIKE, role: 'admin' as const, via: 'api_key' as const, apiKeyId: KEY };

describe('the allowlist (lib/design/operator.ts) is exactly the ruling', () => {
  it('setup: the design admin configuration routes, nothing else', () => {
    expect(DESIGN_OPERATOR_ROUTES.setup.map((r) => `${r.method} ${r.pattern}`).sort()).toEqual([
      'GET /api/design/admin/budgets',
      'GET /api/design/admin/clients/:id',
      'GET /api/design/admin/projects/:id',
      'GET /api/design/admin/publishes',
      'GET /api/design/admin/sessions',
      'GET /api/design/admin/settings',
      'GET /api/design/admin/sites',
      'PATCH /api/design/admin/budgets/:userId',
      'PATCH /api/design/admin/clients/:id',
      'PATCH /api/design/admin/projects/:id',
      'PATCH /api/design/admin/settings',
      'PATCH /api/design/admin/sites/:id',
      'PUT /api/design/admin/budgets/:userId',
    ]);
  });

  it('publish: intent, confirm, rollback and the three reads, nothing else', () => {
    expect(DESIGN_OPERATOR_ROUTES.publish.map((r) => `${r.method} ${r.pattern}`).sort()).toEqual([
      'GET /api/design/publishes/:id',
      'GET /api/design/sessions/:id',
      'GET /api/design/sessions/:id/feed',
      'POST /api/design/publishes/:id/confirm',
      'POST /api/design/publishes/:id/rollback',
      'POST /api/design/sessions/:id/publish',
    ]);
  });

  it('matches by method and exact segment count; the two lists never overlap', () => {
    expect(operatorRouteAllowed('publish', 'POST', `/api/design/sessions/${ID}/publish`)).toBe(true);
    expect(operatorRouteAllowed('publish', 'post', `/api/design/sessions/${ID}/publish`)).toBe(true);
    expect(operatorRouteAllowed('publish', 'POST', `/api/design/sessions/${ID}/request-publish`)).toBe(false);
    expect(operatorRouteAllowed('publish', 'POST', `/api/design/sessions/${ID}/messages`)).toBe(false);
    expect(operatorRouteAllowed('publish', 'GET', `/api/design/sessions/${ID}/assets/${ID}`)).toBe(false);
    expect(operatorRouteAllowed('publish', 'PATCH', `/api/design/sessions/${ID}`)).toBe(false);
    expect(operatorRouteAllowed('publish', 'GET', '/api/design/admin/settings')).toBe(false);
    expect(operatorRouteAllowed('setup', 'GET', '/api/design/admin/settings')).toBe(true);
    expect(operatorRouteAllowed('setup', 'POST', `/api/design/sessions/${ID}/publish`)).toBe(false);
    expect(operatorRouteAllowed('setup', 'DELETE', `/api/design/admin/sites/${ID}`)).toBe(false);
    expect(operatorRouteAllowed('setup', 'GET', '/api/design/worker/inbox')).toBe(false);
    const setup = new Set(DESIGN_OPERATOR_ROUTES.setup.map((r) => `${r.method} ${r.pattern}`));
    expect(DESIGN_OPERATOR_ROUTES.publish.filter((r) => setup.has(`${r.method} ${r.pattern}`))).toEqual([]);
  });

  it('the scope names', () => {
    expect(OPERATOR_SCOPE).toEqual({ setup: 'design:operator-setup', publish: 'design:operator-publish' });
    expect(HUMAN_GRANTED_SCOPES).toEqual(['decisions:admin', DESIGN_OPERATOR_SETUP_SCOPE, DESIGN_OPERATOR_PUBLISH_SCOPE]);
  });
});

describe('keyScopesSchema: never on a lane key', () => {
  it.each([DESIGN_OPERATOR_SETUP_SCOPE, DESIGN_OPERATOR_PUBLISH_SCOPE])('%s alone or with engine/decisions:admin is valid; beside any lane it is not', (scope) => {
    expect(keyScopesSchema.safeParse([scope]).success).toBe(true);
    expect(keyScopesSchema.safeParse([DESIGN_OPERATOR_SETUP_SCOPE, DESIGN_OPERATOR_PUBLISH_SCOPE, 'decisions:admin']).success).toBe(true);
    expect(keyScopesSchema.safeParse(['lane:bast', scope]).success).toBe(false);
    expect(keyScopesSchema.safeParse(['lane:design-worker', 'scope-mode:enforce', scope]).success).toBe(false);
    expect(keyScopesSchema.safeParse(['design:operator-anything']).success).toBe(false);
  });
});

describe('actsAsSignedIn: the only stand-in for a session on publish, confirm and rollback', () => {
  it('a session, or an admin operator-publish key with a key id', () => {
    expect(actsAsSignedIn(session)).toBe(true);
    expect(actsAsSignedIn(opPublish)).toBe(true);
  });
  it('never a plain key, a setup key, a non-admin operator, or an operator without a key id', () => {
    expect(actsAsSignedIn(plainKey)).toBe(false);
    expect(actsAsSignedIn(opSetup)).toBe(false);
    for (const role of ['pm', 'designer', 'tech'] as const) expect(actsAsSignedIn({ ...opPublish, role })).toBe(false);
    expect(actsAsSignedIn({ ...opPublish, apiKeyId: undefined })).toBe(false);
    expect(actsAsSignedIn({ ...opPublish, apiKeyId: '' })).toBe(false);
    expect(actsAsSignedIn({ ...opPublish, via: undefined })).toBe(false);
  });
  it('records the channel', () => {
    expect(actorViaOf(session)).toBe('session');
    expect(actorViaOf(opPublish)).toBe('operator_key');
    expect(actorViaOf(opSetup)).toBe('session'); // never written: a setup actor cannot reach a publish row
  });
});

describe('the policy with an operator actor', () => {
  const sess = { id: ID, designer_id: 'd', status: 'awaiting_input', head_sha: 'abc1234', designer_on_project: false, publish_precheck: { head_sha: 'abc1234', gates_ok: true } };
  const site = { id: 's', design_portal_enabled: true, designer_publish: false };
  const off = { designer_publish_mode: 'off' };

  it('publishes as an admin (any mode); a red gate still refuses; a setup key and a plain key are session_required', () => {
    expect(canPublish(opPublish, sess, site, off, 'production')).toMatchObject({ ok: true, actor_role: 'admin' });
    expect(canPublish(opPublish, { ...sess, publish_precheck: { head_sha: 'abc1234', gates_ok: false } }, site, off, 'production')).toMatchObject({ ok: false, code: 'gates_not_green' });
    expect(canPublish(opSetup, sess, site, off, 'production')).toMatchObject({ ok: false, code: 'session_required' });
    expect(canPublish(plainKey, sess, site, off, 'production')).toMatchObject({ ok: false, code: 'session_required' });
  });

  it('request-publish stays session-only', () => {
    expect(canRequestPublish(opPublish, sess, site, off, 'production')).toMatchObject({ ok: false, code: 'session_required' });
  });

  it('rollback as an admin; setup and plain keys session_required', () => {
    const pub = { id: ID, kind: 'publish', status: 'published', actor_id: 'someone', result_sha: 'r1' };
    expect(canRollback(opPublish, pub, { id: ID, result_sha: 'r1' })).toEqual({ ok: true });
    expect(canRollback(opSetup, pub, { id: ID, result_sha: 'r1' })).toMatchObject({ code: 'session_required' });
    expect(canRollback(plainKey, pub, { id: ID, result_sha: 'r1' })).toMatchObject({ code: 'session_required' });
  });
});

describe('sameChannel: a confirm comes through the channel its intent did', () => {
  const token = 'tok';
  const base = {
    actor_id: MIKE, status: 'awaiting_confirmation', confirmation_token_hash: hashConfirmationToken(token),
    confirmation_expires_at: new Date(Date.now() + 60_000), head_sha: 'h', main_role: 'production', confirmation_shown: { main_branch: 'main' },
  };
  const current = { head_sha: 'h', gate_status: 'green' as const, main_role: 'production' };
  const check = (actor: Parameters<typeof checkConfirmation>[0]['actor'], publish: Record<string, unknown>, typed = 'main') =>
    checkConfirmation({ actor, publish: { ...base, ...publish } as never, token, typed, current });

  it('session intent: the session confirms; the same user\'s operator key is 404', () => {
    expect(check(session, { actor_via: 'session' })).toEqual({ ok: true });
    expect(check(session, {})).toEqual({ ok: true }); // rows from before the column
    expect(check(opPublish, { actor_via: 'session' })).toMatchObject({ code: 'not_found' });
  });
  it('operator intent: that key confirms; the session and another key are 404', () => {
    expect(check(opPublish, { actor_via: 'operator_key', actor_api_key_id: KEY })).toEqual({ ok: true });
    expect(check(session, { actor_via: 'operator_key', actor_api_key_id: KEY })).toMatchObject({ code: 'not_found' });
    expect(check({ ...opPublish, apiKeyId: ID }, { actor_via: 'operator_key', actor_api_key_id: KEY })).toMatchObject({ code: 'not_found' });
    expect(check(opPublish, { actor_via: 'operator_key', actor_api_key_id: null })).toMatchObject({ code: 'not_found' });
  });
  it('the typed branch still has to match for an operator (409 typed_mismatch)', () => {
    expect(check(opPublish, { actor_via: 'operator_key', actor_api_key_id: KEY }, 'master')).toMatchObject({ status: 409, code: 'typed_mismatch' });
  });
  it('a setup key cannot confirm (403 session_required)', () => {
    expect(check(opSetup, { actor_via: 'operator_key', actor_api_key_id: KEY })).toMatchObject({ status: 403, code: 'session_required' });
  });
  it('the pure helper', () => {
    expect(sameChannel(opPublish, { actor_via: 'operator_key', actor_api_key_id: KEY })).toBe(true);
    expect(sameChannel(session, { actor_via: null })).toBe(true);
    expect(sameChannel(opPublish, { actor_via: null })).toBe(false);
  });
});

describe('how an operator publish is recorded', () => {
  it('approval sources survive cleanApprovalSource; the session ones are unchanged', () => {
    const op = approvalSourceFor({ id: ID, kind: 'publish', actor_role: 'admin', actor_via: 'operator_key' });
    const opRb = approvalSourceFor({ id: ID, kind: 'rollback', actor_role: 'admin', actor_via: 'operator_key' });
    expect(op).toBe(`design_operator_publish:${ID}`);
    expect(opRb).toBe(`design_operator_rollback:${ID}`);
    expect(cleanApprovalSource(op)).toBe(op);
    expect(cleanApprovalSource(opRb)).toBe(opRb);
    expect(cleanApprovalSource(`design_operator_publish:${ID} x`)).toBe('api');
    expect(cleanApprovalSource('design_operator_publish:not-a-uuid')).toBe('api');
    expect(approvalSourceFor({ id: ID, kind: 'publish', actor_role: 'admin', actor_via: 'session' })).toBe(`design_admin_publish:${ID}`);
  });

  it('the task comment says Bast published on Mike\'s instruction, and still carries the evidence', () => {
    const p = {
      id: ID, kind: 'publish' as const, actor_role: 'admin', actor_via: 'operator_key', main_role: 'production', head_sha: 'a'.repeat(40),
      from_main_sha: 'c'.repeat(40), result_sha: 'd'.repeat(40), deploy_url: 'https://abc.vcdp.pages.dev', alias_url: 'https://vcdp.org',
      gates: [{ name: 'a11y', ok: true }], confirmation_shown: { target_words: 'the LIVE production site at vcdp.org' }, confirmation_typed: 'main',
      confirmed_at: new Date('2026-10-29T12:00:00Z'), cost_usd: 1.5 as never, rolls_back_id: null,
    };
    const t = publishCommentText({ publish: p, actorName: 'Mike Dion', siteName: 'VCDP' });
    expect(t).toContain("published by Bast on Mike's instruction");
    expect(t).toContain('operator key; actor Mike Dion, admin');
    expect(t).toContain('typed "main"');
    expect(t).toContain('Gates: a11y ok');
    expect(t).not.toContain('by Mike Dion (admin).');
    const rb = publishCommentText({ publish: { ...p, kind: 'rollback' as never, rolls_back_id: ID }, actorName: 'Mike Dion', siteName: 'VCDP' });
    expect(rb).toContain("rolled back by Bast on Mike's instruction");
    const plain = publishCommentText({ publish: { ...p, actor_via: 'session' }, actorName: 'Mike Dion', siteName: 'VCDP' });
    expect(plain).toContain('by Mike Dion (admin).');
    expect(plain).not.toContain('Bast');
  });

  it('names', () => {
    expect(firstName('Mike Dion')).toBe('Mike');
    expect(firstName('  ')).toBe('the key owner');
    expect(operatorPhrase('Mike')).toBe("Bast on Mike's instruction");
  });
});
