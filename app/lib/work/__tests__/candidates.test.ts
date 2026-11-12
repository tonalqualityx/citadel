// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { candidatesFor, clientSlug, cleanPath, folderContains, normalizeRemote, resolve, slugMatchesClient, wrightClientSlug, type CandidateInput, type ProjectFacts } from '../candidates';

const P = (id: string, name: string, over: Partial<ProjectFacts> = {}): ProjectFacts => ({ id: `00000000-0000-4000-8000-00000000000${id}`, name, status: 'in_progress', client_id: 'c1', plan_folder: null, site_repo_url: null, ...over });
const input = (over: Partial<CandidateInput> = {}): CandidateInput => ({
  existing: [],
  client: { id: 'c1', name: 'Thermalnetics' },
  client_projects: [],
  cwd: null,
  repo_remote: null,
  plan_folder_projects: [],
  site_repo_projects: [],
  folder_client_projects: [],
  folder_choices: [],
  ...over,
});
const key = (p: ProjectFacts) => `project:${p.id}`;

describe('paths and remotes', () => {
  it('a folder contains itself and what is under it, on a path boundary', () => {
    expect(folderContains('/a/foo', '/a/foo')).toBe(true);
    expect(folderContains('/a/foo/', '/a/foo/sub/dir')).toBe(true);
    expect(folderContains('/a/foo', '/a/foobar')).toBe(false);
    expect(folderContains(null, '/a')).toBe(false);
    expect(cleanPath('/a/b///')).toBe('/a/b');
  });
  it('ssh and https remotes of one repository meet', () => {
    expect(normalizeRemote('git@github.com:Indelible/Site.git')).toBe('github.com/indelible/site');
    expect(normalizeRemote('https://github.com/Indelible/Site')).toBe('github.com/indelible/site');
    expect(normalizeRemote('https://user@github.com/Indelible/Site.git/')).toBe('github.com/indelible/site');
    expect(normalizeRemote('')).toBeNull();
  });
  it('a Wright client folder names a client slug', () => {
    expect(wrightClientSlug('/home/mike/Documents/Wright/clients/vtstandard/site')).toBe('vtstandard');
    expect(wrightClientSlug('/home/mike/Documents/Wright/clients/knisely')).toBe('knisely');
    expect(wrightClientSlug('/home/mike/Documents/projects/x')).toBeNull();
    expect(clientSlug('VT Standard, Inc.')).toBe('vtstandardinc');
    expect(slugMatchesClient('vtstandard', 'VT Standard, Inc.')).toBe(true);
    expect(slugMatchesClient('knisely', 'Vellum')).toBe(false);
  });
});

describe('the candidates', () => {
  it('never includes a finished, queued, suspended or quoted project', () => {
    const live = P('1', 'Website');
    const list = candidatesFor(input({ client_projects: [live, P('2', 'Old', { status: 'done' }), P('3', 'Dropped', { status: 'cancelled' }), P('4', 'Quote', { status: 'quote' }), P('5', 'Queue', { status: 'queue' }), P('6', 'Hold', { status: 'suspended' })] }));
    expect(list.map((c) => c.target_key)).toEqual([key(live)]);
  });
  it('a finished project the conversation is linked to is dropped too', () => {
    const list = candidatesFor(input({ existing: [{ target_key: 'project:x', name: 'Done one', finished: true }] }));
    expect(list).toEqual([]);
  });
  it('one target found by two bases keeps the stronger basis', () => {
    const p = P('1', 'Website', { plan_folder: '/work/web' });
    const list = candidatesFor(input({ client_projects: [p], plan_folder_projects: [p], cwd: '/work/web/src' }));
    expect(list).toHaveLength(1);
    expect(list[0].basis).toBe('plan_folder');
  });
});

describe('resolve: quiet, ask or nothing', () => {
  it('a session in a plan folder attaches quietly', () => {
    const p = P('1', 'Thermalnetics website', { plan_folder: '/work/thermal' });
    const r = resolve(input({ client: null, cwd: '/work/thermal/app', plan_folder_projects: [p] }));
    expect(r).toMatchObject({ action: 'quiet', target: { target_key: key(p), basis: 'plan_folder' } });
  });
  it('a folder choice made before attaches quietly, the longest folder winning', () => {
    const a = P('1', 'Site A');
    const b = P('2', 'Site B');
    const r = resolve(input({ client: null, cwd: '/work/x/y/z', folder_choices: [{ folder: '/work/x', project: a }, { folder: '/work/x/y', project: b }] }));
    expect(r).toMatchObject({ action: 'quiet', target: { target_key: key(b), basis: 'prior_choice' } });
  });
  it('a conversation already linked to live work stays there, however many projects the client has', () => {
    const r = resolve(input({ existing: [{ target_key: 'task:t1', name: 'Fix the footer', finished: false }], client_projects: [P('1', 'A'), P('2', 'B')] }));
    expect(r).toMatchObject({ action: 'already', target: { target_key: 'task:t1' } });
  });
  it('two live projects of the client is one question with both', () => {
    const r = resolve(input({ client_projects: [P('1', 'Thermalnetics website'), P('2', 'Thermalnetics hosting')] }));
    expect(r.action).toBe('ask');
    if (r.action === 'ask') {
      expect(r.candidates.map((c) => c.label)).toEqual(['Thermalnetics hosting', 'Thermalnetics website']);
      expect(r.can_new_project).toBe(true);
    }
  });
  it('one live project of the client is still a question (client_project is not a clear basis)', () => {
    const r = resolve(input({ client_projects: [P('1', 'Website')] }));
    expect(r.action).toBe('ask');
  });
  it('a repo match alone is a question, not a quiet attach', () => {
    const p = P('1', 'Site', { site_repo_url: 'git@github.com:i/s.git' });
    const r = resolve(input({ client: null, cwd: '/x', repo_remote: 'https://github.com/i/s', site_repo_projects: [p] }));
    expect(r.action).toBe('ask');
  });
  it('a client with no live project is a question that offers a new project only', () => {
    const r = resolve(input({ client_projects: [P('1', 'Old', { status: 'done' })] }));
    expect(r).toEqual({ action: 'ask', candidates: [], can_new_project: true });
  });
  it('no candidate and no client is nothing to ask', () => {
    expect(resolve(input({ client: null }))).toEqual({ action: 'none' });
  });
  it('two plan-folder matches is a question (when in doubt, ask)', () => {
    const a = P('1', 'A', { plan_folder: '/w' });
    const b = P('2', 'B', { plan_folder: '/w/sub' });
    const r = resolve(input({ client: null, cwd: '/w/sub/x', plan_folder_projects: [a, b] }));
    expect(r.action).toBe('ask');
  });
});
