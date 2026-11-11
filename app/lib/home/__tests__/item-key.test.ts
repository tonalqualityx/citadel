import { describe, it, expect } from 'vitest';
import {
  ITEM_KEY_MAX_LENGTH,
  OWN_GROUP_KEY,
  arcGroupKey,
  buildGroupKey,
  buildItemKey,
  clientGroupKey,
  crisisKey,
  groupKeySchema,
  isGroupKey,
  isItemKey,
  itemKeyKind,
  itemKeySchema,
  parseGroupKey,
  parseItemKey,
  projectGroupKey,
  reviewKey,
  sessionKey,
  taskKey,
  threadKey,
  waitKey,
  proposalKey,
  type ParsedItemKey,
} from '../item-key';

const U1 = '7aa4a01a-1111-4222-8333-944445555666';
const U2 = '3ecfb7be-20bb-43cb-9b4d-31c44337dc81';

describe('item keys: build and parse', () => {
  it('builds every kind in the plan 1.1 format', () => {
    expect(taskKey(U1)).toBe(`task:${U1}`);
    expect(waitKey(U1)).toBe(`wait:${U1}`);
    expect(crisisKey(U1)).toBe(`crisis:${U1}`);
    expect(reviewKey(U2)).toBe(`review:${U2}`);
    expect(reviewKey(null)).toBe('review:none');
    expect(sessionKey('abc-123')).toBe('session:abc-123');
    expect(threadKey('mike@becomeindelible.com', '18f2a9c0d1e2')).toBe('thread:mike@becomeindelible.com:18f2a9c0d1e2');
  });

  it('parses every kind back to its parts', () => {
    expect(parseItemKey(`task:${U1}`)).toEqual({ kind: 'task', id: U1 });
    expect(parseItemKey(`wait:${U1}`)).toEqual({ kind: 'wait', id: U1 });
    expect(parseItemKey(`crisis:${U1}`)).toEqual({ kind: 'crisis', id: U1 });
    expect(parseItemKey(`review:${U2}`)).toEqual({ kind: 'review', project_id: U2 });
    expect(parseItemKey('review:none')).toEqual({ kind: 'review', project_id: null });
    expect(parseItemKey('session:abc-123')).toEqual({ kind: 'session', external_id: 'abc-123' });
    expect(parseItemKey('thread:mike@becomeindelible.com:18f2a9c0d1e2')).toEqual({
      kind: 'thread',
      account: 'mike@becomeindelible.com',
      thread_id: '18f2a9c0d1e2',
    });
  });

  it('round-trips exactly: build(parse(key)) === key', () => {
    const keys = [
      taskKey(U1),
      waitKey(U2),
      crisisKey(U1),
      reviewKey(U2),
      reviewKey(null),
      sessionKey('wf:run:42'),
      threadKey('support@becomeindelible.com', 'thread:with:colons'),
    ];
    for (const k of keys) {
      const p = parseItemKey(k) as ParsedItemKey;
      expect(p).not.toBeNull();
      expect(buildItemKey(p)).toBe(k);
    }
  });

  it('keeps colons in the session id and in the thread id (the rest of the key)', () => {
    expect(parseItemKey('session:cron:daily:7')).toEqual({ kind: 'session', external_id: 'cron:daily:7' });
    expect(parseItemKey('thread:a@b.c:x:y')).toEqual({ kind: 'thread', account: 'a@b.c', thread_id: 'x:y' });
  });

  it('lowercases a uuid on build so keys stay canonical', () => {
    expect(taskKey(U1.toUpperCase())).toBe(`task:${U1}`);
    expect(reviewKey(U2.toUpperCase())).toBe(`review:${U2}`);
  });

  it('reports the kind', () => {
    expect(itemKeyKind(`task:${U1}`)).toBe('task');
    expect(itemKeyKind('review:none')).toBe('review');
    expect(itemKeyKind('thread:a@b.c:t')).toBe('thread');
    expect(itemKeyKind('nope')).toBeNull();
  });
});

describe('item keys: rejection', () => {
  const bad: unknown[] = [
    null,
    undefined,
    42,
    {},
    '',
    'task',
    'task:',
    ':abc',
    `Task:${U1}`,
    `task:${U1.toUpperCase()}`,
    'task:not-a-uuid',
    `task:${U1}x`,
    `task: ${U1}`,
    `project:${U1}`,
    `arc:${U1}`,
    'review:',
    'review:None',
    'review:123',
    'session:',
    'session:has space',
    'session:tab\there',
    'session:new\nline',
    'thread:',
    'thread:a@b.c',
    'thread:a@b.c:',
    'thread::t1',
    'thread:a b@c.d:t1',
    `crisis:${U1}:extra`,
    `wait:${U1} `,
  ];
  for (const k of bad) {
    it(`rejects ${JSON.stringify(k)}`, () => {
      expect(parseItemKey(k)).toBeNull();
      expect(isItemKey(k)).toBe(false);
    });
  }

  it(`rejects keys over ${ITEM_KEY_MAX_LENGTH} characters`, () => {
    const longThread = 'x'.repeat(250);
    const k = `thread:${'a'.repeat(60)}@b.c:${longThread}`;
    expect(k.length).toBeGreaterThan(ITEM_KEY_MAX_LENGTH);
    expect(parseItemKey(k)).toBeNull();
  });

  it('rejects a session id over 255 characters', () => {
    expect(parseItemKey(`session:${'s'.repeat(256)}`)).toBeNull();
    expect(parseItemKey(`session:${'s'.repeat(255)}`)).not.toBeNull();
  });

  it('build throws on parts that would not round-trip', () => {
    expect(() => taskKey('not-a-uuid')).toThrow();
    expect(() => sessionKey('')).toThrow();
    expect(() => sessionKey('has space')).toThrow();
    expect(() => threadKey('a:b@c.d', 't1')).toThrow();
    expect(() => threadKey('a@b.c', '')).toThrow();
    expect(() => buildItemKey({ kind: 'nope' } as unknown as ParsedItemKey)).toThrow();
  });
});

