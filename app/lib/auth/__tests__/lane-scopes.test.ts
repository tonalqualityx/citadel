import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  LANES,
  LANE_IDENTITY,
  LANE_ROUTES,
  laneAllows,
  laneScopesOf,
  paramExceptions,
  parseRouteHeader,
  patternMatches,
} from '../lane-scopes';

const API_ROOT = path.resolve(__dirname, '../../../app/api');
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

/** Every route.ts under app/api as [segments, exported methods]. */
function routeTree(): Array<[string[], Set<string>]> {
  const out: Array<[string[], Set<string>]> = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (e.name !== '__tests__') walk(path.join(dir, e.name));
      } else if (e.name === 'route.ts') {
        const src = fs.readFileSync(path.join(dir, e.name), 'utf8');
        const methods = new Set<string>();
        for (const m of METHODS) {
          if (new RegExp(`export\\s+(async\\s+)?(function|const)\\s+${m}\\b`).test(src)) methods.add(m);
          if (new RegExp(`export\\s*\\{[^}]*\\b${m}\\b`).test(src)) methods.add(m);
        }
        const rel = path.relative(API_ROOT, dir);
        out.push([['', 'api', ...(rel ? rel.split(path.sep) : [])], methods]);
      }
    }
  };
  walk(API_ROOT);
  return out;
}

const isDyn = (s: string) => s.startsWith('[');

/**
 * Lane entries whose route file a later task of the same build creates. Bast chat (implementation/plans/
 * bast-chat.md): task C1 lands the lane, task C3 lands these worker routes. An entry here may be missing from
 * the tree; once its file exists it is checked like any other entry. C3 empties this list.
 * v2 (specs/bast-chat-v2-plan.md S1-C1): the ops route file is created by S1-C6; S1-C6 empties this list.
 */
const PENDING_ROUTES: ReadonlySet<string> = new Set<string>([]);
const segMatch = (p: string, s: string) => (p.startsWith(':') ? isDyn(s) : p === s);

