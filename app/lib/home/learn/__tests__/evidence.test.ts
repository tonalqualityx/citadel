import { describe, it, expect } from 'vitest';
import { evidenceKeys, evidenceKindOf, evidenceLabel, typeLabel, typeOf } from '../evidence';

describe('evidence keys', () => {
  it('a task carries client, project, sop and type', () => {
    expect(evidenceKeys({ kind: 'task', client_id: 'c', project_id: 'p', sop_id: 's' })).toEqual(['client:c', 'project:p', 'sop:s', 'type:task']);
  });
  it('every learnable kind has its type key', () => {
    for (const k of ['review', 'session', 'wait', 'thread', 'task', 'step'] as const) expect(evidenceKeys({ kind: k })).toEqual([`type:${k}`]);
  });
  it('crisis mail, site rows and the hands row have no evidence at all', () => {
    for (const k of ['crisis', 'site', 'hands'] as const) {
      expect(typeOf(k)).toBeNull();
      expect(evidenceKeys({ kind: k, client_id: 'c', project_id: 'p' })).toEqual([]);
    }
  });
  it('a sender key only for a thread with no client, lower-cased', () => {
    expect(evidenceKeys({ kind: 'thread', sender: ' Pat@Example.com ' })).toEqual(['type:thread', 'sender:pat@example.com']);
    expect(evidenceKeys({ kind: 'thread', client_id: 'c', sender: 'pat@example.com' })).toEqual(['client:c', 'type:thread']);
    expect(evidenceKeys({ kind: 'task', sender: 'pat@example.com' })).toEqual(['type:task']);
  });
  it('labels read as the plan words', () => {
    expect(evidenceLabel('client', 'Nerd Herd')).toBe('Nerd Herd');
    expect(evidenceLabel('project', 'Alpha')).toBe('the Alpha project');
    expect(evidenceLabel('sop', 'Plugin updates')).toBe('tasks that follow Plugin updates');
    expect(evidenceLabel('sender', 'a@b.co')).toBe('mail from a@b.co');
    expect(typeLabel('type:review')).toBe('sign-offs');
    expect(typeLabel('type:session')).toBe('session questions');
    expect(typeLabel('type:wait')).toBe('waits');
    expect(typeLabel('type:thread')).toBe('email threads');
    expect(typeLabel('type:step')).toBe('project next steps');
    expect(evidenceKindOf('sop:x')).toBe('sop');
    expect(evidenceKindOf('nope:x')).toBeNull();
  });
});
