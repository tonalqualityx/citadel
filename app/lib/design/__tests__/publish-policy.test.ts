import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import type { UserRole } from '@prisma/client';
import { designActorFrom, type DesignActor } from '../helpers';
import {
  canPublish,
  canRequestPublish,
  canRollback,
  checkConfirmation,
  confirmationShown,
  designerMayPublish,
  gateStatus,
  hashConfirmationToken,
  latestPublishedQuery,
  mainRoleFor,
  newConfirmationToken,
  normalizeMainRole,
  normalizePublishMode,
  type ConfirmCheckInput,
  type PolicySession,
  type PolicySite,
} from '../publish-policy';

const DESIGNER = 'd0000000-0000-4000-8000-000000000001';
const OTHER_DESIGNER = 'd0000000-0000-4000-8000-000000000002';
const ADMIN = 'a0000000-0000-4000-8000-000000000001';
const PM = 'p0000000-0000-4000-8000-000000000001';
const TECH = 't0000000-0000-4000-8000-000000000001';
const HEAD = 'abc1234';

function actor(userId: string, role: UserRole, via: 'session' | 'api_key' = 'session'): DesignActor {
  return designActorFrom({ userId, role, via });
}

function session(over: Partial<PolicySession> = {}): PolicySession {
  return {
    id: 's-1',
    designer_id: DESIGNER,
    status: 'awaiting_input',
    head_sha: HEAD,
    publish_precheck: { head_sha: HEAD, gates_ok: true, gates: [{ name: 'library_lint', ok: true }] },
    designer_on_project: true,
    ...over,
  };
}

function site(designer_publish: boolean, over: Partial<PolicySite> = {}): PolicySite {
  return { id: 'site-1', design_portal_enabled: true, designer_publish, is_deleted: false, ...over };
}

// ---------------------------------------------------------------------------------------------------------
// The D5 table, written out row by row (not derived from the implementation).
// ---------------------------------------------------------------------------------------------------------

type Mode = 'per_site' | 'pre_launch_only' | 'off';
type Role = 'client_preview' | 'production' | undefined;

const DESIGNER_TABLE: Array<[Mode, Role, boolean, boolean]> = [
  // mode,            main_role,        site flag, designer may publish
  ['per_site', 'client_preview', true, true],
  ['per_site', 'client_preview', false, false],
  ['per_site', 'production', true, true], // Mike's ruling: a designer on a production site with defaults is allowed
  ['per_site', 'production', false, false],
  ['per_site', undefined, true, true],
  ['per_site', undefined, false, false],
  ['pre_launch_only', 'client_preview', true, true],
  ['pre_launch_only', 'client_preview', false, false],
  ['pre_launch_only', 'production', true, false],
  ['pre_launch_only', 'production', false, false],
  ['pre_launch_only', undefined, true, false], // unknown = production
  ['pre_launch_only', undefined, false, false],
  ['off', 'client_preview', true, false],
  ['off', 'client_preview', false, false],
  ['off', 'production', true, false],
  ['off', 'production', false, false],
  ['off', undefined, true, false],
  ['off', undefined, false, false],
];

describe('designerMayPublish: every D5 row', () => {
  for (const [mode, role, flag, expected] of DESIGNER_TABLE) {
    it(`${mode} / ${role ?? 'unknown'} / designer_publish=${flag} -> ${expected}`, () => {
      expect(designerMayPublish({ designer_publish: flag }, { designer_publish_mode: mode }, role)).toBe(expected);
    });
  }
  it('an unknown stored mode fails closed', () => {
    expect(designerMayPublish({ designer_publish: true }, { designer_publish_mode: 'yes_please' }, 'client_preview')).toBe(false);
  });
});