describe('lane list', () => {
  it('has the fixed lanes in order, each with a route and an identity', () => {
    expect(LANES).toEqual([
      'courier', 'bellringer', 'portal-chat-machine', 'qbo', 'porter', 'wright', 'clarity', 'bast',
      'audit-lane', 'troubador', 'oracle', 'design-worker', 'bast-chat', 'design-track', 'design-notes',
    ]);
    for (const l of LANES) expect(LANE_ROUTES[l].length).toBeGreaterThan(0);
  });

  it('every lane key is Bast except Troubador, Oracle and design-worker; bast-chat, design-track and design-notes are Bast (no lane acts as Mike)', () => {
    for (const l of LANES) {
      expect(LANE_IDENTITY[l]).toBe(l === 'troubador' ? 'troubador' : l === 'oracle' ? 'oracle' : l === 'design-worker' ? 'design-worker' : 'bast');
    }
  });

  it('has no TODO and no duplicate entries', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../lane-scopes.ts'), 'utf8');
    expect(src).not.toMatch(/TODO|FIXME|XXX/);
    for (const l of LANES) {
      const keys = LANE_ROUTES[l].map((r) => `${r.method} ${r.pattern}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('every entry is a real route file that exports that method', () => {
    const tree = routeTree();
    const missing: string[] = [];
    for (const l of LANES) {
      for (const r of LANE_ROUTES[l]) {
        const want = r.pattern.split('/');
        const hit = tree.some(([segs, ms]) =>
          segs.length === want.length && want.every((p, i) => segMatch(p, segs[i])) && ms.has(r.method));
        const name = `${l}: ${r.method} ${r.pattern}`;
        if (!hit && !PENDING_ROUTES.has(name)) missing.push(name);
      }
    }
    expect(missing).toEqual([]);
  });

  it('the pending list names only bast-chat worker routes that are in the lane', () => {
    for (const name of PENDING_ROUTES) {
      expect(name.startsWith('bast-chat: ')).toBe(true);
      const [method, pattern] = name.slice('bast-chat: '.length).split(' ');
      expect(pattern.startsWith('/api/bast-chat/worker/')).toBe(true);
      expect(LANE_ROUTES['bast-chat'].some((r) => r.method === method && r.pattern === pattern)).toBe(true);
    }
  });

  it('a :param never stands in for a static sibling route (exceptions cover the tree)', () => {
    const tree = routeTree();
    const gaps: string[] = [];
    for (const l of LANES) {
      for (const r of LANE_ROUTES[l]) {
        const want = r.pattern.split('/');
        want.forEach((p, i) => {
          if (!p.startsWith(':')) return;
          const prefix = want.slice(0, i + 1).join('/');
          const statics = new Set<string>();
          for (const [segs] of tree) {
            if (segs.length <= i) continue;
            if (want.slice(0, i).every((q, j) => segMatch(q, segs[j])) && !isDyn(segs[i])) statics.add(segs[i]);
          }
          for (const s of statics) {
            if (!paramExceptions(prefix).includes(s)) gaps.push(`${prefix} must not match "${s}"`);
          }
        });
      }
    }
    expect([...new Set(gaps)]).toEqual([]);
  });
});

describe('matching', () => {
  it('matches literal and :param segments exactly', () => {
    expect(patternMatches('/api/tasks/:id', '/api/tasks/7f1c')).toBe(true);
    expect(patternMatches('/api/tasks/:id', '/api/tasks/7f1c/')).toBe(true);
    expect(patternMatches('/api/tasks/:id', '/api/tasks')).toBe(false);
    expect(patternMatches('/api/tasks/:id', '/api/tasks/7f1c/comments')).toBe(false);
    expect(patternMatches('/api/tasks/:id', '/api/tasks//')).toBe(false);
    expect(patternMatches('/api/tasks/:id', '/api/tasks/bulk')).toBe(false);
    expect(patternMatches('/api/email-outbox', '/api/email-outbox?x=1')).toBe(true);
  });

  it('checks the method', () => {
    expect(laneAllows('courier', 'GET', '/api/email-outbox')).toBe(true);
    expect(laneAllows('courier', 'get', '/api/email-outbox')).toBe(true);
    expect(laneAllows('courier', 'DELETE', '/api/email-outbox')).toBe(false);
    expect(laneAllows('courier', 'POST', '/api/email-outbox/abc/claim')).toBe(true);
    expect(laneAllows('courier', 'GET', '/api/sites')).toBe(false);
  });

  it('bast reads card questions but never asks, edits or answers', () => {
    expect(laneAllows('bast', 'GET', '/api/tasks/7f1c/questions')).toBe(true);
    expect(laneAllows('bast', 'POST', '/api/tasks/7f1c/questions')).toBe(false);
    expect(laneAllows('bast', 'PATCH', '/api/tasks/7f1c/questions/9a')).toBe(false);
    expect(laneAllows('bast', 'POST', '/api/tasks/7f1c/questions/9a/answer')).toBe(false);
  });

  it('bast reads one meeting (decisions/capture.py) but not the incomplete list or a write', () => {
    expect(laneAllows('bast', 'GET', '/api/meetings/7f1c')).toBe(true);
    expect(laneAllows('bast', 'GET', '/api/meetings/incomplete')).toBe(false);
    expect(laneAllows('bast', 'PATCH', '/api/meetings/7f1c')).toBe(false);
    expect(laneAllows('bast', 'GET', '/api/meetings')).toBe(false);
  });

  it('an unknown lane allows nothing', () => {
    expect(laneAllows('bogus', 'GET', '/api/email-outbox')).toBe(false);
  });

  it('reads lane scopes off a key', () => {
    expect(laneScopesOf(['engine'])).toEqual([]);
    expect(laneScopesOf(['lane:courier', 'scope-mode:enforce'])).toEqual(['courier']);
    expect(laneScopesOf(undefined)).toEqual([]);
  });

  it('parses the proxy header and rejects junk', () => {
    expect(parseRouteHeader('GET /api/tasks')).toEqual({ method: 'GET', path: '/api/tasks' });
    expect(parseRouteHeader(null)).toBeNull();
    expect(parseRouteHeader('')).toBeNull();
    expect(parseRouteHeader('GET')).toBeNull();
    expect(parseRouteHeader('GET api/tasks')).toBeNull();
    expect(parseRouteHeader('G3T /api/tasks')).toBeNull();
  });
});
