import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/services/notification-dispatcher', () => ({ dispatchNotification: vi.fn() }));

import type { DesignPublishStatus } from '@prisma/client';
import {
  PUBLISH_TRANSITIONS,
  WORKER_PUBLISH_STATUSES,
  applyWorkerPublishPatch,
  approvalSourceFor,
  assertPublishMove,
  isLegalPublishMove,
  liveUrlFor,
  publishCommentText,
  publishPriority,
} from '../publishes';

const ALL: DesignPublishStatus[] = ['awaiting_confirmation', 'expired', 'queued', 'running', 'published', 'blocked_gates', 'blocked_policy', 'conflict', 'failed', 'rolled_back'];
const ID = '3f2b8c1e-9d4a-4e6b-8a1f-0c2d3e4f5a6b';

describe('publish status machine', () => {
  it('lists every status', () => {
    expect(Object.keys(PUBLISH_TRANSITIONS).sort()).toEqual([...ALL].sort());
  });

  it('is exactly the forward-only table', () => {
    const legal: string[] = [];
    for (const from of ALL) for (const to of ALL) for (const by of ['worker', 'server'] as const) if (isLegalPublishMove(from, to, by)) legal.push(`${from}>${to}:${by}`);
    expect(legal.sort()).toEqual([
      'awaiting_confirmation>expired:server',
      'awaiting_confirmation>queued:server',
      'published>rolled_back:server',
      'queued>blocked_gates:worker',
      'queued>conflict:worker',
      'queued>failed:worker',
      'queued>running:worker',
      'running>blocked_gates:worker',
      'running>conflict:worker',
      'running>failed:worker',
      'running>published:worker',
    ]);
  });

  it('the worker can never move a row out of awaiting_confirmation, nor publish straight from queued', () => {
    for (const to of WORKER_PUBLISH_STATUSES) expect(() => assertPublishMove('awaiting_confirmation', to, 'worker')).toThrow(/cannot move/);
    expect(() => assertPublishMove('queued', 'published', 'worker')).toThrow();
    expect(() => assertPublishMove('published', 'running', 'worker')).toThrow();
  });

  it('nothing enters blocked_policy (no content or code policy)', () => {
    for (const from of ALL) for (const by of ['worker', 'server'] as const) expect(isLegalPublishMove(from, 'blocked_policy', by)).toBe(false);
  });

  it('applyWorkerPublishPatch refuses statuses outside the worker set with 400', async () => {
    for (const status of ['queued', 'awaiting_confirmation', 'expired', 'rolled_back', 'blocked_policy']) {
      await expect(applyWorkerPublishPatch(ID, { status } as never)).rejects.toMatchObject({ statusCode: 400, code: 'bad_status' });
    }
  });
});

describe('approval sources, priority, live URL', () => {
  it('design_publish / design_admin_publish / design_rollback', () => {
    expect(approvalSourceFor({ id: ID, kind: 'publish', actor_role: 'designer' })).toBe(`design_publish:${ID}`);
    expect(approvalSourceFor({ id: ID, kind: 'publish', actor_role: 'admin' })).toBe(`design_admin_publish:${ID}`);
    expect(approvalSourceFor({ id: ID, kind: 'rollback', actor_role: 'admin' })).toBe(`design_rollback:${ID}`);
  });

  it('high on production (and unknown), normal on client_preview', () => {
    expect(publishPriority('production')).toBe('high');
    expect(publishPriority(null)).toBe('high');
    expect(publishPriority('client_preview')).toBe('normal');
  });

  it('liveUrlFor reads the box map and ignores junk', () => {
    expect(liveUrlFor('s1', { s1: ' https://vcdp.pages.dev ' })).toBe('https://vcdp.pages.dev');
    expect(liveUrlFor('s1', { s2: 'x' })).toBeNull();
    expect(liveUrlFor('s1', ['x'])).toBeNull();
    expect(liveUrlFor('s1', { s1: 3 })).toBeNull();
  });
});

describe('publishCommentText', () => {
  const base = {
    id: ID, kind: 'publish' as const, actor_role: 'designer', main_role: 'production', head_sha: 'a'.repeat(40), from_main_sha: 'c'.repeat(40),
    result_sha: 'd'.repeat(40), deploy_url: 'https://abc.vcdp.pages.dev', alias_url: 'https://vcdp.org',
    gates: [{ name: 'a11y', ok: true }, { name: 'balance_check', ok: false, reported: true }],
    confirmation_shown: { target_words: 'the LIVE production site at vcdp.org' }, confirmation_typed: 'main',
    confirmed_at: new Date('2026-10-28T12:00:00Z'), cost_usd: 1.5 as never, rolls_back_id: null,
  };

  it('names the actor, what was confirmed, the commit, the deploy, the gates and the cost', () => {
    const t = publishCommentText({ publish: base, actorName: 'Lisa', siteName: 'VCDP' });
    expect(t).toContain('to the LIVE production site at vcdp.org by Lisa (designer)');
    expect(t).toContain('typed "main" at 2026-10-28T12:00:00.000Z');
    expect(t).toContain(`main ${'c'.repeat(12)} -> ${'d'.repeat(12)}`);
    expect(t).toContain('Deploy: https://abc.vcdp.pages.dev (https://vcdp.org)');
    expect(t).toContain('Gates: a11y ok, balance_check red (reported)');
    expect(t).toContain('Session cost: $1.50');
  });

  it('a rollback names the publish it undoes and the reason', () => {
    const t = publishCommentText({
      publish: { ...base, kind: 'rollback', actor_role: 'admin', rolls_back_id: '9a000000-0000-4000-8000-000000000001', confirmation_shown: { target_words: 'x', rollback_reason: 'wrong hero' } },
      actorName: 'Mike', siteName: 'VCDP',
    });
    expect(t).toContain('Design rollback 3f2b8c1e');
    expect(t).toContain('Rolled back publish 9a000000');
    expect(t).toContain('Reason: wrong hero');
    expect(t).not.toContain('Session cost');
  });
});