describe('canPublish: D5 table x actor (designer, admin, pm, admin API key)', () => {
  for (const [mode, role, flag, designerAllowed] of DESIGNER_TABLE) {
    const label = `${mode} / ${role ?? 'unknown'} / flag ${flag}`;
    const settings = { designer_publish_mode: mode };

    it(`${label}: designer -> ${designerAllowed ? 'allowed' : '403 designer_publish_off'}`, () => {
      const d = canPublish(actor(DESIGNER, 'designer'), session(), site(flag), settings, role);
      if (designerAllowed) {
        expect(d).toMatchObject({ ok: true, actor_role: 'designer', publish_mode: mode, site_designer_publish: flag, main_role: role ?? 'production' });
      } else {
        expect(d).toMatchObject({ ok: false, status: 403, code: 'designer_publish_off' });
      }
    });

    it(`${label}: admin -> allowed`, () => {
      const d = canPublish(actor(ADMIN, 'admin'), session(), site(flag), settings, role);
      expect(d).toMatchObject({ ok: true, actor_role: 'admin', main_role: role ?? 'production' });
    });

    it(`${label}: pm -> 403`, () => {
      expect(canPublish(actor(PM, 'pm'), session(), site(flag), settings, role)).toMatchObject({ ok: false, status: 403, code: 'forbidden' });
    });

    it(`${label}: admin API key -> 403 session_required`, () => {
      expect(canPublish(actor(ADMIN, 'admin', 'api_key'), session(), site(flag), settings, role)).toMatchObject({
        ok: false,
        status: 403,
        code: 'session_required',
      });
    });
  }
});

describe('canPublish: who else, and the state checks', () => {
  const defaults = { designer_publish_mode: 'per_site' };
  const d = actor(DESIGNER, 'designer');

  it('another designer gets 404 (no id probing)', () => {
    expect(canPublish(actor(OTHER_DESIGNER, 'designer'), session(), site(true), defaults, 'client_preview')).toMatchObject({ status: 404, code: 'not_found' });
  });
  it('tech gets 404', () => {
    expect(canPublish(actor(TECH, 'tech'), session(), site(true), defaults, 'client_preview')).toMatchObject({ status: 404 });
  });
  it('a lane key (tech, api key) gets 403 session_required', () => {
    expect(canPublish(actor(TECH, 'tech', 'api_key'), session(), site(true), defaults, 'client_preview')).toMatchObject({ status: 403, code: 'session_required' });
  });
  it('a disabled or deleted site refuses admin too', () => {
    expect(canPublish(actor(ADMIN, 'admin'), session(), site(true, { design_portal_enabled: false }), defaults, 'production')).toMatchObject({ status: 409, code: 'site_not_enabled' });
    expect(canPublish(d, session(), site(true, { is_deleted: true }), defaults, 'production')).toMatchObject({ code: 'site_not_enabled' });
  });

  const statuses: Array<[string, string | null]> = [
    ['awaiting_input', null],
    ['paused_budget', null],
    ['pending', 'stale_head'],
    ['active', 'stale_head'],
    ['publishing', 'publish_in_progress'],
    ['stopped', 'session_stopped'],
    ['closed', 'session_closed'],
    ['abandoned', 'session_closed'],
  ];
  for (const [status, code] of statuses) {
    it(`session ${status} -> ${code ?? 'allowed'}`, () => {
      const r = canPublish(d, session({ status }), site(true), defaults, 'client_preview');
      if (code) expect(r).toMatchObject({ ok: false, status: 409, code });
      else expect(r.ok).toBe(true);
    });
  }

  it('another publish running for the site: 409 publish_in_progress', () => {
    expect(canPublish(d, session(), site(true), defaults, 'client_preview', { publishRunning: true })).toMatchObject({ status: 409, code: 'publish_in_progress' });
  });
  it('no head yet: stale_head', () => {
    expect(canPublish(d, session({ head_sha: null }), site(true), defaults, 'client_preview')).toMatchObject({ code: 'stale_head' });
  });
  it('the head moved since the actor looked: stale_head', () => {
    expect(canPublish(d, session(), site(true), defaults, 'client_preview', { head_sha: 'old0000' })).toMatchObject({ status: 409, code: 'stale_head' });
    expect(canPublish(d, session(), site(true), defaults, 'client_preview', { head_sha: HEAD }).ok).toBe(true);
  });
  it('red gates on the head: 409 gates_not_green, admin included', () => {
    const red = session({ publish_precheck: { head_sha: HEAD, gates_ok: false } });
    expect(canPublish(d, red, site(true), defaults, 'client_preview')).toMatchObject({ status: 409, code: 'gates_not_green' });
    expect(canPublish(actor(ADMIN, 'admin'), red, site(true), defaults, 'client_preview')).toMatchObject({ code: 'gates_not_green' });
  });
  it('a precheck for another head, or none, is not green', () => {
    expect(canPublish(d, session({ publish_precheck: { head_sha: 'other', gates_ok: true } }), site(true), defaults, 'client_preview')).toMatchObject({ code: 'gates_not_green' });
    expect(canPublish(d, session({ publish_precheck: null }), site(true), defaults, 'client_preview')).toMatchObject({ code: 'gates_not_green' });
  });
  it('no copy or code policy: a precheck that lists code files and copy is still publishable', () => {
    const p = { head_sha: HEAD, gates_ok: true, touches_code: ['src/assets/js/parallax.js'], copy_words: 4000, new_hosts: ['evil.example'] };
    expect(canPublish(d, session({ publish_precheck: p }), site(true), defaults, 'production').ok).toBe(true);
  });
});

