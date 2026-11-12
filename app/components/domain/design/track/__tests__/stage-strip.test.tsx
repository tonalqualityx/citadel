import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StageStrip, STAGE_STEPS, stageProgress } from '../StageStrip';
import type { DesignSessionTrack } from '@/lib/hooks/use-design';

const track = (stage: string, over: Partial<DesignSessionTrack> = {}): DesignSessionTrack => ({
  id: 't', stage, busy: false, busy_line: null, preview_alias: 'a', preview_url: null, finish: null, ...over,
});
const steps = () => screen.getAllByRole('listitem');

describe('stage strip', () => {
  it('has the seven steps in order', () => {
    render(<StageStrip track={track('refine')} />);
    expect(steps().map((li) => li.querySelector('span:not([aria-hidden]):not(.sr-only):not(.font-normal)')?.textContent)).toEqual([...STAGE_STEPS]);
    expect(STAGE_STEPS).toEqual(['Research', 'Outline', 'Direction', 'Home', 'Refine', 'Rest of site', 'Review']);
  });

  it.each([
    ['research', 'Research'],
    ['art_direction', 'Direction'],
    ['home_build', 'Home'],
    ['refine', 'Refine'],
    ['rest_build', 'Rest of site'],
    ['review', 'Review'],
  ])('stage %s marks %s as the current step', (stage, label) => {
    render(<StageStrip track={track(stage)} />);
    const current = steps().filter((li) => li.getAttribute('aria-current') === 'step');
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toContain(label);
    expect(current[0].textContent).toContain('(now)');
    expect(current[0].getAttribute('data-state')).toBe('current');
  });

  it('earlier steps are complete and later ones are not started, in words for a screen reader', () => {
    render(<StageStrip track={track('refine')} />);
    const states = steps().map((li) => li.getAttribute('data-state'));
    expect(states).toEqual(['complete', 'complete', 'complete', 'complete', 'current', 'upcoming', 'upcoming']);
    expect(steps()[0].textContent).toContain('(done)');
    expect(steps()[6].textContent).toContain('(not started)');
  });

  it('the outline counts as finished once the direction stage starts', () => {
    render(<StageStrip track={track('art_direction')} />);
    expect(steps()[1].getAttribute('data-state')).toBe('complete');
  });

  it('done shows every step complete and none current', () => {
    render(<StageStrip track={track('done')} />);
    expect(steps().every((li) => li.getAttribute('data-state') === 'complete')).toBe(true);
    expect(steps().some((li) => li.hasAttribute('aria-current'))).toBe(false);
  });

  it('shows the busy line in a live region only when busy', () => {
    const { rerender } = render(<StageStrip track={track('home_build', { busy: true, busy_line: 'Building the home page' })} />);
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('Building the home page');
    rerender(<StageStrip track={track('home_build', { busy: false, busy_line: 'stale line' })} />);
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('untracked renders nothing; an unknown stage renders nothing', () => {
    expect(render(<StageStrip track={null} />).container.innerHTML).toBe('');
    expect(render(<StageStrip track={undefined} />).container.innerHTML).toBe('');
    expect(render(<StageStrip track={track('cancelled')} />).container.innerHTML).toBe('');
    expect(stageProgress('nope')).toBeNull();
  });
});
