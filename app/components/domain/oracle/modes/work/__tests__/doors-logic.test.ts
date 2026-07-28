import { describe, it, expect } from 'vitest';
import { buildDoors } from '../doors-logic';

const NOW = new Date('2026-07-27T13:00:00.000Z').getTime();

function baseInput() {
  return {
    reviewCount: 0,
    reviewOldestWaitAt: null,
    intakeCount: 0,
    intakeOldestAt: null,
    archivedToday: 0,
    pipelineOpenCount: 0,
    pipelineNothingMovingCount: 0,
    dueSoonTasks: [],
    nowMs: NOW,
  };
}

describe('buildDoors', () => {
  it('always returns exactly 4 doors, in reviews/intake/pipeline/due_soon order', () => {
    const doors = buildDoors(baseInput());
    expect(doors.map((d) => d.id)).toEqual(['reviews', 'intake', 'pipeline', 'due_soon']);
  });

  it('a door with count 0 still renders with a truthful "none" label — never hidden (stable landmark, G11)', () => {
    const doors = buildDoors(baseInput());
    expect(doors.find((d) => d.id === 'reviews')?.label).toBe('Reviews: none waiting');
  });

  it('reviews door: oldest-wait detail line', () => {
    const doors = buildDoors({ ...baseInput(), reviewCount: 3, reviewOldestWaitAt: new Date(NOW - 6 * 24 * 60 * 60_000).toISOString() });
    const door = doors.find((d) => d.id === 'reviews')!;
    expect(door.label).toBe('Reviews: 3 waiting');
    expect(door.detail).toContain('oldest');
    expect(door.target).toBe('process');
  });

  it('intake door: prefers "N auto-archived today" over "oldest" when both exist', () => {
    const doors = buildDoors({
      ...baseInput(),
      intakeCount: 12,
      intakeOldestAt: new Date(NOW - 60_000).toISOString(),
      archivedToday: 4,
    });
    const door = doors.find((d) => d.id === 'intake')!;
    expect(door.label).toBe('Intake: 12');
    expect(door.detail).toBe('4 auto-archived today');
    expect(door.target).toBe('process');
  });

  it('intake door: falls back to "oldest" when nothing was archived today', () => {
    const doors = buildDoors({ ...baseInput(), intakeCount: 2, intakeOldestAt: new Date(NOW - 60_000).toISOString() });
    expect(doors.find((d) => d.id === 'intake')?.detail).toContain('oldest');
  });

  it('pipeline door: "N with nothing moving" detail, omitted at zero', () => {
    const withNothing = buildDoors({ ...baseInput(), pipelineOpenCount: 3, pipelineNothingMovingCount: 1 });
    expect(withNothing.find((d) => d.id === 'pipeline')?.detail).toBe('1 with nothing moving');
    expect(withNothing.find((d) => d.id === 'pipeline')?.target).toBe('plan');

    const allMoving = buildDoors({ ...baseInput(), pipelineOpenCount: 3, pipelineNothingMovingCount: 0 });
    expect(allMoving.find((d) => d.id === 'pipeline')?.detail).toBeNull();
  });

  it('due-soon door: count + subtext from dueSoonDoorSummary, target=plan', () => {
    const doors = buildDoors({
      ...baseInput(),
      dueSoonTasks: [
        { id: 't1', promised_to: 'Dan', due_date: '2026-07-27T00:00:00.000Z' },
        { id: 't2', promised_to: null, due_date: '2026-07-28T00:00:00.000Z' },
      ],
    });
    const door = doors.find((d) => d.id === 'due_soon')!;
    expect(door.label).toBe('Due soon: 2');
    expect(door.detail).toBe('promised');
    expect(door.target).toBe('plan');
  });
});