describe('designer rights are current (W8.2 H2)', () => {
  it('canPublish: her own session, but no longer on its project: 404', () => {
    expect(canPublish(actor(DESIGNER, 'designer'), session({ designer_on_project: false }), site(true), { designer_publish_mode: 'per_site' }, 'client_preview'))
      .toMatchObject({ ok: false, status: 404, code: 'not_found' });
  });
  it('canRequestPublish: her own session, but no longer on its project: 404', () => {
    expect(canRequestPublish(actor(DESIGNER, 'designer'), session({ designer_on_project: false }), site(true), { designer_publish_mode: 'off' }, 'client_preview'))
      .toMatchObject({ ok: false, status: 404, code: 'not_found' });
  });
  it('an admin is unaffected by the flag', () => {
    expect(canPublish(actor(ADMIN, 'admin'), session({ designer_on_project: false }), site(true), { designer_publish_mode: 'per_site' }, 'client_preview').ok).toBe(true);
  });
});

describe('canRequestPublish', () => {
  const d = actor(DESIGNER, 'designer');
  it('designer publish on: 409 publish_allowed', () => {
    expect(canRequestPublish(d, session(), site(true), { designer_publish_mode: 'per_site' }, 'production')).toMatchObject({ status: 409, code: 'publish_allowed' });
  });
  it('mode off, site flag off, or pre_launch_only on production: allowed', () => {
    expect(canRequestPublish(d, session(), site(true), { designer_publish_mode: 'off' }, 'client_preview').ok).toBe(true);
    expect(canRequestPublish(d, session(), site(false), { designer_publish_mode: 'per_site' }, 'client_preview').ok).toBe(true);
    expect(canRequestPublish(d, session(), site(true), { designer_publish_mode: 'pre_launch_only' }, 'production').ok).toBe(true);
  });
  it('pm 403, other designer 404, api key 403, closed 409', () => {
    const s = { designer_publish_mode: 'off' };
    expect(canRequestPublish(actor(PM, 'pm'), session(), site(true), s, 'production')).toMatchObject({ status: 403 });
    expect(canRequestPublish(actor(OTHER_DESIGNER, 'designer'), session(), site(true), s, 'production')).toMatchObject({ status: 404 });
    expect(canRequestPublish(actor(ADMIN, 'admin', 'api_key'), session(), site(true), s, 'production')).toMatchObject({ status: 403 });
    expect(canRequestPublish(d, session({ status: 'closed' }), site(true), s, 'production')).toMatchObject({ code: 'session_closed' });
  });
});

