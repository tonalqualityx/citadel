import { describe, it, expect } from 'vitest';
import { briefInputSchema, parseScope, scopeWhere } from './brief';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('briefInputSchema', () => {
  it('needs a project or a charter', () => {
    expect(briefInputSchema.safeParse({ label: 'x' }).success).toBe(false);
    expect(briefInputSchema.safeParse({ label: 'x', charter_id: U(1) }).success).toBe(true);
  });
  it('refuses an action outside the five', () => {
    expect(briefInputSchema.safeParse({ label: 'x', project_id: U(1), allowed_actions: ['send_email'] }).success).toBe(false);
    expect(briefInputSchema.safeParse({ label: 'x', project_id: U(1), allowed_actions: ['close', 'note'] }).success).toBe(true);
  });
  it('refuses unknown scope and stall keys', () => {
    expect(briefInputSchema.safeParse({ label: 'x', project_id: U(1), scope: { everything: true } }).success).toBe(false);
    expect(briefInputSchema.safeParse({ label: 'x', project_id: U(1), stall_rules: { not_started_bd: 0 } }).success).toBe(false);
  });
});

describe('sources', () => {
  const base = { label: 'x', project_id: U(1) };
  it('accepts contacts, threads, repo and domain entries and unknown pointers', () => {
    const sources = [
      { kind: 'contacts', addresses: ['dan@vcdp.example'], domains: ['vcdp.example'] },
      { kind: 'threads', ids: ['19a1b2c3'] },
      { kind: 'repo', path: '/home/mike/Documents/repos/vcdp' },
      { kind: 'domain', host: 'vcdp.example' },
      { kind: 'drive', label: 'Content Round 1' },
    ];
    expect(briefInputSchema.safeParse({ ...base, sources }).success).toBe(true);
  });
  it('refuses repos outside or at the allowed roots and bare or dotless domains', () => {
    for (const bad of [
      { kind: 'repo', path: '/home/mike/Documents' },
      { kind: 'repo', path: '/home/mike/.openclaw/workspace' },
      { kind: 'repo', path: '/etc' },
      { kind: 'repo', path: '/home/mike/Documents/../.ssh' },
      { kind: 'domain', host: 'com' },
      { kind: 'domain', host: 'localhost' },
    ]) {
      expect(briefInputSchema.safeParse({ ...base, sources: [bad] }).success).toBe(false);
    }
    expect(briefInputSchema.safeParse({ ...base, sources: [{ kind: 'repo', path: '/home/mike/Documents/repos/vcdp' }, { kind: 'domain', host: 'vcdp.org' }] }).success).toBe(true);
  });
  it('refuses malformed contacts, threads, repo and domain entries', () => {
    for (const bad of [{ kind: 'contacts', addresses: 'dan@x' }, { kind: 'threads' }, { kind: 'repo' }, { kind: 'domain', host: 3 }]) {
      expect(briefInputSchema.safeParse({ ...base, sources: [bad] }).success).toBe(false);
    }
  });
});

describe('scopeWhere (Herba-shaped)', () => {
  const herba = {
    client_id: U(10),
    project_id: null,
    charter_id: U(11),
    scope: {
      include_client_tasks_without_project: true,
      include_retainer_projects: true,
      exclude: {
        project_ids: [U(20)],
        task_ids: [U(30)],
        tags: ['kava-bar-directory'],
        reasons: [{ what: 'Kava bar directory project', why: 'its own arc with its own owner' }],
      },
    },
  };

  it('is the charter, the client tasks with no project and the retainer projects, minus the exclusions', () => {
    const w = scopeWhere(herba)!;
    expect(w.is_deleted).toBe(false);
    const and = w.AND as unknown[];
    expect(and[0]).toEqual({
      OR: [
        { charter_id: { in: [U(11)] } },
        { client_id: U(10), project_id: null },
        { client_id: U(10), project: { is: { is_retainer: true } } },
      ],
    });
    // NOT IN on a nullable column drops NULL rows, so each exclusion keeps them explicitly.
    expect(and[1]).toEqual({ OR: [{ project_id: null }, { project_id: { notIn: [U(20)] } }] });
    expect(and[2]).toEqual({ id: { notIn: [U(30)] } });
    expect(and[3]).toEqual({ NOT: { tags: { hasSome: ['kava-bar-directory'] } } });
  });

  it('a project brief scopes to its project alone', () => {
    const w = scopeWhere({ client_id: U(1), project_id: U(2), charter_id: null, scope: {} })!;
    expect((w.AND as unknown[])[0]).toEqual({ OR: [{ project_id: { in: [U(2)] } }] });
  });

  it('an empty scope matches nothing, and a bad scope reads as empty', () => {
    expect(scopeWhere({ client_id: U(1), project_id: null, charter_id: null, scope: {} })).toBeNull();
    expect(parseScope({ nonsense: 1 })).toEqual({});
    expect(scopeWhere({ client_id: U(1), project_id: null, charter_id: null, scope: { nonsense: 1 } })).toBeNull();
  });

  it('a client flag without a client names nothing', () => {
    expect(scopeWhere({ client_id: null, project_id: null, charter_id: null, scope: { include_client_tasks_without_project: true } })).toBeNull();
  });
});
