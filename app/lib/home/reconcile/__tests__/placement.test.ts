import { describe, it, expect } from 'vitest';
import { place, hasMoreSteps, type PlacementInput, type PlacementProject } from '../placement';

const proj = (over: Partial<PlacementProject> = {}): PlacementProject => ({
  id: 'p1',
  name: 'Vermont Standard memorial pages',
  status: 'in_progress',
  type: 'project',
  is_retainer: false,
  open_task_titles: [],
  ...over,
});
const input = (over: Partial<PlacementInput> = {}): PlacementInput => ({
  client_name: 'The Vermont Standard',
  projects: [],
  named_project_id: null,
  work: { title: 'Sample page for Phil Camp memorial', done_title: 'Build and send the Phil Camp sample page', next_step: 'Get them on a call', later: ['Get the content and images from them', 'Launch the page'] },
  ...over,
});

describe('Track it placement: the owner\'s project rule', () => {
  it('no live project and more than one step: only "Start a project for it"', () => {
    expect(place(input())).toEqual({ kind: 'new' });
  });
  it('a single finished one-off with no next step may be a loose task', () => {
    expect(place(input({ work: { title: 'Quick fix', done_title: 'Fixed the footer link', next_step: 'None', later: [] } }))).toEqual({ kind: 'loose' });
    expect(hasMoreSteps({ title: 'x', done_title: 'y', next_step: 'Nothing more.', later: [] })).toBe(false);
    expect(hasMoreSteps({ title: 'x', done_title: 'y', next_step: 'Call them', later: [] })).toBe(true);
    expect(hasMoreSteps({ title: 'x', done_title: 'y', next_step: '', later: ['Launch'] })).toBe(true);
  });
  it('multi-step work with no live project is never loose', () => {
    expect(place(input({ projects: [proj({ status: 'done' })] }))).toEqual({ kind: 'new' });
  });
  it('one live project that clearly fits (the model named it, name overlaps): add to it', () => {
    const p = proj({ name: 'Phil Camp memorial page' });
    expect(place(input({ projects: [p], named_project_id: 'p1' }))).toEqual({ kind: 'add', project: { id: 'p1', name: p.name } });
  });
  it('one live project with no clear overlap: the card asks', () => {
    const p = proj({ name: 'Annual report layout' });
    expect(place(input({ projects: [p] }))).toMatchObject({ kind: 'ask', project: { id: 'p1' } });
  });
  it('only a generic retainer project: the card asks', () => {
    const p = proj({ name: 'The Vermont Standard retainer', type: 'retainer', is_retainer: true });
    expect(place(input({ projects: [p], named_project_id: 'p1' }))).toMatchObject({ kind: 'ask' });
  });
  it('more than one live candidate: the card asks, naming the one the model named', () => {
    const a = proj({ id: 'a', name: 'Phil Camp memorial page' });
    const b = proj({ id: 'b', name: 'Phil Camp archive' });
    expect(place(input({ projects: [a, b], named_project_id: 'b' }))).toMatchObject({ kind: 'ask', project: { id: 'b' } });
  });
  it('a done, cancelled, quote, queue or suspended project is never offered', () => {
    for (const status of ['done', 'cancelled', 'quote', 'queue', 'suspended']) {
      const p = proj({ status, name: 'Phil Camp memorial page' });
      expect(place(input({ projects: [p], named_project_id: 'p1' }))).toEqual({ kind: 'new' });
    }
  });
  it('a live project whose open tasks overlap the work fits', () => {
    const p = proj({ name: 'Website', open_task_titles: ['Phil Camp memorial layout', 'Send sample page draft'] });
    expect(place(input({ projects: [p], named_project_id: 'p1' }))).toMatchObject({ kind: 'add' });
  });
  it('ready and review projects are live too', () => {
    for (const status of ['ready', 'review']) {
      expect(place(input({ projects: [proj({ status, name: 'Phil Camp memorial page' })], named_project_id: 'p1' }))).toMatchObject({ kind: 'add' });
    }
  });
});