describe('normalizers and gateStatus', () => {
  it.each([['client_preview', 'client_preview'], ['production', 'production'], [undefined, 'production'], [null, 'production'], ['staging', 'production'], ['CLIENT_PREVIEW', 'production']])(
    'normalizeMainRole(%s) = %s',
    (input, expected) => expect(normalizeMainRole(input)).toBe(expected),
  );
  it('normalizePublishMode', () => {
    expect(normalizePublishMode('per_site')).toBe('per_site');
    expect(normalizePublishMode('pre_launch_only')).toBe('pre_launch_only');
    expect(normalizePublishMode(undefined)).toBe('off');
  });
  it('mainRoleFor reads the heartbeat map; a missing site or map is production', () => {
    expect(mainRoleFor('s1', { s1: 'client_preview' })).toBe('client_preview');
    expect(mainRoleFor('s2', { s1: 'client_preview' })).toBe('production');
    expect(mainRoleFor('s1', null)).toBe('production');
    expect(mainRoleFor('s1', ['client_preview'])).toBe('production');
  });
  it('gateStatus', () => {
    expect(gateStatus({ head_sha: HEAD, gates_ok: true }, HEAD)).toBe('green');
    expect(gateStatus({ head_sha: HEAD, gates_ok: false }, HEAD)).toBe('red');
    expect(gateStatus({ head_sha: HEAD }, HEAD)).toBe('unknown');
    expect(gateStatus({ head_sha: 'x', gates_ok: true }, HEAD)).toBe('unknown');
    expect(gateStatus('junk', HEAD)).toBe('unknown');
    expect(gateStatus({ head_sha: HEAD, gates_ok: true }, null)).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------------------------------------
// Confirmation wording
// ---------------------------------------------------------------------------------------------------------

const VCDP = { name: 'VCDP', url: 'https://vcdp.org', prod_branch: null, repo_branch: 'main' };
const SESSION_FOR_DIALOG = {
  head_sha: HEAD,
  cost_usd: { toString: () => '3.4567' },
  diff_summary: { files_changed: 2, insertions: 10, deletions: 3, files: [{ path: 'src/index.njk', add: 8, del: 2 }, { path: 'src/assets/js/parallax.js', add: 2, del: 1 }] },
  publish_precheck: { head_sha: HEAD, gates_ok: true, gates: [{ name: 'library_lint', ok: true, summary: 'ok' }], pages_affected: ['/about/', '/'], copy_words: 120 },
};

const CONFIRMATION_KEYS = [
  'button_label', 'cost_usd', 'diff_summary', 'files_changed', 'gates', 'head_sha', 'heading', 'live_url', 'main_branch',
  'main_role', 'pages_affected', 'target_label', 'target_words', 'tone', 'type_to_confirm',
];

describe('confirmationShown', () => {
  it('production: production wording, live url, files, pages, gates, cost', () => {
    const c = confirmationShown({ site: VCDP, mainRole: 'production', liveUrl: 'https://vcdp.org', session: SESSION_FOR_DIALOG });
    expect(c).toEqual({
      target_label: 'Live production site',
      target_words: 'the LIVE production site at vcdp.org',
      heading: 'Publish to the live site vcdp.org',
      button_label: 'Publish to the live site',
      tone: 'production',
      live_url: 'https://vcdp.org',
      main_role: 'production',
      main_branch: 'main',
      type_to_confirm: 'Type main to confirm',
      head_sha: HEAD,
      diff_summary: { files_changed: 2, insertions: 10, deletions: 3 },
      files_changed: ['src/assets/js/parallax.js', 'src/index.njk'],
      pages_affected: ['/', '/about/'],
      gates: { status: 'green', entries: [{ name: 'library_lint', ok: true, summary: 'ok' }] },
      cost_usd: 3.46,
    });
  });

  for (const unknown of [undefined, null, 'staging', '']) {
    it(`unknown main_role (${JSON.stringify(unknown)}) gets the production wording`, () => {
      const c = confirmationShown({ site: VCDP, mainRole: unknown, session: SESSION_FOR_DIALOG });
      expect(c.main_role).toBe('production');
      expect(c.tone).toBe('production');
      expect(c.target_words).toBe('the LIVE production site at vcdp.org'); // falls back to Site.url on production
      expect(c.heading).toBe('Publish to the live site vcdp.org');
    });
  }

  it('client_preview: preview wording at the main alias', () => {
    const c = confirmationShown({ site: VCDP, mainRole: 'client_preview', liveUrl: 'https://vcdp.pages.dev', session: SESSION_FOR_DIALOG });
    expect(c.target_words).toBe('the client preview at vcdp.pages.dev');
    expect(c.heading).toBe('Publish to the client preview (vcdp.pages.dev)');
    expect(c.button_label).toBe('Publish to the client preview');
    expect(c.target_label).toBe('Client preview');
    expect(c.tone).toBe('client_preview');
  });

  it('client_preview never borrows the production Site.url', () => {
    const c = confirmationShown({ site: VCDP, mainRole: 'client_preview', session: SESSION_FOR_DIALOG });
    expect(c.live_url).toBeNull();
    expect(c.target_words).toBe('the client preview for VCDP');
  });

  it('production with no address anywhere names the site', () => {
    const c = confirmationShown({ site: { ...VCDP, url: null }, mainRole: 'production', session: SESSION_FOR_DIALOG });
    expect(c.target_words).toBe('the LIVE production site for VCDP');
    expect(c.heading).toBe('Publish to the live site for VCDP');
  });

  it('main branch: explicit, then prod_branch, then repo_branch, then main', () => {
    expect(confirmationShown({ site: VCDP, mainRole: 'production', mainBranch: 'trunk', session: SESSION_FOR_DIALOG }).main_branch).toBe('trunk');
    expect(confirmationShown({ site: { ...VCDP, prod_branch: 'live' }, mainRole: 'production', session: SESSION_FOR_DIALOG }).main_branch).toBe('live');
    expect(confirmationShown({ site: { ...VCDP, repo_branch: 'master' }, mainRole: 'production', session: SESSION_FOR_DIALOG }).main_branch).toBe('master');
    expect(confirmationShown({ site: { name: 'X', url: null }, mainRole: 'production', session: SESSION_FOR_DIALOG }).main_branch).toBe('main');
  });

  it('a precheck for another head: gates unknown, pages and files from the changes', () => {
    const c = confirmationShown({
      site: VCDP,
      mainRole: 'production',
      session: { head_sha: HEAD, cost_usd: 0, diff_summary: null, publish_precheck: { head_sha: 'old', gates_ok: true, pages_affected: ['/old/'] } },
      changes: [{ pages: ['/b/', '/a/'], files: ['src/b.njk'] }, { pages: ['/a/'], files: ['src/a.njk'] }],
    });
    expect(c.gates).toEqual({ status: 'unknown', entries: [] });
    expect(c.pages_affected).toEqual(['/a/', '/b/']);
    expect(c.files_changed).toEqual(['src/a.njk', 'src/b.njk']);
    expect(c.diff_summary).toEqual({ files_changed: 2, insertions: 0, deletions: 0 });
  });

  it('key snapshot: no copy or code policy field ever appears', () => {
    const c = confirmationShown({ site: VCDP, mainRole: 'production', session: SESSION_FOR_DIALOG });
    expect(Object.keys(c).sort()).toEqual(CONFIRMATION_KEYS);
    expect(JSON.stringify(c)).not.toMatch(/copy_words|touches_code|new_hosts|policy/);
  });
});

// ---------------------------------------------------------------------------------------------------------
// Step 2 (confirm)
// ---------------------------------------------------------------------------------------------------------

describe('checkConfirmation (T25)', () => {
  const token = newConfirmationToken();
  const now = new Date('2026-10-29T12:00:00Z');
  function input(over: Partial<ConfirmCheckInput> = {}, publishOver: Partial<ConfirmCheckInput['publish']> = {}): ConfirmCheckInput {
    return {
      actor: { userId: DESIGNER, via: 'session' },
      publish: {
        actor_id: DESIGNER,
        status: 'awaiting_confirmation',
        confirmation_token_hash: hashConfirmationToken(token),
        confirmation_expires_at: new Date(now.getTime() + 5 * 60_000),
        head_sha: HEAD,
        main_role: 'client_preview',
        confirmation_shown: { main_branch: 'main' },
        ...publishOver,
      },
      token,
      typed: 'main',
      current: { head_sha: HEAD, gate_status: 'green', main_role: 'client_preview' },
      now,
      ...over,
    };
  }

  it('the token is 32 random bytes and only its sha256 is compared', () => {
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(hashConfirmationToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(newConfirmationToken()).not.toBe(token);
  });
  it('valid: ok (surrounding whitespace in the typed text is ignored)', () => {
    expect(checkConfirmation(input()).ok).toBe(true);
    expect(checkConfirmation(input({ typed: ' main ' })).ok).toBe(true);
  });

  const cases: Array<[string, Partial<ConfirmCheckInput>, Partial<ConfirmCheckInput['publish']>, number, string]> = [
    ['API key', { actor: { userId: DESIGNER, via: 'api_key' } }, {}, 403, 'session_required'],
    ['another user', { actor: { userId: OTHER_DESIGNER, via: 'session' } }, {}, 404, 'not_found'],
    ['missing token', { token: undefined }, {}, 400, 'confirmation_missing'],
    ['missing typed text', { typed: '' }, {}, 400, 'confirmation_missing'],
    ['already used (queued)', {}, { status: 'queued' }, 409, 'confirmation_used'],
    ['superseded (expired row)', {}, { status: 'expired' }, 409, 'confirmation_used'],
    ['expired by time', {}, { confirmation_expires_at: new Date(now.getTime() - 1) }, 409, 'confirmation_expired'],
    ['no expiry stored', {}, { confirmation_expires_at: null }, 409, 'confirmation_expired'],
    ['wrong token', { token: 'forged' }, {}, 409, 'confirmation_invalid'],
    ['foreign token', { token: newConfirmationToken() }, {}, 409, 'confirmation_invalid'],
    ['typed master for main', { typed: 'master' }, {}, 409, 'typed_mismatch'],
    ['typed Main (case matters)', { typed: 'Main' }, {}, 409, 'typed_mismatch'],
    ['head moved', { current: { head_sha: 'new0000', gate_status: 'green', main_role: 'client_preview' } }, {}, 409, 'stale_head'],
    ['gates went red', { current: { head_sha: HEAD, gate_status: 'red', main_role: 'client_preview' } }, {}, 409, 'gates_not_green'],
    ['main_role flipped', { current: { head_sha: HEAD, gate_status: 'green', main_role: 'production' } }, {}, 409, 'main_role_changed'],
    ['main_role now unknown (= production)', { current: { head_sha: HEAD, gate_status: 'green', main_role: undefined } }, {}, 409, 'main_role_changed'],
  ];
  for (const [name, over, pub, status, code] of cases) {
    it(`${name} -> ${status} ${code}`, () => expect(checkConfirmation(input(over, pub))).toMatchObject({ ok: false, status, code }));
  }
});

// ---------------------------------------------------------------------------------------------------------
// Rollback
// ---------------------------------------------------------------------------------------------------------

describe('canRollback (T23)', () => {
  const pub = { id: 'pub-2', kind: 'publish', status: 'published', actor_id: DESIGNER, result_sha: 'r2' };
  const latest = { id: 'pub-2', result_sha: 'r2' };

  const cases: Array<[string, DesignActor, typeof pub, typeof latest | null, true | [number, string]]> = [
    ['admin', actor(ADMIN, 'admin'), pub, latest, true],
    ['the actor (designer)', actor(DESIGNER, 'designer'), pub, latest, true],
    ['another designer', actor(OTHER_DESIGNER, 'designer'), pub, latest, [404, 'not_found']],
    ['pm', actor(PM, 'pm'), pub, latest, [403, 'forbidden']],
    ['tech', actor(TECH, 'tech'), pub, latest, [404, 'not_found']],
    ['admin API key', actor(ADMIN, 'admin', 'api_key'), pub, latest, [403, 'session_required']],
    ['the actor with an API key', actor(DESIGNER, 'designer', 'api_key'), pub, latest, [403, 'session_required']],
    ['an older publish (a later one exists)', actor(ADMIN, 'admin'), { ...pub, id: 'pub-1', result_sha: 'r1' }, latest, [409, 'not_latest']],
    ['older publish by its own actor', actor(DESIGNER, 'designer'), { ...pub, id: 'pub-1', result_sha: 'r1' }, latest, [409, 'not_latest']],
    ['latest row id matches but result_sha differs', actor(ADMIN, 'admin'), pub, { id: 'pub-2', result_sha: 'zz' }, [409, 'not_latest']],
    ['no successful publish on the site', actor(ADMIN, 'admin'), pub, null, [409, 'not_latest']],
    ['a rollback row', actor(ADMIN, 'admin'), { ...pub, kind: 'rollback' }, latest, [409, 'not_rollbackable']],
    ['already rolled back', actor(ADMIN, 'admin'), { ...pub, status: 'rolled_back' }, latest, [409, 'not_published']],
    ['failed publish', actor(DESIGNER, 'designer'), { ...pub, status: 'failed' }, latest, [409, 'not_published']],
  ];
  for (const [name, who, p, l, expected] of cases) {
    it(`${name} -> ${expected === true ? 'allowed' : expected.join(' ')}`, () => {
      const standing = who.role === 'designer' ? { designer: { has_session_access: true, may_publish: true } } : {};
      const r = canRollback(who, p, l, standing);
      if (expected === true) expect(r).toEqual({ ok: true });
      else expect(r).toMatchObject({ ok: false, status: expected[0], code: expected[1] });
    });
  }
  it('a publish or rollback already running for the site: 409', () => {
    expect(canRollback(actor(ADMIN, 'admin'), pub, latest, { publishRunning: true })).toMatchObject({ code: 'publish_in_progress' });
  });

  // W8.2 H2, H4 and N4: the "her publish" path is for a CURRENT designer with current access, and follows the switch.
  it('her publish after she was removed from the project: 404', () => {
    expect(canRollback(actor(DESIGNER, 'designer'), pub, latest, { designer: { has_session_access: false, may_publish: true } }))
      .toMatchObject({ ok: false, status: 404, code: 'not_found' });
  });
  it('her publish with no standing given: 404 (fail closed)', () => {
    expect(canRollback(actor(DESIGNER, 'designer'), pub, latest)).toMatchObject({ ok: false, status: 404, code: 'not_found' });
  });
  it('her publish after she was demoted to tech: 404', () => {
    expect(canRollback(actor(TECH, 'tech'), { ...pub, actor_id: TECH }, latest, { designer: { has_session_access: true, may_publish: true } }))
      .toMatchObject({ ok: false, status: 404, code: 'not_found' });
  });
  it('her publish after she was promoted to pm: 403 like any pm', () => {
    expect(canRollback(actor(PM, 'pm'), { ...pub, actor_id: PM }, latest)).toMatchObject({ ok: false, status: 403, code: 'forbidden' });
  });
  it('designer publish switched off for the site: the designer cannot roll back (403), the admin can', () => {
    expect(canRollback(actor(DESIGNER, 'designer'), pub, latest, { designer: { has_session_access: true, may_publish: false } }))
      .toMatchObject({ ok: false, status: 403, code: 'designer_publish_off' });
    expect(canRollback(actor(ADMIN, 'admin'), pub, latest)).toEqual({ ok: true });
  });
  it('latestPublishedQuery orders by finished_at, nulls last', () => {
    expect(latestPublishedQuery('site-1')).toEqual({
      where: { site_id: 'site-1', status: 'published' },
      orderBy: [{ finished_at: { sort: 'desc', nulls: 'last' } }, { created_at: 'desc' }],
      select: { id: true, result_sha: true },
    });
  });
});
