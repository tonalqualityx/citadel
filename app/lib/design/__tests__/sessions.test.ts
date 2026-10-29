import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import type { DesignSessionStatus } from '@prisma/client';
import { legalTargets, SESSION_STATUSES, SESSION_TRANSITIONS, transition, isTerminalStatus } from '../sessions';

// The 8.7 table as the design states it: [from, to, who].
const LEGAL: [DesignSessionStatus, DesignSessionStatus, 'worker' | 'server'][] = [
  ['pending', 'awaiting_input', 'worker'],
  ['pending', 'stopped', 'worker'],
  ['awaiting_input', 'stopped', 'worker'],
  ['awaiting_input', 'active', 'worker'],
  ['active', 'awaiting_input', 'worker'],
  ['active', 'stopped', 'worker'],
  ['active', 'paused_budget', 'worker'],
  ['active', 'paused_budget', 'server'],
  ['awaiting_input', 'paused_budget', 'worker'],
  ['awaiting_input', 'paused_budget', 'server'],
  ['paused_budget', 'awaiting_input', 'worker'],
  ['stopped', 'awaiting_input', 'worker'],
  ['awaiting_input', 'publishing', 'server'],
  ['publishing', 'awaiting_input', 'server'],
  ...(['awaiting_input', 'stopped', 'paused_budget'] as const).flatMap((f) =>
    (['closed', 'abandoned'] as const).map((t) => [f, t, 'worker'] as [DesignSessionStatus, DesignSessionStatus, 'worker']),
  ),
];

describe('session transition table (design 8.7)', () => {
  it('active -> stopped is worker-only; stopped can resume or close (W8.1 R1)', () => {
    expect(transition({ status: 'active' }, 'stopped', 'worker')).toBe('stopped');
    expect(() => transition({ status: 'active' }, 'stopped', 'server')).toThrow(/may not move/);
    for (const to of ['awaiting_input', 'closed', 'abandoned'] as const) expect(transition({ status: 'stopped' }, to, 'worker')).toBe(to);
  });

  it('covers all 8 statuses', () => {
    expect(SESSION_STATUSES).toHaveLength(8);
    expect(Object.keys(SESSION_TRANSITIONS).sort()).toEqual([...SESSION_STATUSES].sort());
  });

  it('every state x every target: legal exactly when the table says so', () => {
    let checked = 0;
    for (const from of SESSION_STATUSES) {
      for (const to of SESSION_STATUSES) {
        const legal = LEGAL.some(([f, t]) => f === from && t === to);
        if (legal) expect(transition({ status: from }, to)).toBe(to);
        else expect(() => transition({ status: from }, to), `${from} -> ${to}`).toThrow(/cannot move/);
        checked++;
      }
    }
    expect(checked).toBe(64);
  });

  it('every state x target x actor: the actor must be allowed', () => {
    for (const from of SESSION_STATUSES) {
      for (const to of SESSION_STATUSES) {
        for (const by of ['worker', 'server'] as const) {
          const ok = LEGAL.some(([f, t, w]) => f === from && t === to && w === by);
          if (ok) expect(transition({ status: from }, to, by)).toBe(to);
          else expect(() => transition({ status: from }, to, by), `${by}: ${from} -> ${to}`).toThrow();
        }
      }
    }
  });

  it('illegal moves are 409 illegal_transition', () => {
    try {
      transition({ status: 'closed' }, 'active');
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as { statusCode: number }).statusCode).toBe(409);
      expect((e as { code: string }).code).toBe('illegal_transition');
    }
  });

  it('terminal states have no exits; publishing only returns to awaiting_input', () => {
    expect(legalTargets('closed')).toEqual([]);
    expect(legalTargets('abandoned')).toEqual([]);
    expect(legalTargets('publishing')).toEqual(['awaiting_input']);
    expect(isTerminalStatus('closed') && isTerminalStatus('abandoned') && !isTerminalStatus('stopped')).toBe(true);
  });
});
