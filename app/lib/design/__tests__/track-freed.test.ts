/**
 * A build that fails for good tells the open page the track is free (Sabeen on Jack Gaughan, 2026-11-24: the page
 * kept showing a build as running, so "Revise direction" never appeared until a reload).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const appendWorkerEvents = vi.fn<(...args: unknown[]) => Promise<{ last_seq: number; first_seq: number; acked: number }>>(async () => ({ last_seq: 1, first_seq: 1, acked: 0 }));
vi.mock('../events', () => ({ appendWorkerEvents: (...args: unknown[]) => appendWorkerEvents(...args) }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/services/dependencies', () => ({ unblockEligibleDependents: vi.fn() }));
vi.mock('@/lib/work/ask-closure', () => ({ closeAsksForTask: vi.fn() }));

import { recordTrackFreed, trackTx } from '../track-core';

function fakeDb(track: { stage: string; busy_job_id: string | null } | null, session: { id: string } | null) {
  return {
    designTrack: { findUnique: vi.fn(async () => track) },
    designSession: { findFirst: vi.fn(async () => session) },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
  };
}

describe('recordTrackFreed', () => {
  beforeEach(() => appendWorkerEvents.mockClear());

  it('writes one track_stage line saying the track is not busy', async () => {
    const db = fakeDb({ stage: 'home_build', busy_job_id: null }, { id: 'sess-1' });
    await recordTrackFreed('trk-1', db as never);
    expect(appendWorkerEvents).toHaveBeenCalledTimes(1);
    const [sessionId, input] = appendWorkerEvents.mock.calls[0] as [string, { events: Array<{ kind: string; payload: Record<string, unknown> }> }];
    expect(sessionId).toBe('sess-1');
    expect(input.events[0].kind).toBe('track_stage');
    expect(input.events[0].payload).toMatchObject({ stage: 'home_build', busy: false });
  });

  it('writes nothing while another job holds the track, or with no open session', async () => {
    await recordTrackFreed('trk-1', fakeDb({ stage: 'home_build', busy_job_id: 'job-2' }, { id: 'sess-1' }) as never);
    await recordTrackFreed('trk-1', fakeDb({ stage: 'home_build', busy_job_id: null }, null) as never);
    await recordTrackFreed('trk-1', fakeDb(null, { id: 'sess-1' }) as never);
    expect(appendWorkerEvents).not.toHaveBeenCalled();
  });

  it('never throws: a feed line cannot fail the job report', async () => {
    appendWorkerEvents.mockRejectedValueOnce(new Error('boom'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(recordTrackFreed('trk-1', fakeDb({ stage: 'home_build', busy_job_id: null }, { id: 's' }) as never)).resolves.toBeUndefined();
    spy.mockRestore();
  });
});

describe('trackTx', () => {
  beforeEach(() => appendWorkerEvents.mockClear());

  it('tells the page after the commit for every track a transaction freed', async () => {
    const db = fakeDb({ stage: 'home_build', busy_job_id: null }, { id: 'sess-9' });
    const out = await trackTx(async (scope) => {
      scope.freed?.add('trk-9');
      expect(appendWorkerEvents).not.toHaveBeenCalled();
      return 'ok';
    }, db as never);
    expect(out).toBe('ok');
    expect(appendWorkerEvents).toHaveBeenCalledTimes(1);
  });
});