describe('group keys', () => {
  it('builds and parses arc, client, project and own', () => {
    expect(arcGroupKey(U1)).toBe(`arc:${U1}`);
    expect(clientGroupKey(U1)).toBe(`client:${U1}`);
    expect(projectGroupKey(U1)).toBe(`project:${U1}`);
    expect(buildGroupKey({ kind: 'own' })).toBe(OWN_GROUP_KEY);
    expect(parseGroupKey(`arc:${U1}`)).toEqual({ kind: 'arc', id: U1 });
    expect(parseGroupKey(`client:${U2}`)).toEqual({ kind: 'client', id: U2 });
    expect(parseGroupKey(`project:${U2}`)).toEqual({ kind: 'project', id: U2 });
    expect(parseGroupKey('own')).toEqual({ kind: 'own' });
  });

  it('rejects anything else', () => {
    for (const k of [null, '', 'own:', 'OWN', `task:${U1}`, `arc:${U1.toUpperCase()}`, 'arc:', 'client:abc', `site:${U1}`]) {
      expect(isGroupKey(k)).toBe(false);
    }
    expect(() => arcGroupKey('abc')).toThrow();
  });

  it('every group key fits home_day.group_key (VarChar 120)', () => {
    expect(projectGroupKey(U1).length).toBeLessThanOrEqual(120);
  });
});

describe('zod schemas', () => {
  it('itemKeySchema accepts keys and refuses the rest', () => {
    expect(itemKeySchema.safeParse(`task:${U1}`).success).toBe(true);
    expect(itemKeySchema.safeParse('thread:a@b.c:t').success).toBe(true);
    expect(itemKeySchema.safeParse('task:nope').success).toBe(false);
    expect(itemKeySchema.safeParse(7).success).toBe(false);
  });

  it('groupKeySchema accepts group keys and refuses item keys', () => {
    expect(groupKeySchema.safeParse('own').success).toBe(true);
    expect(groupKeySchema.safeParse(`arc:${U1}`).success).toBe(true);
    expect(groupKeySchema.safeParse(`task:${U1}`).success).toBe(false);
  });
});

describe('Slice 6a keys: site and hands', () => {
  const S = '7aa4a01a-1111-4222-8333-944445555666';
  it('site:<uuid> and hands:week round-trip, and nothing else parses under those prefixes', () => {
    expect(parseItemKey(`site:${S}`)).toEqual({ kind: 'site', id: S });
    expect(buildItemKey({ kind: 'site', id: S.toUpperCase() })).toBe(`site:${S}`);
    expect(parseItemKey('hands:week')).toEqual({ kind: 'hands' });
    expect(buildItemKey({ kind: 'hands' })).toBe('hands:week');
    expect(itemKeyKind(`site:${S}`)).toBe('site');
    expect(itemKeyKind('hands:week')).toBe('hands');
    for (const bad of ['site:not-a-uuid', `site:${S}:x`, 'hands:', 'hands:next', 'hands:week:1', `hands:${S}`]) {
      expect(isItemKey(bad)).toBe(false);
    }
    expect(itemKeySchema.safeParse(`site:${S}`).success).toBe(true);
    expect(itemKeySchema.safeParse('hands:week').success).toBe(true);
  });
});

describe('Slice 8b key: step', () => {
  const P = '7aa4a01a-1111-4222-8333-944445555666';
  it('step:<project uuid> round-trips and nothing else parses under that prefix', () => {
    expect(parseItemKey(`step:${P}`)).toEqual({ kind: 'step', project_id: P });
    expect(buildItemKey({ kind: 'step', project_id: P.toUpperCase() })).toBe(`step:${P}`);
    expect(itemKeyKind(`step:${P}`)).toBe('step');
    for (const bad of ['step:', 'step:none', 'step:not-a-uuid', `step:${P}:x`, `step: ${P}`]) expect(isItemKey(bad)).toBe(false);
    expect(itemKeySchema.safeParse(`step:${P}`).success).toBe(true);
    expect(() => buildItemKey({ kind: 'step', project_id: 'nope' })).toThrow();
  });
});

describe('Slice 9a: proposal keys', () => {
  it('round trips proposal:<uuid> and rejects anything else', () => {
    const k = proposalKey(U1);
    expect(k).toBe(`proposal:${U1}`);
    expect(parseItemKey(k)).toEqual({ kind: 'proposal', id: U1 });
    expect(itemKeyKind(k)).toBe('proposal');
    expect(buildItemKey({ kind: 'proposal', id: U1.toUpperCase() })).toBe(k);
    expect(isItemKey('proposal:nope')).toBe(false);
    expect(isItemKey('proposal:')).toBe(false);
    expect(itemKeySchema.safeParse(k).success).toBe(true);
  });
});
